'use strict';

/**
 * Deleting a cohort refuses while any learner is enrolled, and otherwise removes
 * the cohort with its owned config (sessions, etc.).
 */

const { Tenant, User, Course, Cohort, Enrollment, Session } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const enrolment = require('../../src/services/enrolment.service');

let tenant, learner;
const as = (fn) => runWithTenant(tenant._id, learner._id, fn);

async function seedCohort() {
  return as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'C' }, status: 'active' });
    const cohort = await Cohort.create({ courseId: course._id, title: { en: 'Autumn' }, session: '2026/2027', status: 'draft' });
    return { course, cohort };
  });
}

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-dc', name: 'Alpha', locales: ['en'], status: 'active' });
  learner = await User.create({ email: 'l@x.io', name: 'L', passwordHash: await User.hashPassword('x'.repeat(12)) });
});

it('refuses to delete a cohort with an enrolled learner', async () => {
  const { course, cohort } = await seedCohort();
  await as(() => Enrollment.create({ userId: learner._id, courseId: course._id, cohortId: cohort._id, status: 'active' }));

  await expect(as(() => enrolment.deleteCohort(cohort._id))).rejects.toThrow(/enrolled/i);
  expect(await as(() => Cohort.findById(cohort._id).exec())).toBeTruthy();
});

it('deletes an empty cohort and cascades its sessions', async () => {
  const { cohort } = await seedCohort();
  await as(() => Session.create({ cohortId: cohort._id, title: { en: 'Week 1' }, startsAt: new Date() }));

  const result = await as(() => enrolment.deleteCohort(cohort._id));
  expect(result.deleted).toBe(true);
  expect(await as(() => Cohort.findById(cohort._id).exec())).toBeNull();
  expect(await as(() => Session.countDocuments({ cohortId: cohort._id }).exec())).toBe(0);
});
