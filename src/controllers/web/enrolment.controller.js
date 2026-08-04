'use strict';

const svc = require('../../services/enrolment.service');
const curriculum = require('../../services/curriculum.service');
const membership = require('../../services/membership.service');
const commerce = require('../../services/commerce');
const { pick } = require('../../plugins/locale-map');
const { ValidationError } = require('../../lib/errors');

const h = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

exports.listCohorts = h(async (req, res) => {
  const cohorts = await svc.listCohorts();
  const courses = await curriculum.listCourses().catch(() => []);
  res.render('enrolment/cohorts', { cohorts, courses, pick, locale: req.tenant.defaultLocale });
});

exports.showCohort = h(async (req, res) => {
  const [cohort, applications, enrollments, sessions, members, schedules] = await Promise.all([
    svc.getCohort ? svc.getCohort(req.params.id) : null,
    svc.listApplications(req.params.id, 'submitted'),
    svc.listEnrollments(req.params.id),
    svc.listSessions(req.params.id),
    membership.list(),
    commerce.listSchedules(),
  ]);
  // Attach each enrolment's invoice (if any) so the roster can show fee state and
  // offer "raise invoice" where there's none yet.
  const invoiceByEnrollment = {};
  await Promise.all((enrollments || []).map(async (e) => {
    invoiceByEnrollment[String(e._id)] = await commerce.invoiceFor(e._id);
  }));

  const enrolledIds = new Set((enrollments || []).map((e) => String(e.userId?._id || e.userId)));
  const enrollable = (members || []).filter(
    (m) => m.status === 'active' && (m.roles || []).includes('learner') &&
      m.userId && !enrolledIds.has(String(m.userId._id || m.userId))
  );
  res.render('enrolment/cohort', {
    cohortId: req.params.id,
    cohort,
    applications,
    enrollments,
    sessions,
    enrollable,
    schedules,
    invoiceByEnrollment,
    pick,
    locale: req.tenant.defaultLocale,
  });
});

exports.enrolMember = h(async (req, res) => {
  await svc.enrol({ cohortId: req.params.id, userId: req.body.userId });
  res.redirect(`/cohorts/${req.params.id}`);
});

exports.createCohort = h(async (req, res) => {
  if (!req.body.courseId && !req.body.programId) {
    const cohorts = await svc.listCohorts();
    const courses = await curriculum.listCourses().catch(() => []);
    return res.status(400).render('enrolment/cohorts', {
      cohorts, courses, pick, locale: req.tenant.defaultLocale,
      error: 'A cohort must run a course — choose one.',
    });
  }
  const cohort = await svc.createCohort({
    courseId: req.body.courseId || undefined,
    title: localeFromForm(req.body, 'title', req.tenant.locales),
    session: req.body.session,
    code: req.body.code || undefined,
    mode: req.body.mode || 'online',
    capacity: req.body.capacity ? Number(req.body.capacity) : undefined,
  });
  res.redirect(`/cohorts/${cohort._id}`);
});

exports.openCohort = h(async (req, res) => {
  await svc.openCohort(req.params.id);
  res.redirect(`/cohorts/${req.params.id}`);
});

exports.closeCohort = h(async (req, res) => {
  await svc.closeCohort(req.params.id);
  res.redirect(`/cohorts/${req.params.id}`);
});

exports.createSession = h(async (req, res) => {
  if (!req.body.startsAt) throw new ValidationError('A session needs a start date and time.');
  await svc.createSession({
    cohortId: req.params.id,
    title: localeFromForm(req.body, 'title', req.tenant.locales),
    startsAt: new Date(req.body.startsAt),
  });
  res.redirect(`/cohorts/${req.params.id}`);
});

exports.markAttendance = h(async (req, res) => {
  await svc.markAttendance({
    sessionId: req.body.sessionId,
    userId: req.body.userId,
    state: req.body.state,
  });
  res.redirect(`/cohorts/${req.params.id}`);
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

function localeFromForm(body, base, locales) {
  const map = {};
  for (const loc of locales) { const v = body[`${base}_${loc}`]; if (v) map[loc] = v; }
  return map;
}
