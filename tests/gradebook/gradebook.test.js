'use strict';

/**
 * Sprint 5b exit criteria:
 *   - a weighted overall grade matches a hand-computed figure
 *   - drop-lowest works
 *   - an override is attributed (who + when) and audited
 *   - every gradable thing is a LineItem (the LTI-native claim)
 *   - a quiz auto-marks and an essay flags for manual marking
 */

const {
  Tenant, User, Membership, Course,
  GradeScheme, LineItem, Score, Quiz, QuizAttempt, AuditLog,
} = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const gb = require('../../src/services/gradebook.service');
const quizSvc = require('../../src/services/quiz.service');

let tenant, staff, learner, course;
const as = (fn) => runWithTenant(tenant._id, staff._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'inst', name: 'Institute', locales: ['en'] });
  staff = await User.create({ email: 's@x.com', name: 'Staff', passwordHash: 'x', status: 'active' });
  learner = await User.create({ email: 'l@x.com', name: 'Learner', passwordHash: 'x', status: 'active' });
  await as(async () => {
    await Membership.create({ userId: staff._id, roles: ['registrar'], status: 'active' });
    course = await Course.create({ code: 'C1', title: { en: 'Course' } });
  });
});

describe('weighted grade compute', () => {
  it('matches a hand-computed figure', async () => {
    const result = await as(async () => {
      await gb.upsertScheme({
        slug: 'std', label: { en: 'Standard' }, passPercent: 50,
        categories: [
          { key: 'exam', label: { en: 'Exam' }, weight: 70 },
          { key: 'cw', label: { en: 'Coursework' }, weight: 30 },
        ],
        bands: [{ label: { en: 'Pass' }, minPercent: 50 }, { label: { en: 'Distinction' }, minPercent: 80 }],
      });

      const exam = await gb.createLineItem({ courseId: course._id, label: { en: 'Final' }, category: 'exam', maxPoints: 100 });
      const cw = await gb.createLineItem({ courseId: course._id, label: { en: 'Essay' }, category: 'cw', maxPoints: 100 });

      await gb.putScore({ lineItemId: exam._id, userId: learner._id, points: 80 }); // 80% of 70 = 56
      await gb.putScore({ lineItemId: cw._id, userId: learner._id, points: 60 });   // 60% of 30 = 18

      return gb.computeForLearner({ courseId: course._id, userId: learner._id, schemeSlug: 'std' });
    });

    // 56 + 18 = 74
    expect(result.overallPercent).toBe(74);
    expect(result.passed).toBe(true);
    expect(result.band).toBe('Pass');
  });

  it('drops the lowest score in a category', async () => {
    const result = await as(async () => {
      await gb.upsertScheme({
        slug: 'drop', label: { en: 'Drop' }, passPercent: 50,
        categories: [{ key: 'quiz', label: { en: 'Quizzes' }, weight: 100, dropLowest: 1 }],
        bands: [],
      });
      const q1 = await gb.createLineItem({ courseId: course._id, label: { en: 'Q1' }, category: 'quiz', maxPoints: 100 });
      const q2 = await gb.createLineItem({ courseId: course._id, label: { en: 'Q2' }, category: 'quiz', maxPoints: 100 });
      const q3 = await gb.createLineItem({ courseId: course._id, label: { en: 'Q3' }, category: 'quiz', maxPoints: 100 });
      await gb.putScore({ lineItemId: q1._id, userId: learner._id, points: 20 }); // dropped
      await gb.putScore({ lineItemId: q2._id, userId: learner._id, points: 80 });
      await gb.putScore({ lineItemId: q3._id, userId: learner._id, points: 90 });
      return gb.computeForLearner({ courseId: course._id, userId: learner._id, schemeSlug: 'drop' });
    });
    // drop the 20, average 80 & 90 = 85
    expect(result.overallPercent).toBe(85);
  });
});

describe('score overrides', () => {
  it('are attributed and audited', async () => {
    const { score } = await as(async () => {
      const li = await gb.createLineItem({ courseId: course._id, label: { en: 'X' }, category: 'x', maxPoints: 100 });
      await gb.putScore({ lineItemId: li._id, userId: learner._id, points: 50 });
      const score = await gb.putScore({ lineItemId: li._id, userId: learner._id, points: 65, override: true, note: 'remarked' });
      return { score };
    });
    expect(String(score.overriddenByUserId)).toBe(String(staff._id));
    expect(score.overrideNote).toBe('remarked');

    const audit = await as(() => AuditLog.find({ action: 'score.overridden' }).exec());
    expect(audit.length).toBe(1);
    expect(audit[0].meta.was).toBe(50);
    expect(audit[0].meta.points).toBe(65);
  });
});

describe('quiz auto-marking end to end', () => {
  it('marks objective questions and flags an essay for manual marking', async () => {
    const attempt = await as(async () => {
      const quiz = await Quiz.create({
        courseId: course._id, title: { en: 'Q' }, status: 'open', attemptsAllowed: 1,
        questions: [
          { type: 'mcq', prompt: { en: '2+2?' }, points: 1, options: [{ text: { en: '4' }, correct: true }, { text: { en: '5' }, correct: false }] },
          { type: 'essay', prompt: { en: 'Discuss.' }, points: 5 },
        ],
      });
      const mcqId = String(quiz.questions[0]._id);
      const correctOpt = String(quiz.questions[0].options[0]._id);
      return quizSvc.submit({ quizId: quiz._id, userId: learner._id, responses: { [mcqId]: correctOpt } });
    });

    expect(attempt.autoScore).toBe(1);
    expect(attempt.maxScore).toBe(6);
    expect(attempt.needsManualMarking).toBe(true);
    expect(attempt.status).toBe('submitted'); // not fully marked — essay pending
  });

  it('a quiz presented to a learner carries no answer keys', async () => {
    const presented = await as(async () => {
      const quiz = await Quiz.create({
        courseId: course._id, title: { en: 'Q' }, status: 'open',
        questions: [{ type: 'mcq', prompt: { en: 'x' }, options: [{ text: { en: 'a' }, correct: true }, { text: { en: 'b' }, correct: false }] }],
      });
      return quizSvc.presentFor(quiz._id);
    });
    const opt = presented.questions[0].options[0];
    expect(opt).not.toHaveProperty('correct');
    expect(opt).toHaveProperty('text');
  });
});

describe('the LTI-native claim', () => {
  it('an assessment-sourced and a manual line item are the same kind of row', async () => {
    const items = await as(async () => {
      await gb.createLineItem({ courseId: course._id, label: { en: 'From assessment' }, category: 'oral', source: 'assessment', maxPoints: 3 });
      await gb.createLineItem({ courseId: course._id, label: { en: 'Manual column' }, category: 'part', source: 'manual', maxPoints: 10 });
      return gb.listLineItems(course._id);
    });
    expect(items).toHaveLength(2);
    // both are LineItems — an LTI line item would be a third with source:'lti'
    expect(items.every((i) => i.maxPoints > 0)).toBe(true);
  });
});
