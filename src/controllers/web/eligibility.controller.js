'use strict';

const att = require('../../services/attestation.service');
const elig = require('../../services/eligibility.service');
const membership = require('../../services/membership.service');
const { pick } = require('../../plugins/locale-map');

const { known: knownRuleTypes } = require('../../services/eligibility/registry');
const h = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

exports.createStanding = h(async (req, res) => {
  await att.createType({
    slug: req.body.slug,
    label: localeFromForm(req.body, 'label', req.tenant.locales),
    description: localeFromForm(req.body, 'description', req.tenant.locales),
    requiresIssuerRole: req.body.requiresIssuerRole || 'assessor',
    defaultValidityDays: req.body.defaultValidityDays ? Number(req.body.defaultValidityDays) : undefined,
  });
  res.redirect('/register');
});

exports.issueAttestation = h(async (req, res) => {
  await att.issue({
    subjectUserId: req.body.subjectUserId,
    typeSlug: req.body.typeSlug,
    note: req.body.note || undefined,
  });
  res.redirect('/register');
});

exports.revokeAttestation = h(async (req, res) => {
  await att.revoke({ attestationId: req.params.id, reason: req.body.reason || 'revoked' });
  res.redirect('/register');
});

exports.register = h(async (req, res) => {
  const [types, attestations, members] = await Promise.all([
    att.listTypes(),
    att.listAll(),
    membership.list({ status: 'active' }),
  ]);
  const roles = ['owner', 'admin', 'registrar', 'instructor', 'assessor', 'elder'];
  res.render('eligibility/register', { types, attestations, members, roles, pick, locale: req.tenant.defaultLocale, error: null });
});

exports.createPolicy = h(async (req, res) => {
  const rules = [];
  const types = [].concat(req.body.rule_type || []).filter(Boolean);
  const params = [].concat(req.body.rule_params || []);
  types.forEach((t, i) => {
    let parsed = {};
    const raw = (params[i] || '').trim();
    if (raw) { try { parsed = JSON.parse(raw); } catch (e) { throw new Error(`Rule ${i + 1}: parameters must be valid JSON`); } }
    rules.push({ type: t, params: parsed });
  });
  await elig.upsertPolicy({
    slug: req.body.slug,
    label: localeFromForm(req.body, 'label', req.tenant.locales),
    denialMessage: localeFromForm(req.body, 'denialMessage', req.tenant.locales),
    combinator: req.body.combinator === 'any' ? 'any' : 'all',
    rules,
  });
  res.redirect('/policies');
});

exports.policies = h(async (req, res) => {
  const policies = await elig.listPolicies();
  res.render('eligibility/policies', { policies, pick, locale: req.tenant.defaultLocale, ruleTypes: knownRuleTypes(), error: null });
});

exports.accessLog = h(async (req, res) => {
  const log = await elig.accessLog();
  res.render('eligibility/access-log', { log });
});

/** Build a locale map from label_en / label_yo style form fields. */
function localeFromForm(body, base, locales) {
  const map = {};
  for (const loc of locales) { const v = body[`${base}_${loc}`]; if (v) map[loc] = v; }
  return map;
}
