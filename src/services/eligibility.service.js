'use strict';

const {
  EligibilityPolicy,
  Lesson,
  Course,
  Enrollment,
  AccessLog,
} = require('../models');
const { evaluate } = require('./eligibility/evaluator');
const { currentUserId } = require('../lib/context');

/* ------------------------------------------------------------------ policies */

const listPolicies = () => EligibilityPolicy.find({}).sort({ slug: 1 }).exec();
const getPolicy = (id) => EligibilityPolicy.findById(id).exec();

async function upsertPolicy(data) {
  if (!data.slug || !data.label || !data.denialMessage) {
    throw new Error('A policy needs a slug, a label and a denial message');
  }
  return EligibilityPolicy.findOneAndUpdate(
    { slug: data.slug },
    data,
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
  ).exec();
}

/* ------------------------------------------------------------- the decision */

/**
 * Resolve which policy governs a lesson: lesson override, else its course.
 * Absent both, enrolment alone suffices (evaluate() returns allowed on an empty
 * policy).
 */
async function policyForLesson(lesson) {
  if (lesson.eligibilityPolicyId) {
    return EligibilityPolicy.findById(lesson.eligibilityPolicyId).exec();
  }
  const course = await Course.findById(lesson.courseId).exec();
  if (course?.eligibilityPolicyId) {
    return EligibilityPolicy.findById(course.eligibilityPolicyId).exec();
  }
  return null;
}

/**
 * May this learner receive this lesson? Evaluates, then WRITES the verdict to the
 * access log — granted or withheld, both recorded, because "the door held" is
 * itself the evidence the policy worked.
 *
 * @returns { allowed, message, failedRules }
 */
async function canAccessLesson({ lessonId, userId, locale = 'en', request = {} }) {
  const uid = userId || currentUserId();
  const lesson = await Lesson.findById(lessonId).exec();
  if (!lesson) return { allowed: false, message: 'No such lesson', failedRules: ['not_found'] };

  const policy = await policyForLesson(lesson);

  const enrollment = await Enrollment.findOne({
    userId: uid,
    courseId: lesson.courseId,
    status: 'active',
  }).exec();

  const verdict = await evaluate(policy, { userId: uid, enrollment, locale });

  await AccessLog.create({
    userId: uid,
    action: verdict.allowed ? 'eligibility_granted' : 'eligibility_withheld',
    policySlug: policy?.slug,
    subjectType: 'Lesson',
    subjectId: lesson._id,
    failedRules: verdict.failedRules,
    ip: request.ip,
    userAgent: request.userAgent,
    sessionId: request.sessionId,
  });

  return verdict;
}

const accessLog = (filter = {}) =>
  AccessLog.find(filter).sort({ at: -1 }).limit(200).exec();

module.exports = {
  listPolicies,
  getPolicy,
  upsertPolicy,
  policyForLesson,
  canAccessLesson,
  accessLog,
};
