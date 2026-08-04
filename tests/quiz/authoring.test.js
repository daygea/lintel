'use strict';

/**
 * Quiz authoring. buildQuestion/addQuestion normalise each type into exactly the
 * fields mark() reads; setStatus guards opening an empty quiz; and an authored
 * mcq round-trips through present (answers stripped) → submit (correctly marked).
 */

const { Tenant, User, Course, Quiz } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const quiz = require('../../src/services/quiz.service');

let tenant, actor;
const as = (fn) => runWithTenant(tenant._id, actor._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-quizauth', name: 'Alpha', locales: ['en'], status: 'active' });
  actor = await User.create({ email: 'a@x.io', name: 'A', passwordHash: await User.hashPassword('x'.repeat(12)) });
});

async function newQuiz() {
  return as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'C' }, status: 'active' });
    return quiz.createQuiz({ courseId: course._id, title: { en: 'Quiz' }, passPercent: 50, attemptsAllowed: 3 });
  });
}

it('builds each question type into the fields mark() reads', async () => {
  const mcq = quiz.buildQuestion({ type: 'mcq', prompt: '2+2?', points: 2, optionText: ['3', '4', '5'], correct: '1' });
  expect(mcq.options.map((o) => o.correct)).toEqual([false, true, false]);
  expect(mcq.points).toBe(2);

  const multi = quiz.buildQuestion({ type: 'multi', prompt: 'Evens?', optionText: ['1', '2', '4'], correct: ['1', '2'] });
  expect(multi.options.map((o) => o.correct)).toEqual([false, true, true]);

  const match = quiz.buildQuestion({ type: 'matching', prompt: 'Match', left: ['a', 'b'], right: ['1', '2'] });
  expect(match.pairs).toEqual([{ left: 'a', right: '1' }, { left: 'b', right: '2' }]);

  const short = quiz.buildQuestion({ type: 'short', prompt: 'Capital?', answers: 'Abuja\nAbeokuta', caseSensitive: 'on' });
  expect(short.answers).toEqual(['Abuja', 'Abeokuta']);
  expect(short.caseSensitive).toBe(true);

  const num = quiz.buildQuestion({ type: 'numeric', prompt: 'Pi?', numericAnswer: '3.14', tolerance: '0.01' });
  expect(num.numericAnswer).toBe(3.14);
  expect(num.tolerance).toBe(0.01);

  const essay = quiz.buildQuestion({ type: 'essay', prompt: 'Discuss' });
  expect(essay.type).toBe('essay');
});

it('rejects an mcq with no correct option and matching with no pairs', () => {
  expect(() => quiz.buildQuestion({ type: 'mcq', prompt: 'q', optionText: ['a', 'b'], correct: '9' })).toThrow(/correct/i);
  expect(() => quiz.buildQuestion({ type: 'matching', prompt: 'q', left: [''], right: [''] })).toThrow(/pair/i);
});

it('will not open a quiz with no questions, but will once one is added', async () => {
  const q = await newQuiz();
  await expect(as(() => quiz.setStatus(q._id, 'open'))).rejects.toThrow(/question/i);
  await as(() => quiz.addQuestion(q._id, { type: 'essay', prompt: 'Discuss', points: 5 }));
  const opened = await as(() => quiz.setStatus(q._id, 'open'));
  expect(opened.status).toBe('open');
});

it('round-trips: authored mcq is stripped on present and marked on submit', async () => {
  const q = await newQuiz();
  await as(() => quiz.addQuestion(q._id, { type: 'mcq', prompt: 'Best?', points: 2, optionText: ['No', 'Yes'], correct: '1' }));
  await as(() => quiz.setStatus(q._id, 'open'));

  const presented = await as(() => quiz.presentFor(q._id));
  // Answers must not travel to the learner.
  expect(presented.questions[0].options.every((o) => o.correct === undefined)).toBe(true);

  // Submit the correct option (id read from the stored quiz).
  const stored = await as(() => quiz.getQuiz(q._id));
  const qid = String(stored.questions[0]._id);
  const correctId = String(stored.questions[0].options.find((o) => o.correct)._id);

  const attempt = await as(() => quiz.submit({ quizId: q._id, userId: actor._id, responses: { [qid]: correctId } }));
  expect(attempt.autoScore).toBe(2);
  expect(attempt.maxScore).toBe(2);
  expect(attempt.needsManualMarking).toBe(false);
});

it('removes a question', async () => {
  const q = await newQuiz();
  const withQ = await as(() => quiz.addQuestion(q._id, { type: 'essay', prompt: 'X' }));
  const qid = String(withQ.questions[0]._id);
  const after = await as(() => quiz.removeQuestion(q._id, qid));
  expect(after.questions).toHaveLength(0);
});
