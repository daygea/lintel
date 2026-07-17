'use strict';

const svc = require('../../services/enrolment.service');
const { history } = require('../../services/notification');

const h = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

exports.listCohorts = h(async (req, res) => res.json({ cohorts: await svc.listCohorts() }));
exports.createCohort = h(async (req, res) => res.status(201).json({ cohort: await svc.createCohort(req.body) }));
exports.openCohort = h(async (req, res) => res.json({ cohort: await svc.openCohort(req.params.id) }));
exports.closeCohort = h(async (req, res) => res.json({ cohort: await svc.closeCohort(req.params.id) }));

exports.apply = h(async (req, res) =>
  res.status(201).json({ application: await svc.apply({ ...req.body, userId: req.body.userId || req.user._id }) })
);
exports.listApplications = h(async (req, res) =>
  res.json({ applications: await svc.listApplications(req.params.cohortId, req.query.status) })
);
exports.decideApplication = h(async (req, res) =>
  res.json(await svc.decideApplication({ applicationId: req.params.id, ...req.body }))
);

exports.listEnrollments = h(async (req, res) =>
  res.json({ enrollments: await svc.listEnrollments(req.params.cohortId) })
);
exports.setPaymentState = h(async (req, res) =>
  res.json({ enrollment: await svc.setPaymentState(req.params.id, req.body.paymentState) })
);

exports.markLesson = h(async (req, res) => res.json({ progress: await svc.markLesson(req.body) }));
exports.progress = h(async (req, res) => res.json(await svc.progressFor(req.params.enrollmentId)));

exports.listSessions = h(async (req, res) => res.json({ sessions: await svc.listSessions(req.params.cohortId) }));
exports.createSession = h(async (req, res) => res.status(201).json({ session: await svc.createSession(req.body) }));
exports.markAttendance = h(async (req, res) => res.json({ attendance: await svc.markAttendance(req.body) }));
exports.attendance = h(async (req, res) => res.json({ attendance: await svc.attendanceFor(req.params.sessionId) }));

exports.notifications = h(async (req, res) => res.json({ notifications: await history() }));
