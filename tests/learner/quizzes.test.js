'use strict';

/**
 * Learner quiz discovery. myLearning surfaces a course's OPEN quizzes (not draft
 * or closed) with how many attempts the learner has left, so the PWA can offer
 * them. presentFor/submit already exist and are learner-accessible.
 */

const {
  Tenant, User, Membership, Course, Cohort, Enrollment, Quiz, QuizAttempt,
} = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const learner = require('../../src/services/learner.service');

let tenant, user;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-quiz', name: 'Alpha', locales: ['en'], status: 'active' });
  user = await User.create({ email: 'l@x.io', name: 'Ada', passwordHash: await User.hashPassword('x'.repeat(12)) });
  await as(() => Membership.create({ userId: user._id, roles: ['learner'], status: 'active' }));
});

async function seed() {
  return as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'Course' }, status: 'active' });
    const cohort = await Cohort.create({ courseId: course._id, title: { en: 'R' }, session: '2026/2027' });
    await Enrollment.create({ userId: user._id, courseId: course._id, cohortId: cohort._id, status: 'active' });
    const open = await Quiz.create({
      courseId: course._id, title: { en: 'Open quiz' }, status: 'open', attemptsAllowed: 2, passPercent: 50,
      questions: [{ type: 'mcq', prompt: { en: 'Q1' }, points: 1, options: [{ text: { en: 'a' }, correct: true }, { text: { en: 'b' } }] }],
    });
    await Quiz.create({ courseId: course._id, title: { en: 'Closed quiz' }, status: 'closed', questions: [] });
    await Quiz.create({ courseId: course._id, title: { en: 'Draft quiz' }, status: 'draft', questions: [] });
    return { course, open };
  });
}

it('lists only OPEN quizzes for the enrolled course', async () => {
  const { open } = await seed();
  const home = await as(() => learner.myLearning({ userId: user._id, locale: 'en' }));
  expect(home.courses).toHaveLength(1);
  const quizzes = home.courses[0].quizzes;
  expect(quizzes).toHaveLength(1);
  expect(String(quizzes[0].id)).toBe(String(open._id));
  expect(quizzes[0].questionCount).toBe(1);
  expect(quizzes[0].attemptsAllowed).toBe(2);
  expect(quizzes[0].attemptsUsed).toBe(0);
});

it('reflects attempts already used', async () => {
  const { open } = await seed();
  await as(() => QuizAttempt.create({
    quizId: open._id, userId: user._id, attemptNo: 1, responses: {}, autoScore: 1, maxScore: 1,
    needsManualMarking: false, submittedAt: new Date(), status: 'marked',
  }));
  const home = await as(() => learner.myLearning({ userId: user._id, locale: 'en' }));
  expect(home.courses[0].quizzes[0].attemptsUsed).toBe(1);
});
