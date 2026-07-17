'use strict';

const svc = require('../../services/enrolment.service');
const { pick } = require('../../plugins/locale-map');

const h = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

exports.listCohorts = h(async (req, res) => {
  const cohorts = await svc.listCohorts();
  res.render('enrolment/cohorts', { cohorts, pick, locale: req.tenant.defaultLocale });
});

exports.showCohort = h(async (req, res) => {
  const [applications, enrollments, sessions] = await Promise.all([
    svc.listApplications(req.params.id, 'submitted'),
    svc.listEnrollments(req.params.id),
    svc.listSessions(req.params.id),
  ]);
  res.render('enrolment/cohort', {
    cohortId: req.params.id,
    applications,
    enrollments,
    sessions,
    pick,
    locale: req.tenant.defaultLocale,
  });
});

exports.decideApplication = h(async (req, res) => {
  await svc.decideApplication({
    applicationId: req.params.id,
    decision: req.body.decision,
    note: req.body.note,
    locale: req.tenant.defaultLocale,
  });
  res.redirect(`/cohorts/${req.body.cohortId}`);
});
