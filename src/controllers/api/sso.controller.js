'use strict';

const { SsoConnection } = require('../../models');
const identity = require('../../services/identity.service');
const sisImport = require('../../services/sis-import.service');
const { adapterFor } = require('../../services/sso');

const h = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

exports.listConnections = h(async (req, res) => res.json({ connections: await SsoConnection.find({}).exec() }));
exports.createConnection = h(async (req, res) => res.status(201).json({ connection: await SsoConnection.create(req.body) }));

/** Begin login: redirect the user to their institution's IdP. */
exports.begin = h(async (req, res) => {
  const connection = await SsoConnection.findById(req.params.id).exec();
  if (!connection) return res.status(404).json({ error: 'no such connection' });
  const adapter = adapterFor(connection.protocol);
  const { redirectUrl } = await adapter.authnRequest(connection, { relayState: req.query.returnTo });
  res.json({ redirectUrl });
});

/**
 * Assertion callback. The adapter VERIFIES (signature, audience, expiry), then the
 * identity service links or provisions. A verified assertion is the only thing
 * that reaches resolveFromAssertion.
 */
exports.callback = h(async (req, res) => {
  const connection = await SsoConnection.findById(req.params.id).exec();
  if (!connection) return res.status(404).json({ error: 'no such connection' });

  const adapter = adapterFor(connection.protocol);
  const { subject, attributes } = await adapter.verify(connection, req.body);

  const user = await identity.resolveFromAssertion({ connectionId: connection._id, subject, attributes });

  req.session.userId = String(user._id);
  res.json({ ok: true, userId: user._id });
});

/** SIS roster import. Rows arrive already parsed from CSV/Excel at the edge. */
exports.sisImport = h(async (req, res) => {
  const report = await sisImport.importRoster({ rows: req.body.rows, source: req.body.source });
  res.json({ report });
});
