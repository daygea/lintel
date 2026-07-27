'use strict';

/**
 * Load every rule file. Requiring a rule file registers it.
 *
 * ctx passed to each rule: { userId, enrollment, now }.
 * Rules resolve their own data (attestations, grades) inside the tenant context
 * that is already active — they never take a tenantId.
 */
const { register } = require('../registry');
const { Enrollment, Attestation, Membership, LessonProgress, Lesson, Submission, Grade } = require('../../../models');

/* enrolled — the learner has an active enrolment in scope */
register('enrolled', async (_params, ctx) => {
  if (ctx.enrollment) return ctx.enrollment.status === 'active';
  const e = await Enrollment.findOne({ userId: ctx.userId, status: 'active' }).exec();
  return !!e;
});

/* attestation — holds a current, unexpired attestation of a given type */
register('attestation', async (params, ctx) => {
  const { typeSlug, valueIn, mustBeUnexpired = true } = params || {};
  if (!typeSlug) return false;

  // "Current" = latest record for (subject, type); active; not expired.
  const latest = await Attestation.findOne({ subjectUserId: ctx.userId, typeSlug })
    .sort({ createdAt: -1 })
    .exec();

  if (!latest || latest.status !== 'active') return false;
  if (mustBeUnexpired && latest.expiresAt && latest.expiresAt < ctx.now) return false;
  if (Array.isArray(valueIn) && valueIn.length && !valueIn.includes(latest.value)) return false;
  return true;
});

/* membership_role — the learner holds a given role in this institution */
register('membership_role', async (params, ctx) => {
  const { role } = params || {};
  if (!role) return false;
  const m = await Membership.findOne({ userId: ctx.userId, status: 'active' }).exec();
  return !!m && m.roles.includes(role);
});

/* course_completed — completed a course, optionally above a lesson-completion bar */
register('course_completed', async (params, ctx) => {
  const { courseId, minCompletionPct = 100 } = params || {};
  if (!courseId) return false;

  const enrollment = await Enrollment.findOne({ userId: ctx.userId, courseId }).exec();
  if (!enrollment) return false;
  if (enrollment.status === 'completed') return true;

  const lessons = await Lesson.countDocuments({ courseId }).exec();
  if (lessons === 0) return false;
  const done = await LessonProgress.countDocuments({
    enrollmentId: enrollment._id,
    state: 'complete',
  }).exec();

  return (done / lessons) * 100 >= minCompletionPct;
});

/* manual_approval — a named approver has granted an attestation used as a flag */
register('manual_approval', async (params, ctx) => {
  const { approvalSlug } = params || {};
  if (!approvalSlug) return false;
  const a = await Attestation.findOne({
    subjectUserId: ctx.userId,
    typeSlug: approvalSlug,
    status: 'active',
  })
    .sort({ createdAt: -1 })
    .exec();
  return !!a && a.status === 'active';
});

/*
 * assessment_score — passes when the learner's FINAL grade on an assessment meets
 * a threshold. Registered in Sprint 5a. Note what did NOT change to add it: the
 * evaluator. That is ADR-008 working — a new rule is a new register() call, not a
 * modification of the thing that runs the rules.
 */
register('assessment_score', async (params, ctx) => {
  const { assessmentId, minPercent = 50 } = params || {};
  if (!assessmentId) return false;

  const submissions = await Submission.find({ assessmentId, userId: ctx.userId })
    .sort({ attemptNo: -1 })
    .exec();
  if (!submissions.length) return false;

  // Consider the best attempt's final (or latest) grade.
  let best = 0;
  for (const sub of submissions) {
    const final = await Grade.findOne({ submissionId: sub._id, isFinal: true })
      .sort({ createdAt: -1 })
      .exec();
    const grade = final || (await Grade.findOne({ submissionId: sub._id }).sort({ createdAt: -1 }).exec());
    if (grade && grade.totalPoints > best) best = grade.totalPoints;
  }

  // params.maxScore lets a policy express the threshold as a percentage of the
  // rubric's maximum; absent it, minPercent is treated as an absolute point bar.
  const denom = params.maxScore || 100;
  return (best / denom) * 100 >= minPercent;
});

/*
 * payment_state — passes when the learner's enrolment payment has reached at least
 * the required level. Registered in Sprint 6. As with assessment_score, adding it
 * touched no line of the evaluator (ADR-008) — it is a register() call and nothing
 * more. This was the last deferred rule; the registry is now complete for the MVP.
 *
 * The ordering unpaid < deposit < part < full, with 'waived' treated as fully
 * satisfied (a scholarship is not a lesser standing). params.atLeast names the bar.
 */
const PAYMENT_ORDER = { unpaid: 0, deposit: 1, part: 2, full: 3 };
register('payment_state', async (params, ctx) => {
  const { atLeast = 'part', courseId } = params || {};
  const filter = { userId: ctx.userId, status: 'active' };
  if (courseId) filter.courseId = courseId;

  const enrollment = ctx.enrollment && (!courseId || String(ctx.enrollment.courseId) === String(courseId))
    ? ctx.enrollment
    : await Enrollment.findOne(filter).exec();
  if (!enrollment) return false;

  if (enrollment.paymentState === 'waived') return true; // a scholarship satisfies any bar
  const have = PAYMENT_ORDER[enrollment.paymentState] ?? 0;
  const need = PAYMENT_ORDER[atLeast] ?? 2;
  return have >= need;
});
