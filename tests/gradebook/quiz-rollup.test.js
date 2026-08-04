'use strict';

/**
 * Quiz → gradebook roll-up. A fully-marked submission posts the learner's BEST
 * attempt (as a percentage) onto the quiz's line item. A quiz with no course, or
 * an attempt still needing manual marking, doesn't roll up.
 */

const { Tenant, User, Course, Quiz, LineItem, Score } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const quiz = require('../../src/services/quiz.service');

let tenant, learner;
const as = (fn) => runWithTenant(tenant._id, learner._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-rollup', name: 'Alpha', locales: ['en'], status: 'active' });
  learner = await User.create({ email: 'l@x.io', name: 'Ada', passwordHash: await User.hashPassword('x'.repeat(12)) });
});

// A course-linked quiz with one 2-point mcq (option "Yes" correct), N attempts.
async function seedMcqQuiz({ courseId = undefined, attemptsAllowed = 3 } = {}) {
  return as(async () => {
    const course = courseId === null ? null : await Course.create({ code: 'C1', title: { en: 'C' }, status: 'active' });
    const q = await quiz.createQuiz({ courseId: course ? course._id : undefined, title: { en: 'Check' }, attemptsAllowed });
    await quiz.addQuestion(q._id, { type: 'mcq', prompt: 'Best?', points: 2, optionText: ['No', 'Yes'], correct: '1' });
    await quiz.setStatus(q._id, 'open');
    const stored = await quiz.getQuiz(q._id);
    const qid = String(stored.questions[0]._id);
    const yesId = String(stored.questions[0].options.find((o) => o.correct)._id);
    const noId = String(stored.questions[0].options.find((o) => !o.correct)._id);
    return { quizId: q._id, qid, yesId, noId };
  });
}

it('rolls a marked submission into a quiz line item and score', async () => {
  const { quizId, qid, yesId } = await seedMcqQuiz();
  await as(() => quiz.submit({ quizId, userId: learner._id, responses: { [qid]: yesId } }));

  const li = await as(() => LineItem.findOne({ quizId }).exec());
  expect(li).toBeTruthy();
  expect(li.source).toBe('quiz');
  expect(li.category).toBe('quizzes');
  expect(li.maxPoints).toBe(100);

  const score = await as(() => Score.findOne({ lineItemId: li._id, userId: learner._id }).exec());
  expect(score.points).toBe(100); // 2/2 = 100%
});

it('keeps the BEST attempt — a weaker later attempt does not lower the score', async () => {
  const { quizId, qid, yesId, noId } = await seedMcqQuiz();
  await as(() => quiz.submit({ quizId, userId: learner._id, responses: { [qid]: yesId } })); // 100%
  await as(() => quiz.submit({ quizId, userId: learner._id, responses: { [qid]: noId } }));  // 0%

  const li = await as(() => LineItem.findOne({ quizId }).exec());
  const score = await as(() => Score.findOne({ lineItemId: li._id, userId: learner._id }).exec());
  expect(score.points).toBe(100);
});

it('does not roll up a quiz with no course', async () => {
  const { quizId, qid, yesId } = await seedMcqQuiz({ courseId: null });
  await as(() => quiz.submit({ quizId, userId: learner._id, responses: { [qid]: yesId } }));
  const li = await as(() => LineItem.findOne({ quizId }).exec());
  expect(li).toBeNull();
});

it('does not roll up an attempt awaiting manual marking (essay)', async () => {
  const q = await as(async () => {
    const course = await Course.create({ code: 'C2', title: { en: 'C' }, status: 'active' });
    const quizDoc = await quiz.createQuiz({ courseId: course._id, title: { en: 'Essay' }, attemptsAllowed: 1 });
    await quiz.addQuestion(quizDoc._id, { type: 'essay', prompt: 'Discuss', points: 5 });
    await quiz.setStatus(quizDoc._id, 'open');
    return quizDoc;
  });
  const stored = await as(() => quiz.getQuiz(q._id));
  const qid = String(stored.questions[0]._id);
  await as(() => quiz.submit({ quizId: q._id, userId: learner._id, responses: { [qid]: 'my essay' } }));

  const li = await as(() => LineItem.findOne({ quizId: q._id }).exec());
  expect(li).toBeNull(); // no fully-marked attempt yet
});
