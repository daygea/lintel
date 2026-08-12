'use strict';

const auth = require('../../services/auth.service');
const platform = require('../../services/platform.service');
const signup = require('../../services/signup.service');
const { PLANS } = require('../../config/plans');
const { pick } = require('../../plugins/locale-map');
const { format } = require('../../lib/money');

const h = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

const plans = () => Object.keys(PLANS);

/* ---- Console auth (apex — a superadmin has no tenant to log in through) ---- */
exports.showLogin = (req, res) => res.render('console/login', { error: null });

exports.login = h(async (req, res) => {
  try {
    const user = await auth.authenticate(req.body);
    if (user.platformRole !== 'superadmin') {
      // Do not reveal that the console exists to a non-operator who guessed the URL.
      return res.status(404).render('error', { status: 404, message: 'Not found' });
    }
    req.session.userId = String(user._id);
    req.session.epoch = user.sessionEpoch || 0;
    res.redirect('/console');
  } catch (err) {
    res.status(401).render('console/login', { error: 'Those credentials are not right.' });
  }
});

exports.logout = (req, res) => { req.session.destroy(() => res.redirect('/console/login')); };

exports.dashboard = h(async (req, res) => {
  const overview = await platform.overview();
  res.render('console/dashboard', { overview, format });
});

exports.institutions = h(async (req, res) => {
  const includeArchived = req.query.archived === '1';
  const tenants = await platform.listTenants({ includeArchived });
  res.render('console/institutions', { tenants, includeArchived });
});

exports.deleteInstitution = h(async (req, res) => {
  await platform.deleteTenant(req.params.id, req.body.reason, req.user._id);
  res.redirect('/console/institutions');
});

exports.restoreInstitution = h(async (req, res) => {
  await platform.restoreTenant(req.params.id, req.user._id);
  res.redirect('/console/institutions?archived=1');
});

exports.institution = h(async (req, res) => {
  const { tenant, memberCount } = await platform.tenantDetail(req.params.id);
  res.render('console/institution', { tenant, memberCount, plans: plans(), error: null });
});

exports.suspend = h(async (req, res) => {
  await platform.suspendTenant(req.params.id, req.body.reason, req.user._id);
  res.redirect(`/console/institutions/${req.params.id}`);
});

exports.reactivate = h(async (req, res) => {
  await platform.reactivateTenant(req.params.id, req.user._id);
  res.redirect(`/console/institutions/${req.params.id}`);
});

exports.setPlan = h(async (req, res) => {
  await platform.setPlan(req.params.id, req.body.plan, req.user._id);
  res.redirect(`/console/institutions/${req.params.id}`);
});

exports.editInstitution = h(async (req, res) => {
  const locales = [].concat(req.body.locales || []).filter(Boolean);
  await platform.editTenantMetadata(req.params.id, {
    name: req.body.name, slug: req.body.slug, locales,
  }, req.user._id);
  res.redirect(`/console/institutions/${req.params.id}`);
});

exports.closeInstitution = h(async (req, res) => {
  await platform.closeTenant(req.params.id, req.body.reason, req.user._id);
  res.redirect(`/console/institutions/${req.params.id}`);
});

exports.applications = h(async (req, res) => {
  const applications = await signup.listApplications('pending');
  res.render('console/applications', { applications });
});

exports.approveApplication = h(async (req, res) => {
  await signup.approve({ applicationId: req.params.id });
  res.redirect('/console/applications');
});

exports.declineApplication = h(async (req, res) => {
  await signup.decline({ applicationId: req.params.id, reason: req.body.reason });
  res.redirect('/console/applications');
});

exports.operators = h(async (req, res) => {
  const operators = await platform.listSuperadmins();
  res.render('console/operators', { operators, currentUserId: String(req.user._id), error: null });
});

exports.grantOperator = h(async (req, res) => {
  try {
    await platform.grantSuperadmin(req.body.email, req.user._id);
    res.redirect('/console/operators');
  } catch (err) {
    const operators = await platform.listSuperadmins();
    res.status(400).render('console/operators', { operators, currentUserId: String(req.user._id), error: err.message });
  }
});

exports.revokeOperator = h(async (req, res) => {
  await platform.revokeSuperadmin(req.params.id, req.user._id);
  res.redirect('/console/operators');
});

exports.audit = h(async (req, res) => {
  const entries = await platform.recentAudit(150);
  res.render('console/audit', { entries });
});

/* ---- Users (abuse response) ---- */
exports.suspendUser = h(async (req, res) => {
  await platform.suspendUser(req.params.id, req.body.reason, req.user._id);
  res.redirect(req.get('referer') || '/console');
});
exports.reactivateUser = h(async (req, res) => {
  await platform.reactivateUser(req.params.id, req.user._id);
  res.redirect(req.get('referer') || '/console');
});
exports.forceLogout = h(async (req, res) => {
  await platform.forceLogout(req.params.id, req.user._id);
  res.redirect(req.get('referer') || '/console');
});
exports.resetPassword = h(async (req, res) => {
  await platform.sendPasswordReset(req.params.id, req.user._id);
  res.redirect(req.get('referer') || '/console');
});

/* ---- Abuse reports ---- */
exports.reports = h(async (req, res) => {
  const reports = await platform.listReports('open');
  res.render('console/reports', { reports });
});
exports.report = h(async (req, res) => {
  const report = await platform.reportDetail(req.params.id);
  const grants = await platform.listBreakglass();
  res.render('console/report', { report, grants, error: null });
});
exports.resolveReport = h(async (req, res) => {
  await platform.resolveReport(req.params.id, { status: req.body.status, resolution: req.body.resolution }, req.user._id);
  res.redirect('/console/reports');
});

/* ---- Break-glass ---- */
exports.breakglass = h(async (req, res) => {
  const grants = await platform.listBreakglass();
  res.render('console/breakglass', { grants });
});
exports.openBreakglass = h(async (req, res) => {
  await platform.openBreakglass({
    tenantId: req.body.tenantId,
    reportId: req.body.reportId || null,
    justification: req.body.justification,
    hours: Number(req.body.hours) || 24,
  }, req.user._id);
  res.redirect('/console/breakglass');
});
exports.revokeBreakglass = h(async (req, res) => {
  await platform.revokeBreakglass(req.params.id, req.user._id);
  res.redirect('/console/breakglass');
});

exports.breakglassRead = h(async (req, res) => {
  const view = await platform.breakglassRead(req.params.id, req.user._id);
  res.render('console/breakglass-read', view);
});
exports.breakglassLesson = h(async (req, res) => {
  const view = await platform.breakglassLesson(req.params.id, req.params.lessonId, req.user._id);
  res.render('console/breakglass-lesson', { ...view, pick });
});
