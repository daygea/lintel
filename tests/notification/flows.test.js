'use strict';

/**
 * Notification coverage (Oct-2026). Each of these flows previously sent the wrong
 * message or nothing at all; this locks in that the right notification fires:
 *   - direct enrolment      -> enrollment.activated
 *   - member admission      -> member.admitted
 *   - payment recorded      -> payment.confirmed (never for a refund)
 *   - existing-user self-reg -> registration.received
 *   - password reset         -> sent directly (no tenant-scoped row), token issued
 */

const {
  Tenant, User, Membership, Course, Cohort, Enrollment,
  FeeSchedule, Notification, OnboardingToken,
} = require('../../src/models');
const { runWithTenant, runAsPlatform } = require('../../src/lib/context');
const enrolment = require('../../src/services/enrolment.service');
const membershipSvc = require('../../src/services/membership.service');
const commerce = require('../../src/services/commerce');
const auth = require('../../src/services/auth.service');
const platform = require('../../src/services/platform.service');

let tenant, staff, learner;
const NGN = (n) => ({ amount: n, currency: 'NGN' });
const as = (fn) => runWithTenant(tenant._id, staff._id, fn);
const notifs = (userId, template) =>
  runWithTenant(tenant._id, staff._id, () => Notification.find({ userId, template }).exec());

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-notif', name: 'Alpha Institute', locales: ['en'], defaultLocale: 'en', status: 'active' });
  staff = await User.create({ email: 's@x.io', name: 'Staff', passwordHash: await User.hashPassword('x'.repeat(12)) });
  learner = await User.create({ email: 'l@x.io', name: 'Lee', passwordHash: await User.hashPassword('x'.repeat(12)) });
  await as(async () => { await Membership.create({ userId: staff._id, roles: ['registrar'], status: 'active' }); });
});

it('direct enrolment emails the learner enrollment.activated', async () => {
  const cohort = await as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'Foundations' }, status: 'active' });
    return Cohort.create({ courseId: course._id, title: { en: 'Intake A' }, session: '2026/2027' });
  });
  await as(() => enrolment.enrol({ cohortId: cohort._id, userId: learner._id }));
  const sent = await notifs(learner._id, 'enrollment.activated');
  expect(sent).toHaveLength(1);
});

it('admitting a member emails them member.admitted', async () => {
  const m = await as(() => Membership.create({ userId: learner._id, roles: ['learner'], status: 'pending' }));
  await as(() => membershipSvc.activate(m._id, staff._id));
  const sent = await notifs(learner._id, 'member.admitted');
  expect(sent).toHaveLength(1);
});

it('a recorded payment emails payment.confirmed, but a refund does not', async () => {
  const invoice = await as(async () => {
    const course = await Course.create({ code: 'C2', title: { en: 'C' }, status: 'active' });
    const cohort = await Cohort.create({ courseId: course._id, title: { en: 'R' }, session: '2026/2027' });
    const enr = await Enrollment.create({ userId: learner._id, courseId: course._id, cohortId: cohort._id, status: 'active' });
    const schedule = await FeeSchedule.create({ label: { en: 'Std' }, items: [{ label: { en: 'Tuition' }, amount: NGN(50000) }] });
    return commerce.raiseInvoice({ enrollmentId: enr._id, feeScheduleId: schedule._id });
  });
  await as(() => commerce.recordPayment({ invoiceId: invoice._id, amount: NGN(50000), method: 'bank_transfer' }));
  await as(() => commerce.recordPayment({ invoiceId: invoice._id, amount: NGN(-10000), method: 'refund' }));

  const sent = await notifs(learner._id, 'payment.confirmed');
  expect(sent).toHaveLength(1); // the refund did not add a second one
});

it('an existing user self-registering is acknowledged with registration.received', async () => {
  // `learner` already exists globally; self-registering into this tenant should
  // acknowledge them (previously an existing account got nothing).
  await as(() => auth.selfRegister({ email: 'l@x.io', name: 'Lee' }));
  const sent = await notifs(learner._id, 'registration.received');
  expect(sent).toHaveLength(1);
});

it('password reset issues a token and sends directly, writing no tenant-scoped row', async () => {
  await platform.sendPasswordReset(learner._id, staff._id);
  const token = await runAsPlatform('t', () => OnboardingToken.findOne({ userId: learner._id }).exec());
  expect(token).toBeTruthy();
  // It goes out via sendDirectEmail, so there is no tenant Notification row for it.
  const rows = await notifs(learner._id, 'password_reset');
  expect(rows).toHaveLength(0);
});
