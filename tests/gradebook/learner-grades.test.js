'use strict';

/**
 * Learner "My grades" view (Oct-2026, P2). learnerGrades is line-item centric and
 * honest: it lists each PUBLISHED graded item per active enrolment with the
 * learner's score, marks the rest "not yet graded", and reports an average of the
 * graded items only. It does NOT invent an official weighted grade.
 */

const {
  Tenant, User, Membership, Course, Cohort, Enrollment,
  GradeScheme, LineItem, Score,
} = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const gb = require('../../src/services/gradebook.service');

let tenant, staff, learner, course, cohort;
const as = (fn) => runWithTenant(tenant._id, staff._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'grades', name: 'Institute', locales: ['en'], defaultLocale: 'en', status: 'active' });
  staff = await User.create({ email: 's@x.com', name: 'Staff', passwordHash: 'x', status: 'active' });
  learner = await User.create({ email: 'l@x.com', name: 'Learner', passwordHash: 'x', status: 'active' });
  await as(async () => {
    await Membership.create({ userId: staff._id, roles: ['registrar'], status: 'active' });
    course = await Course.create({ code: 'C1', title: { en: 'Intro' } });
    cohort = await Cohort.create({ courseId: course._id, title: { en: '2026' }, session: '2026/2027' });
    await Enrollment.create({ userId: learner._id, cohortId: cohort._id, courseId: course._id, status: 'active' });
  });
});

it('lists graded and ungraded published items with an average of graded only', async () => {
  const data = await as(async () => {
    const exam = await gb.createLineItem({ courseId: course._id, label: { en: 'Final' }, category: 'exam', maxPoints: 100, published: true });
    await gb.createLineItem({ courseId: course._id, label: { en: 'Essay' }, category: 'cw', maxPoints: 100, published: true });
    await gb.putScore({ lineItemId: exam._id, userId: learner._id, points: 80 });
    return gb.learnerGrades(learner._id, 'en');
  });

  expect(data.courses).toHaveLength(1);
  const c = data.courses[0];
  expect(c.total).toBe(2);
  expect(c.gradedCount).toBe(1);
  expect(c.averageOfGraded).toBe(80); // only the one graded item counts

  const graded = c.items.find((i) => i.graded);
  const pending = c.items.find((i) => !i.graded);
  expect(graded.points).toBe(80);
  expect(graded.percent).toBe(80);
  expect(pending.points).toBe(null);
  expect(pending.percent).toBe(null);
});

it('excludes unpublished line items', async () => {
  const data = await as(async () => {
    await gb.createLineItem({ courseId: course._id, label: { en: 'Draft' }, category: 'exam', maxPoints: 100, published: false });
    await gb.createLineItem({ courseId: course._id, label: { en: 'Quiz' }, category: 'quizzes', maxPoints: 100, published: true });
    return gb.learnerGrades(learner._id, 'en');
  });

  expect(data.courses[0].total).toBe(1);
  expect(data.courses[0].items[0].label).toBe('Quiz');
});

it('omits courses with no published line items', async () => {
  const data = await as(() => gb.learnerGrades(learner._id, 'en'));
  expect(data.courses).toHaveLength(0);
});
