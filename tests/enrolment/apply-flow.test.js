'use strict';

/**
 * The learner application flow. Only open, in-window cohorts are offered; applying
 * files an application the learner can track; admitting it enrols them.
 */

const { Tenant, User, Course, Cohort, Application, Enrollment } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const svc = require('../../src/services/enrolment.service');

let tenant, learner;
const as = (fn) => runWithTenant(tenant._id, learner._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-apply', name: 'Alpha', locales: ['en'], status: 'active' });
  learner = await User.create({ email: 'l@x.io', name: 'L', passwordHash: await User.hashPassword('x'.repeat(12)) });
});

it('offers only open, in-window cohorts', async () => {
  const { open } = await as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'C' }, status: 'active' });
    const open = await Cohort.create({ courseId: course._id, title: { en: 'Open' }, session: '2026/2027', status: 'open' });
    await Cohort.create({ courseId: course._id, title: { en: 'Draft' }, session: '2026/2027', status: 'draft' });
    await Cohort.create({ courseId: course._id, title: { en: 'Past' }, session: '2026/2027', status: 'open', applicationsCloseAt: new Date(Date.now() - 1000) });
    return { open };
  });
  const list = await as(() => svc.listOpenCohorts());
  expect(list).toHaveLength(1);
  expect(String(list[0]._id)).toBe(String(open._id));
});

it('applies, tracks the application, and admission enrols the learner', async () => {
  const cohort = await as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'C' }, status: 'active' });
    return Cohort.create({ courseId: course._id, title: { en: 'Open' }, session: '2026/2027', status: 'open' });
  });

  const app = await as(() => svc.apply({ cohortId: cohort._id, userId: learner._id }));
  expect(app.status).toBe('submitted');

  const mine = await as(() => svc.applicationsForUser(learner._id));
  expect(mine).toHaveLength(1);

  await as(() => svc.decideApplication({ applicationId: app._id, decision: 'admitted' }));
  const enrolled = await as(() => svc.enrollmentsForUser(learner._id));
  expect(enrolled).toHaveLength(1);
  expect(String(enrolled[0].cohortId)).toBe(String(cohort._id));
  expect(enrolled[0].status).toBe('active');
});

it('refuses a second application to the same cohort', async () => {
  const cohort = await as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'C' }, status: 'active' });
    return Cohort.create({ courseId: course._id, title: { en: 'Open' }, session: '2026/2027', status: 'open' });
  });
  await as(() => svc.apply({ cohortId: cohort._id, userId: learner._id }));
  await expect(as(() => svc.apply({ cohortId: cohort._id, userId: learner._id }))).rejects.toThrow(/already applied/i);
});
