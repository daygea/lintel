'use strict';

/**
 * Essay / manual marking. A quiz with an essay lands 'submitted' and doesn't roll
 * up until an assessor marks it; markEssays finalises the attempt and rolls the
 * auto score PLUS the essay marks into the gradebook. Marks clamp to the max.
 */

const { Tenant, User, Course, Quiz, QuizAttempt, LineItem, Score } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const quiz = require('../../src/services/quiz.service');

let tenant, learner;
const as = (fn) => runWithTenant(tenant._id, learner._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-marking', name: 'Alpha', locales: ['en'], status: 'active' });
  learner = await User.create({ email: 'l@x.io', name: 'Ada', passwordHash: await User.hashPassword('x'.repeat(12)) });
});

// Quiz with a 2-pt mcq (option "Yes" correct) and a 5-pt essay. Returns ids.
async function seedAndSubmit() {
  return as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'C' }, status: 'active' });
    const q = await quiz.createQuiz({ courseId: course._id, title: { en: 'Mixed' }, attemptsAllowed: 1 });
    await quiz.addQuestion(q._id, { type: 'mcq', prompt: 'Best?', points: 2, optionText: ['No', 'Yes'], correct: '1' });
    await quiz.addQuestion(q._id, { type: 'essay', prompt: 'Discuss', points: 5 });
    await quiz.setStatus(q._id, 'open');
    const stored = await quiz.getQuiz(q._id);
    const mcqId = String(stored.questions[0]._id);
    const yesId = String(stored.questions[0].options.find((o) => o.correct)._id);
    const essayId = String(stored.questions[1]._id);
    const attempt = await quiz.submit({ quizId: q._id, userId: learner._id, responses: { [mcqId]: yesId, [essayId]: 'my essay' } });
    return { quizId: q._id, attemptId: attempt._id, essayId };
  });
}

it('an essay attempt lands submitted, needs marking, and does not roll up yet', async () => {
  const { quizId, attemptId } = await seedAndSubmit();
  const attempt = await as(() => QuizAttempt.findById(attemptId).exec());
  expect(attempt.status).toBe('submitted');
  expect(attempt.needsManualMarking).toBe(true);
  expect(attempt.autoScore).toBe(2); // mcq only
  const li = await as(() => LineItem.findOne({ quizId }).exec());
  expect(li).toBeNull();
});

it('marking finalises the attempt and rolls up auto + essay marks', async () => {
  const { quizId, attemptId, essayId } = await seedAndSubmit();
  await as(() => quiz.markEssays(attemptId, { [essayId]: 4 }));

  const attempt = await as(() => QuizAttempt.findById(attemptId).exec());
  expect(attempt.status).toBe('marked');
  expect(attempt.needsManualMarking).toBe(false);

  const li = await as(() => LineItem.findOne({ quizId }).exec());
  const score = await as(() => Score.findOne({ lineItemId: li._id, userId: learner._id }).exec());
  expect(score.points).toBe(86); // (2 + 4) / 7 = 85.7 → 86
});

it('clamps an essay mark to the question maximum', async () => {
  const { quizId, attemptId, essayId } = await seedAndSubmit();
  await as(() => quiz.markEssays(attemptId, { [essayId]: 99 })); // max is 5

  const li = await as(() => LineItem.findOne({ quizId }).exec());
  const score = await as(() => Score.findOne({ lineItemId: li._id, userId: learner._id }).exec());
  expect(score.points).toBe(100); // (2 + 5) / 7 = 100%
});

it('lists attempts awaiting marking, and stops listing once marked', async () => {
  const { quizId, attemptId, essayId } = await seedAndSubmit();
  let waiting = await as(() => quiz.listAttemptsToMark(quizId));
  expect(waiting).toHaveLength(1);
  await as(() => quiz.markEssays(attemptId, { [essayId]: 3 }));
  waiting = await as(() => quiz.listAttemptsToMark(quizId));
  expect(waiting).toHaveLength(0);
});
