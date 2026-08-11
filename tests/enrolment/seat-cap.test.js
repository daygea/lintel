'use strict';

/**
 * A tenant's plan seat cap is enforced at enrol time. Trial allows 25 active
 * learners; the 26th is refused.
 */

const mongoose = require('mongoose');
const { Tenant, User, Course, Cohort, Enrollment } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const { PLANS } = require('../../src/config/plans');
const enrolment = require('../../src/services/enrolment.service');

let tenant, cohort;
const as = (fn) => runWithTenant(tenant._id, tenant._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-seat', name: 'Alpha', locales: ['en'], status: 'trial', plan: 'trial' });
  await as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'C' }, status: 'active' });
    cohort = await Cohort.create({ courseId: course._id, title: { en: 'A' }, session: '2026/2027', status: 'open' });
    // Fill to the trial cap with active enrolments (dummy user ids — the check only counts).
    const seats = PLANS.trial.seats;
    for (let i = 0; i < seats; i++) {
      await Enrollment.create({ userId: new mongoose.Types.ObjectId(), cohortId: cohort._id, courseId: course._id, status: 'active', paymentState: 'unpaid' });
    }
  });
});

it('refuses to enrol past the plan seat cap', async () => {
  const learner = await User.create({ email: 'l@x.io', name: 'L', passwordHash: await User.hashPassword('x'.repeat(12)) });
  await expect(as(() => enrolment.enrol({ cohortId: cohort._id, userId: learner._id }))).rejects.toThrow(/plan allows 25/i);
});

it('does not count a re-enrol of an existing learner against the cap', async () => {
  // Take one active seat back so we're at 24, then a re-enrol of that same learner must still work.
  const learner = await User.create({ email: 'm@x.io', name: 'M', passwordHash: await User.hashPassword('x'.repeat(12)) });
  await as(async () => {
    await Enrollment.deleteOne({}); // drop to 24
    await Enrollment.create({ userId: learner._id, cohortId: cohort._id, courseId: cohort.courseId, status: 'active', paymentState: 'unpaid' }); // 25 again, this learner enrolled
  });
  const again = await as(() => enrolment.enrol({ cohortId: cohort._id, userId: learner._id }));
  expect(String(again.userId)).toBe(String(learner._id)); // returned existing, no throw
});
