'use strict';

/**
 * Learner receipt history (Oct-2026, P2). myPayments() lists a learner's own
 * confirmed payments newest-first (a refund as a negative row); paymentReceipt()
 * returns one with its context and refuses someone else's payment.
 */

const { Tenant, User, Course, Cohort, Enrollment, FeeSchedule } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const { NotAuthorisedError } = require('../../src/lib/errors');
const commerce = require('../../src/services/commerce');

let tenant, user, other;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);
const NGN = (n) => ({ amount: n, currency: 'NGN' });

async function seedInvoice() {
  return as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'Intro to Robotics' }, status: 'active' });
    const cohort = await Cohort.create({ courseId: course._id, title: { en: 'R' }, session: '2026/2027' });
    const enrollment = await Enrollment.create({ userId: user._id, courseId: course._id, cohortId: cohort._id, status: 'active' });
    const schedule = await FeeSchedule.create({ label: { en: 'Standard' }, items: [{ label: { en: 'Tuition' }, amount: NGN(50000) }] });
    return commerce.raiseInvoice({ enrollmentId: enrollment._id, feeScheduleId: schedule._id });
  });
}

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-receipts', name: 'Alpha Institute', locales: ['en'], defaultLocale: 'en', status: 'active' });
  user = await User.create({ email: 'l@x.io', name: 'Ada Lovelace', passwordHash: await User.hashPassword('x'.repeat(12)) });
  other = await User.create({ email: 'o@x.io', name: 'Other', passwordHash: await User.hashPassword('x'.repeat(12)) });
});

it('lists a learner’s payments newest-first with method and reference', async () => {
  const invoice = await seedInvoice();
  await as(() => commerce.recordPayment({ invoiceId: invoice._id, amount: NGN(20000), method: 'bank_transfer', note: 'First instalment' }));
  await as(() => commerce.recordPayment({ invoiceId: invoice._id, amount: NGN(30000), method: 'paystack', provider: 'paystack', providerRef: 'ref_abc123' }));

  const payments = await as(() => commerce.myPayments(user._id));
  expect(payments).toHaveLength(2);
  // newest first
  expect(payments[0].reference).toBe('ref_abc123');
  expect(payments[0].method).toBe('paystack');
  expect(payments[1].method).toBe('bank_transfer');
  expect(payments.every((p) => !p.isRefund)).toBe(true);
});

it('shows a refund as a negative row', async () => {
  const invoice = await seedInvoice();
  await as(() => commerce.recordPayment({ invoiceId: invoice._id, amount: NGN(50000), method: 'paystack', provider: 'paystack', providerRef: 'ref_full' }));
  await as(() => commerce.recordPayment({ invoiceId: invoice._id, amount: NGN(-10000), method: 'refund' }));

  const payments = await as(() => commerce.myPayments(user._id));
  const refund = payments.find((p) => p.isRefund);
  expect(refund).toBeTruthy();
  expect(refund.amount.amount).toBe(-10000);
});

it('returns a single receipt with its context', async () => {
  const invoice = await seedInvoice();
  await as(() => commerce.recordPayment({ invoiceId: invoice._id, amount: NGN(50000), method: 'bank_transfer' }));
  const [p] = await as(() => commerce.myPayments(user._id));

  const receipt = await as(() => commerce.paymentReceipt({ paymentId: p.id, userId: user._id }));
  expect(receipt.institution).toBe('Alpha Institute');
  expect(receipt.learnerName).toBe('Ada Lovelace');
  expect(receipt.courseTitle).toBe('Intro to Robotics'); // resolved to a plain string
  expect(receipt.payment.amount.amount).toBe(50000);
});

it('refuses a receipt that belongs to someone else', async () => {
  const invoice = await seedInvoice();
  await as(() => commerce.recordPayment({ invoiceId: invoice._id, amount: NGN(50000), method: 'bank_transfer' }));
  const [p] = await as(() => commerce.myPayments(user._id));

  await expect(
    as(() => commerce.paymentReceipt({ paymentId: p.id, userId: other._id }))
  ).rejects.toThrow(NotAuthorisedError);
});
