'use strict';

const cred = require('../../services/credential.service');
const membership = require('../../services/membership.service');
const curriculum = require('../../services/curriculum.service');
const { pick } = require('../../plugins/locale-map');

const h = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

/**
 * The PUBLIC verification page. No session, no tenant resolution needed — it looks
 * up by the code alone. This is the page a stranger reaches by scanning a QR.
 */
exports.verify = h(async (req, res) => {
  const result = await cred.verifyPublic(req.params.code);
  res.render('credential/verify', { result, pick });
});

/** Staff view: templates and issued credentials. */
exports.index = h(async (req, res) => {
  const [templates, credentials, members, courses] = await Promise.all([
    cred.listTemplates(),
    cred.listAll(),
    membership.list({ status: 'active' }),
    curriculum.listCourses().catch(() => []),
  ]);
  res.render('credential/index', { templates, credentials, members, courses, pick, locale: req.tenant.defaultLocale, error: null });
});

exports.createTemplate = h(async (req, res) => {
  await cred.createTemplate({
    slug: req.body.slug,
    title: localeFromForm(req.body, 'title', req.tenant.locales),
    body: localeFromForm(req.body, 'body', req.tenant.locales),
    serialFormat: req.body.serialFormat || undefined,
    courseId: req.body.courseId || undefined,
  });
  res.redirect('/credentials');
});

exports.issue = h(async (req, res) => {
  await cred.issue({ templateId: req.body.templateId, userId: req.body.userId });
  res.redirect('/credentials');
});

exports.revoke = h(async (req, res) => {
  await cred.revoke({ credentialId: req.params.id, reason: req.body.reason });
  res.redirect('/credentials');
});

function localeFromForm(body, base, locales) {
  const map = {};
  for (const loc of locales) { const v = body[`${base}_${loc}`]; if (v) map[loc] = v; }
  return map;
}
