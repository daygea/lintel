'use strict';

/**
 * Invoice + payment collection. Raising an invoice from a schedule, recording
 * payments that move it toward 'full' and sync the enrolment's paymentState (the
 * field the eligibility engine's payment_state rule reads), and waiving.
 */

const { Tenant, User, Course, Cohort, Enrollment, FeeSchedule, Invoice } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const commerce = require('../../src/services/commerce');

let tenant, user;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);
const NGN = (n) => ({ amount: n, currency: 'NGN' });

async function seed() {
  return as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'C' }, status: 'active' });
    const cohort = await Cohort.create({ courseId: course._id, title: { en: 'R' }, session: '2026/2027' });
    const enrollment = await Enrollment.create({ userId: user._id, courseId: course._id, cohortId: cohort._id, status: 'active' });
    const schedule = await FeeSchedule.create({
      label: { en: 'Standard' },
      items: [{ label: { en: 'Tuition' }, amount: NGN(50000) }],
    });
    return { enrollment, schedule };
  });
}

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-invoice', name: 'Alpha', locales: ['en'], status: 'active' });
  user = await User.create({ email: 'l@x.io', name: 'Ada', passwordHash: await User.hashPassword('x'.repeat(12)) });
});

it('raises an invoice from a schedule with the summed amount due', async () => {
  const { enrollment, schedule } = await seed();
  const invoice = await as(() => commerce.raiseInvoice({ enrollmentId: enrollment._id, feeScheduleId: schedule._id }));
  expect(invoice.amountDue.amount).toBe(50000);
  expect(invoice.state).toBe('unpaid');
  expect(String(invoice.userId)).toBe(String(user._id));
});

it('records payments toward full and syncs the enrolment paymentState', async () => {
  const { enrollment, schedule } = await seed();
  const invoice = await as(() => commerce.raiseInvoice({ enrollmentId: enrollment._id, feeScheduleId: schedule._id }));

  await as(() => commerce.recordPayment({ invoiceId: invoice._id, amount: NGN(20000), method: 'bank_transfer' }));
  let inv = await as(() => Invoice.findById(invoice._id).exec());
  expect(inv.amountPaid.amount).toBe(20000);
  expect(inv.state).not.toBe('full');
  let enr = await as(() => Enrollment.findById(enrollment._id).exec());
  expect(enr.paymentState).not.toBe('unpaid');

  await as(() => commerce.recordPayment({ invoiceId: invoice._id, amount: NGN(30000), method: 'cash' }));
  inv = await as(() => Invoice.findById(invoice._id).exec());
  expect(inv.amountPaid.amount).toBe(50000);
  expect(inv.state).toBe('full');
  enr = await as(() => Enrollment.findById(enrollment._id).exec());
  expect(enr.paymentState).toBe('full');
});

it('waives an outstanding invoice and the enrolment', async () => {
  const { enrollment, schedule } = await seed();
  const invoice = await as(() => commerce.raiseInvoice({ enrollmentId: enrollment._id, feeScheduleId: schedule._id }));
  await as(() => commerce.waive({ invoiceId: invoice._id, reason: 'scholarship' }));
  const inv = await as(() => Invoice.findById(invoice._id).exec());
  expect(inv.state).toBe('waived');
  const enr = await as(() => Enrollment.findById(enrollment._id).exec());
  expect(enr.paymentState).toBe('waived');
});

it('invoiceView returns invoice, user, payments and outstanding', async () => {
  const { enrollment, schedule } = await seed();
  const invoice = await as(() => commerce.raiseInvoice({ enrollmentId: enrollment._id, feeScheduleId: schedule._id }));
  await as(() => commerce.recordPayment({ invoiceId: invoice._id, amount: NGN(20000), method: 'bank_transfer' }));
  const view = await as(() => commerce.invoiceView(invoice._id));
  expect(view.user.email).toBe('l@x.io');
  expect(view.payments).toHaveLength(1);
  expect(view.outstanding.amount).toBe(30000);
});
