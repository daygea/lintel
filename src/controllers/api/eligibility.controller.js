'use strict';

const att = require('../../services/attestation.service');
const elig = require('../../services/eligibility.service');
const archive = require('../../services/archive.service');

const h = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

/* attestation types */
exports.listTypes = h(async (req, res) => res.json({ types: await att.listTypes() }));
exports.createType = h(async (req, res) => res.status(201).json({ type: await att.createType(req.body) }));

/* attestations */
exports.issue = h(async (req, res) => res.status(201).json({ attestation: await att.issue(req.body) }));
exports.revoke = h(async (req, res) => res.json({ revocation: await att.revoke({ attestationId: req.params.id, ...req.body }) }));
exports.currentFor = h(async (req, res) => res.json({ standings: await att.currentFor(req.params.userId) }));
exports.listAttestations = h(async (req, res) => res.json({ attestations: await att.listAll() }));

/* policies */
exports.listPolicies = h(async (req, res) => res.json({ policies: await elig.listPolicies() }));
exports.upsertPolicy = h(async (req, res) => res.status(201).json({ policy: await elig.upsertPolicy(req.body) }));

/* the decision */
exports.canAccess = h(async (req, res) =>
  res.json(await elig.canAccessLesson({
    lessonId: req.params.lessonId,
    userId: req.user._id,
    locale: req.tenant.defaultLocale,
    request: { ip: req.ip, userAgent: req.get('user-agent'), sessionId: req.sessionID },
  }))
);
exports.accessLog = h(async (req, res) => res.json({ log: await elig.accessLog() }));

/* archive webhook — signed in production; open in dev */
exports.consentRevoked = h(async (req, res) =>
  res.json(await archive.onConsentRevoked(req.body))
);
