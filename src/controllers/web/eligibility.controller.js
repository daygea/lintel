'use strict';

const att = require('../../services/attestation.service');
const elig = require('../../services/eligibility.service');
const { pick } = require('../../plugins/locale-map');

const h = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

exports.register = h(async (req, res) => {
  const [types, attestations] = await Promise.all([att.listTypes(), att.listAll()]);
  res.render('eligibility/register', { types, attestations, pick, locale: req.tenant.defaultLocale });
});

exports.policies = h(async (req, res) => {
  const policies = await elig.listPolicies();
  res.render('eligibility/policies', { policies, pick, locale: req.tenant.defaultLocale });
});

exports.accessLog = h(async (req, res) => {
  const log = await elig.accessLog();
  res.render('eligibility/access-log', { log });
});
