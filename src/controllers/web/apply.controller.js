'use strict';

const svc = require('../../services/enrolment.service');
const { pick } = require('../../plugins/locale-map');

const h = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

// Compose the open cohorts with this learner's relationship to each (already
// enrolled, already applied — and the application's status), plus the full list of
// their applications so they can track outcomes.
async function build(req) {
  const userId = req.user._id;
  const [open, apps, enrollments] = await Promise.all([
    svc.listOpenCohorts(),
    svc.applicationsForUser(userId),
    svc.enrollmentsForUser(userId),
  ]);
  const appByCohort = new Map(apps.map((a) => [String(a.cohortId && a.cohortId._id ? a.cohortId._id : a.cohortId), a]));
  const enrolledCohorts = new Set(enrollments.map((e) => String(e.cohortId)));
  const cohorts = open.map((c) => ({
    cohort: c,
    application: appByCohort.get(String(c._id)) || null,
    enrolled: enrolledCohorts.has(String(c._id)),
  }));
  return { cohorts, applications: apps };
}

exports.show = h(async (req, res) => {
  const data = await build(req);
  res.render('apply/index', {
    ...data, pick,
    locale: req.tenant.defaultLocale,
    applied: req.query.applied || null,
    error: req.query.err || null,
  });
});

exports.submit = h(async (req, res) => {
  try {
    await svc.apply({ cohortId: req.body.cohortId, userId: req.user._id });
    res.redirect('/apply?applied=1');
  } catch (err) {
    if (err.status === 422 || err.name === 'ValidationError') {
      return res.redirect(`/apply?err=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
});
