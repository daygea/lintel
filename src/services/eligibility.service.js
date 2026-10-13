'use strict';

const {
  EligibilityPolicy,
  Lesson,
  Course,
  Enrollment,
  AccessLog,
  Tenant,
  Membership,
  AttestationType,
  Assessment,
} = require('../models');
const { evaluate } = require('./eligibility/evaluator');
const { pick } = require('../plugins/locale-map');
const { currentUserId, currentTenantId } = require('../lib/context');

/* ------------------------------------------------------------------ policies */

const listPolicies = () => EligibilityPolicy.find({}).sort({ slug: 1 }).exec();
const getPolicy = (id) => EligibilityPolicy.findById(id).exec();

async function upsertPolicy(data) {
  if (!data.slug || !data.label || !data.denialMessage) {
    throw new Error('A policy needs a slug, a label and a denial message');
  }
  // Load-or-new + Object.assign + save: label and denialMessage are locale Maps, and
  // a query-update (findOneAndUpdate) neither casts a plain object into a Map nor runs
  // the localeMap validate hook that builds the search shadow — so editing a policy's
  // label/message through the update path silently dropped them. save() does both.
  const existing = await EligibilityPolicy.findOne({ slug: data.slug }).exec();
  const policy = existing || new EligibilityPolicy({ slug: data.slug });
  Object.assign(policy, data);
  await policy.save();
  return policy;
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
 * Evaluate the verdict for a lesson WITHOUT logging it. Used by the learner
 * home to show the door state (open/held) across a whole course at a glance —
 * browsing is not accessing, so it must not write an AccessLog entry per lesson.
 * canAccessLesson() is this plus the log, so the two can never drift.
 */
async function previewAccess({ lesson, userId, locale = 'en' }) {
  const policy = await policyForLesson(lesson);
  const enrollment = await Enrollment.findOne({
    userId,
    courseId: lesson.courseId,
    status: 'active',
  }).exec();

  // Implicit baseline rule: when NO eligibility policy governs the lesson, access
  // still requires an ACTIVE enrolment in the course. The evaluator correctly treats
  // an empty policy as "no rules to fail" (= allowed) and that purity stays intact —
  // but a lesson with no policy must not therefore be open to every institution
  // member. "Enrolment alone suffices" means enrolment is still required. Fail closed.
  const hasPolicy = policy && Array.isArray(policy.rules) && policy.rules.length > 0;
  if (!hasPolicy) {
    if (enrollment) return { verdict: { allowed: true, failedRules: [], message: '' }, policy };

    // No enrolment and no policy: by default fail closed. An institution may opt in
    // (Settings → Access) to let any active member open un-gated "open teaching".
    const tenant = await Tenant.findById(currentTenantId()).exec();
    if (tenant?.access?.openLessonsForMembers) {
      const member = await Membership.findOne({ userId, status: 'active' }).exec();
      if (member) return { verdict: { allowed: true, failedRules: [], message: '' }, policy };
    }
    return {
      verdict: { allowed: false, failedRules: ['enrolled'], message: 'You need to be enrolled in this course to open this lesson.' },
      policy,
    };
  }

  const verdict = await evaluate(policy, { userId, enrollment, locale });
  return { verdict, policy };
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

  const { verdict, policy } = await previewAccess({ lesson, userId: uid, locale });

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

/* ---------------------------------------------------- explain (learner panel) */

const humanise = (s) => String(s || '').replace(/[-_]+/g, ' ').trim() || 'a requirement';

/**
 * Turn one policy rule into a plain requirement the learner can read: is it met,
 * what it asks for, and how to satisfy it. Labels for attestations, prerequisite
 * courses and assessments are resolved to their human names; everything else is
 * static, institution-neutral copy.
 */
async function requirementFor(rule, failedRules, locale) {
  const met = !failedRules.includes(rule.type);
  const p = rule.params || {};
  const base = { type: rule.type, met };

  switch (rule.type) {
    case 'enrolled':
      return { ...base, title: 'Be enrolled in this course',
        how: 'Apply from the course catalogue, or ask a registrar to enrol you.' };
    case 'attestation': {
      let label = humanise(p.typeSlug);
      if (p.typeSlug) {
        const t = await AttestationType.findOne({ slug: p.typeSlug }).exec();
        if (t) label = pick(t.label, locale);
      }
      return { ...base, title: `Hold the standing: ${label}`,
        how: 'A member of the institution records this standing for you — ask your registrar or teacher.' };
    }
    case 'membership_role':
      return { ...base, title: `Be a ${humanise(p.role)}`,
        how: 'This teaching is reserved for that role. Contact the institution if it applies to you.' };
    case 'course_completed': {
      let name = 'the prerequisite course';
      if (p.courseId) { const c = await Course.findById(p.courseId).exec(); if (c) name = pick(c.title, locale); }
      return { ...base, title: `Complete ${name}`,
        how: 'Finish the prerequisite course first — this opens automatically once you do.' };
    }
    case 'manual_approval':
      return { ...base, title: 'Receive approval',
        how: 'A named approver must grant this. Ask your registrar to review your case.' };
    case 'assessment_score': {
      let name = 'the assessment';
      const min = p.minPercent ?? 50;
      if (p.assessmentId) { const a = await Assessment.findById(p.assessmentId).exec(); if (a) name = pick(a.title, locale); }
      return { ...base, title: `Pass ${name} (at least ${min}%)`,
        how: 'Submit and pass the assessment to open this.' };
    }
    case 'payment_state': {
      const bar = p.atLeast || 'part';
      const human = { deposit: 'a deposit', part: 'part of the fee', full: 'the fee in full' }[bar] || bar;
      return { ...base, title: `Pay ${human}`,
        how: 'Settle your fees on the Fees & payments page — access opens once payment clears.',
        href: '/my/fees' };
    }
    default:
      return { ...base, title: 'Meet an institution requirement',
        how: 'Contact the institution for details.' };
  }
}

/**
 * The learner-facing "why is this held, and what unlocks it" breakdown for a lesson.
 * Read-only (no access log — previewAccess is the no-log path). Returns held:false
 * when the lesson is open, so the caller can skip the panel.
 */
async function explain({ lesson, userId, locale = 'en' }) {
  const uid = userId || currentUserId();
  const { verdict, policy } = await previewAccess({ lesson, userId: uid, locale });
  if (verdict.allowed) return { held: false, requirements: [], combinator: 'all', message: '' };

  // A real policy lists its rules; the implicit baseline is a single "enrolled" rule.
  const rules = policy && Array.isArray(policy.rules) && policy.rules.length
    ? policy.rules
    : [{ type: 'enrolled' }];

  const requirements = [];
  for (const rule of rules) requirements.push(await requirementFor(rule, verdict.failedRules || [], locale));

  return {
    held: true,
    message: verdict.message,
    combinator: (policy && policy.combinator) || 'all', // 'all' = need every item; 'any' = any one
    requirements,
  };
}

module.exports = {
  listPolicies,
  getPolicy,
  upsertPolicy,
  policyForLesson,
  previewAccess,
  canAccessLesson,
  explain,
  accessLog,
};
