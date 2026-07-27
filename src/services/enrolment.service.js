'use strict';

const {
  Cohort,
  Application,
  Enrollment,
  LessonProgress,
  Session,
  Attendance,
  Lesson,
  AuditLog,
} = require('../models');
const { notify } = require('./notification');
const { ValidationError, NotAuthorisedError } = require('../lib/errors');
const { currentUserId } = require('../lib/context');

/* ------------------------------------------------------------------ cohorts */

const listCohorts = (filter = {}) => Cohort.find(filter).sort({ startsAt: -1 }).exec();

const getCohort = (id) => Cohort.findById(id).exec();

async function createCohort(data) {
  if (!data.title || !data.session) throw new ValidationError('A cohort needs a title and a session');
  const cohort = await Cohort.create(data);
  await audit('cohort.created', 'Cohort', cohort._id, { session: cohort.session });
  return cohort;
}

const openCohort = (id) => setCohortStatus(id, 'open');
const closeCohort = (id) => setCohortStatus(id, 'closed');

async function setCohortStatus(id, status) {
  const cohort = await Cohort.findByIdAndUpdate(id, { status }, { new: true }).exec();
  if (!cohort) throw new ValidationError('No such cohort');
  return cohort;
}

/* ------------------------------------------------------------- applications */

async function apply({ cohortId, userId, answers, assetIds }) {
  const cohort = await Cohort.findById(cohortId).exec();
  if (!cohort) throw new ValidationError('No such cohort');
  if (cohort.status !== 'open') throw new ValidationError('Applications are not open for this cohort');

  const now = new Date();
  if (cohort.applicationsCloseAt && now > cohort.applicationsCloseAt) {
    throw new ValidationError('The application window for this cohort has closed');
  }

  // The domain rule "one application per cohort" is enforced HERE, not left to a
  // database index that may or may not have been built. The unique index remains
  // as a backstop against two requests racing between this check and the write.
  const existing = await Application.findOne({ cohortId, userId }).exec();
  if (existing) throw new ValidationError('You have already applied to this cohort');

  try {
    return await Application.create({ cohortId, userId, answers, assetIds });
  } catch (err) {
    if (err.code === 11000) throw new ValidationError('You have already applied to this cohort');
    throw err;
  }
}

const listApplications = (cohortId, status) =>
  Application.find({ cohortId, ...(status ? { status } : {}) })
    .populate('userId', 'name email')
    .sort({ createdAt: 1 })
    .exec();

/**
 * Admission is a person's act. The registrar decides; the software records the
 * decision, the decider, and the moment — and only then creates the enrolment.
 * Money is never consulted here (that is a separate paymentState, read by the
 * eligibility engine in Sprint 3).
 */
async function decideApplication({ applicationId, decision, note, locale = 'en' }) {
  if (!['admitted', 'declined'].includes(decision)) {
    throw new ValidationError('A decision is either admit or decline');
  }

  const application = await Application.findById(applicationId).exec();
  if (!application) throw new ValidationError('No such application');
  if (['admitted', 'declined'].includes(application.status)) {
    throw new ValidationError('That application has already been decided');
  }

  application.status = decision;
  application.decidedByUserId = currentUserId();
  application.decidedAt = new Date();
  application.decisionNote = note;
  await application.save();

  const cohort = await Cohort.findById(application.cohortId).exec();

  let enrollment = null;
  if (decision === 'admitted') {
    enrollment = await Enrollment.create({
      userId: application.userId,
      cohortId: application.cohortId,
      courseId: cohort.courseId,
      status: 'active',
      paymentState: 'unpaid',
    });
  }

  await audit('application.decided', 'Application', application._id, { decision });

  await notify({
    userId: application.userId,
    template: 'application.decided',
    data: { status: decision, cohortTitle: cohort.title?.get?.('en') || 'the programme' },
    channels: ['email', 'sms'],
    locale,
  }).catch(() => {}); // a failed notification must not fail the admission

  return { application, enrollment };
}

/* -------------------------------------------------------------- enrolments */

/**
 * Place a member directly into a cohort — the registrar-initiated counterpart to
 * apply()+decideApplication(). This is what the empty learner home points at:
 * "when a registrar enrols you, your courses appear." Idempotent — a second call
 * for the same person and cohort returns the existing place rather than tripping
 * the unique index. The place starts unpaid; fees compose in the engine, they
 * don't gate here.
 */
async function enrol({ cohortId, userId }) {
  const cohort = await Cohort.findById(cohortId).exec();
  if (!cohort) throw new ValidationError('No such cohort');
  if (!userId) throw new ValidationError('Choose a member to enrol');

  const existing = await Enrollment.findOne({ userId, cohortId }).exec();
  if (existing) return existing;

  const enrollment = await Enrollment.create({
    userId,
    cohortId,
    courseId: cohort.courseId,
    status: 'active',
    paymentState: 'unpaid',
  });
  await audit('enrollment.created', 'Enrollment', enrollment._id, { cohortId, by: 'registrar' });
  return enrollment;
}

const listEnrollments = (cohortId) =>
  Enrollment.find({ cohortId }).populate('userId', 'name email').sort({ enrolledAt: 1 }).exec();

async function setPaymentState(enrollmentId, paymentState) {
  const valid = ['unpaid', 'deposit', 'part', 'full', 'waived'];
  if (!valid.includes(paymentState)) throw new ValidationError('Unknown payment state');
  const enrollment = await Enrollment.findByIdAndUpdate(
    enrollmentId,
    { paymentState },
    { new: true }
  ).exec();
  if (!enrollment) throw new ValidationError('No such enrolment');
  await audit('enrollment.payment_state', 'Enrollment', enrollment._id, { paymentState });
  return enrollment;
}

/* ----------------------------------------------------------------- progress */

async function markLesson({ enrollmentId, lessonId, state, secondsSpent }) {
  const lesson = await Lesson.findById(lessonId).exec();
  if (!lesson) throw new ValidationError('No such lesson');

  return LessonProgress.findOneAndUpdate(
    { enrollmentId, lessonId },
    {
      state,
      completedAt: state === 'complete' ? new Date() : undefined,
      ...(secondsSpent ? { $inc: { secondsSpent } } : {}),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).exec();
}

async function progressFor(enrollmentId) {
  const rows = await LessonProgress.find({ enrollmentId }).exec();
  const complete = rows.filter((r) => r.state === 'complete').length;
  return { total: rows.length, complete, rows };
}

/* ------------------------------------------------------ sessions & attendance */

const listSessions = (cohortId) =>
  Session.find({ cohortId }).sort({ startsAt: 1 }).exec();

const createSession = (data) => Session.create(data);

/** Idempotent: ticking a name twice updates, never duplicates. */
async function markAttendance({ sessionId, userId, state, note }) {
  return Attendance.findOneAndUpdate(
    { sessionId, userId },
    { state, note, recordedByUserId: currentUserId(), recordedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).exec();
}

const attendanceFor = (sessionId) =>
  Attendance.find({ sessionId }).populate('userId', 'name email').exec();

/* ------------------------------------------------------------------- helper */

const audit = (action, subjectType, subjectId, meta) =>
  AuditLog.create({ actorUserId: currentUserId(), action, subjectType, subjectId, meta });

module.exports = {
  listCohorts,
  getCohort,
  createCohort,
  openCohort,
  closeCohort,
  apply,
  listApplications,
  decideApplication,
  enrol,
  listEnrollments,
  setPaymentState,
  markLesson,
  progressFor,
  listSessions,
  createSession,
  markAttendance,
  attendanceFor,
};
