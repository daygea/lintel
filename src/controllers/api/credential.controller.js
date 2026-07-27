'use strict';

const cred = require('../../services/credential.service');
const exportSvc = require('../../services/export.service');

const h = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

exports.listTemplates = h(async (req, res) => res.json({ templates: await cred.listTemplates() }));
exports.createTemplate = h(async (req, res) => res.status(201).json({ template: await cred.createTemplate(req.body) }));

exports.issue = h(async (req, res) => res.status(201).json({ credential: await cred.issue(req.body) }));
exports.revoke = h(async (req, res) => res.json({ credential: await cred.revoke({ credentialId: req.params.id, ...req.body }) }));
exports.listFor = h(async (req, res) => res.json({ credentials: await cred.listFor(req.params.userId) }));

exports.exportTenant = h(async (req, res) => {
  const data = await exportSvc.exportTenant();
  res.setHeader('Content-Disposition', 'attachment; filename="lintel-export.json"');
  res.json(data);
});
