'use strict';

/**
 * Deleting a quiz removes its attempts and the gradebook line item it fed, along
 * with the scores on that line item.
 */

const { Tenant, User, Course, Quiz, QuizAttempt, LineItem, Score } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const quizSvc = require('../../src/services/quiz.service');

let tenant, learner;
const as = (fn) => runWithTenant(tenant._id, learner._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-dquiz', name: 'Alpha', locales: ['en'], status: 'active' });
  learner = await User.create({ email: 'l@x.io', name: 'L', passwordHash: await User.hashPassword('x'.repeat(12)) });
});

it('deletes a quiz with its attempts, line item, and scores', async () => {
  const ids = await as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'C' }, status: 'active' });
    const quiz = await Quiz.create({ courseId: course._id, title: { en: 'Q' }, status: 'open' });
    await QuizAttempt.create({ quizId: quiz._id, userId: learner._id, status: 'marked', autoScore: 2, maxScore: 2 });
    const li = await LineItem.create({ courseId: course._id, label: { en: 'Q' }, category: 'quizzes', source: 'quiz', quizId: quiz._id, maxPoints: 100, published: true });
    await Score.create({ lineItemId: li._id, userId: learner._id, points: 100 });
    return { quizId: quiz._id, lineItemId: li._id };
  });

  const result = await as(() => quizSvc.deleteQuiz(ids.quizId));
  expect(result.deleted).toBe(true);
  expect(await as(() => Quiz.findById(ids.quizId).exec())).toBeNull();
  expect(await as(() => QuizAttempt.countDocuments({ quizId: ids.quizId }).exec())).toBe(0);
  expect(await as(() => LineItem.findById(ids.lineItemId).exec())).toBeNull();
  expect(await as(() => Score.countDocuments({ lineItemId: ids.lineItemId }).exec())).toBe(0);
});
