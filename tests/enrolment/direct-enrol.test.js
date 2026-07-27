'use strict';

/**
 * Registrar direct-enrol (enrolment.service.enrol).
 * The registrar-initiated path into a cohort — makes the empty learner home's
 * promise real: "when a registrar enrols you, your courses appear." Idempotent,
 * and the enrolled course then shows up in the learner's myLearning.
 */

const { Tenant, User, Membership, Course, Module, Lesson, Cohort, Enrollment } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const enrolment = require('../../src/services/enrolment.service');
const learner = require('../../src/services/learner.service');

let tenant, user;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-enrol', name: 'Alpha', locales: ['en'], status: 'active' });
  user = await User.create({ email: 'l@x.io', name: 'Ada', passwordHash: await User.hashPassword('x'.repeat(12)) });
  await runWithTenant(tenant._id, user._id, async () => {
    await Membership.create({ userId: user._id, roles: ['learner'], status: 'active' });
  });
});

async function seedCohort() {
  return as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'Foundations' }, status: 'active' });
    const mod = await Module.create({ courseId: course._id, title: { en: 'M1' }, order: 0 });
    await Lesson.create({ moduleId: mod._id, courseId: course._id, title: { en: 'Lesson 1' }, order: 0 });
    const cohort = await Cohort.create({ courseId: course._id, title: { en: 'Intake A' }, session: '2026/2027' });
    return { course, cohort };
  });
}

it('creates an active enrolment and the course appears in the learner home', async () => {
  const { cohort } = await seedCohort();
  await as(() => enrolment.enrol({ cohortId: cohort._id, userId: user._id }));

  const enr = await as(() => Enrollment.findOne({ userId: user._id, cohortId: cohort._id }).exec());
  expect(enr.status).toBe('active');
  expect(enr.paymentState).toBe('unpaid');

  const home = await as(() => learner.myLearning({ userId: user._id, locale: 'en' }));
  expect(home.courses).toHaveLength(1);
  expect(home.courses[0].code).toBe('C1');
});

it('is idempotent — enrolling twice returns the same place, no duplicate', async () => {
  const { cohort } = await seedCohort();
  const first = await as(() => enrolment.enrol({ cohortId: cohort._id, userId: user._id }));
  const second = await as(() => enrolment.enrol({ cohortId: cohort._id, userId: user._id }));
  expect(String(first._id)).toBe(String(second._id));
  const count = await as(() => Enrollment.countDocuments({ userId: user._id, cohortId: cohort._id }).exec());
  expect(count).toBe(1);
});

it('rejects enrol with no member chosen', async () => {
  const { cohort } = await seedCohort();
  await expect(as(() => enrolment.enrol({ cohortId: cohort._id, userId: null }))).rejects.toThrow();
});
