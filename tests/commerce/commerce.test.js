'use strict';

/**
 * Sprint 6 exit criteria. The assertions that matter:
 *   - a free schedule produces a settled invoice with no provider
 *   - a payment moves the tally and derives state
 *   - a REPLAYED webhook reference records the money ONCE (idempotency)
 *   - a bank transfer is confirmed by a named registrar
 *   - a waiver settles the invoice, audited
 *   - part-payment flips the enrolment's paymentState, which the ENGINE reads:
 *     access is withdrawn as a FAILED ELIGIBILITY RULE, not a payment error
 *   - a Payment cannot be updated (append-only)
 */

const {
  Tenant, User, Membership, Course, Cohort, Enrollment,
  FeeSchedule, Invoice, Payment, EligibilityPolicy, Lesson, Module,
} = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const commerce = require('../../src/services/commerce');
const { canAccessLesson } = require('../../src/services/eligibility.service');
const { evaluate } = require('../../src/services/eligibility/evaluator');
const money = require('../../src/lib/money');
const { ImmutableRecordError } = require('../../src/lib/errors');

let tenant, staff, learner, course, cohort, enrollment;
const as = (fn) => runWithTenant(tenant._id, staff._id, fn);

const NGN = (naira) => ({ amount: naira * 100, currency: 'NGN' });

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'inst', name: 'Institute', locales: ['en'], baseCurrency: 'NGN' });
  staff = await User.create({ email: 's@x.com', name: 'Registrar', passwordHash: 'x', status: 'active' });
  learner = await User.create({ email: 'l@x.com', name: 'Learner', passwordHash: 'x', status: 'active' });
  await as(async () => {
    await Membership.create({ userId: staff._id, roles: ['registrar'], status: 'active' });
    course = await Course.create({ code: 'C1', title: { en: 'Course' } });
    cohort = await Cohort.create({ courseId: course._id, title: { en: 'Run' }, session: '2026/2027' });
    enrollment = await Enrollment.create({ userId: learner._id, courseId: course._id, cohortId: cohort._id, status: 'active' });
  });
});

describe('free is first-class', () => {
  it('an empty schedule settles the invoice with no provider', async () => {
    const invoice = await as(async () => {
      const sched = await commerce.createSchedule({ label: { en: 'Free' }, items: [] });
      return commerce.raiseInvoice({ enrollmentId: enrollment._id, feeScheduleId: sched._id });
    });
    expect(invoice.state).toBe('full');
    const e = await as(() => Enrollment.findById(enrollment._id).exec());
    expect(e.paymentState).toBe('full');
  });
});

describe('payments and idempotency', () => {
  async function pricedInvoice() {
    return as(async () => {
      const sched = await commerce.createSchedule({ label: { en: 'Tuition' }, items: [{ label: { en: 'Tuition' }, amount: NGN(50000) }] });
      return commerce.raiseInvoice({ enrollmentId: enrollment._id, feeScheduleId: sched._id });
    });
  }

  it('a partial payment moves the tally and sets state to part', async () => {
    const invoice = await pricedInvoice();
    const { invoice: after } = await as(() => commerce.recordPayment({ invoiceId: invoice._id, amount: NGN(20000), method: 'paystack', provider: 'paystack', providerRef: 'ref-1' }));
    expect(after.amountPaid.amount).toBe(NGN(20000).amount);
    expect(after.state).toBe('part');
  });

  it('a replayed webhook reference records the money ONCE', async () => {
    const invoice = await pricedInvoice();
    await as(() => commerce.recordPayment({ invoiceId: invoice._id, amount: NGN(50000), method: 'paystack', provider: 'paystack', providerRef: 'ref-dup' }));
    const second = await as(() => commerce.recordPayment({ invoiceId: invoice._id, amount: NGN(50000), method: 'paystack', provider: 'paystack', providerRef: 'ref-dup' }));
    expect(second.replay).toBe(true);

    const payments = await as(() => Payment.find({ invoiceId: invoice._id }).exec());
    expect(payments).toHaveLength(1);
    const after = await as(() => Invoice.findById(invoice._id).exec());
    expect(after.amountPaid.amount).toBe(NGN(50000).amount); // not doubled
    expect(after.state).toBe('full');
  });

  it('a bank transfer is confirmed by a named registrar', async () => {
    const invoice = await pricedInvoice();
    await as(() => commerce.confirmBankTransfer({ invoiceId: invoice._id, amount: NGN(50000), note: 'seen in statement' }));
    const payments = await as(() => Payment.find({ invoiceId: invoice._id }).exec());
    expect(payments[0].method).toBe('bank_transfer');
    expect(String(payments[0].confirmedByUserId)).toBe(String(staff._id));
  });

  it('a waiver settles the invoice', async () => {
    const invoice = await pricedInvoice();
    const waived = await as(() => commerce.waive({ invoiceId: invoice._id, reason: 'scholarship' }));
    expect(waived.state).toBe('waived');
    const e = await as(() => Enrollment.findById(enrollment._id).exec());
    expect(e.paymentState).toBe('waived');
  });

  it('a Payment cannot be updated (append-only)', async () => {
    const invoice = await pricedInvoice();
    const { payment } = await as(() => commerce.recordPayment({ invoiceId: invoice._id, amount: NGN(10000), method: 'cash' }));
    await expect(
      as(() => Payment.updateOne({ _id: payment._id }, { 'amount.amount': 999 }).exec())
    ).rejects.toThrow(ImmutableRecordError);
  });
});

describe('the payoff: money composes with the engine', () => {
  it('withholds a lesson as a FAILED RULE when fees are unpaid, and opens it when paid', async () => {
    // A lesson gated on payment_state: part.
    const { lesson } = await as(async () => {
      const policy = await EligibilityPolicy.create({
        slug: 'fees-part', label: { en: 'Fees' }, combinator: 'all',
        rules: [{ type: 'enrolled' }, { type: 'payment_state', params: { atLeast: 'part', courseId: course._id } }],
        denialMessage: { en: 'This teaching opens once your fees are at least part paid.' },
      });
      const mod = await Module.create({ courseId: course._id, title: { en: 'M' } });
      const lesson = await Lesson.create({ moduleId: mod._id, courseId: course._id, title: { en: 'L' }, eligibilityPolicyId: policy._id });
      const sched = await commerce.createSchedule({ label: { en: 'T' }, items: [{ label: { en: 'T' }, amount: NGN(50000) }] });
      await commerce.raiseInvoice({ enrollmentId: enrollment._id, feeScheduleId: sched._id });
      return { lesson };
    });

    // Unpaid → withheld, and the failure is the payment RULE, not an error.
    let verdict = await runWithTenant(tenant._id, learner._id, () => canAccessLesson({ lessonId: lesson._id, userId: learner._id }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.failedRules).toContain('payment_state');
    expect(verdict.message).toMatch(/once your fees/);

    // Pay part → opens on the next request, no code path through the lesson touched.
    const invoice = await as(() => commerce.invoiceFor(enrollment._id));
    await as(() => commerce.recordPayment({ invoiceId: invoice._id, amount: NGN(20000), method: 'paystack', provider: 'paystack', providerRef: 'ref-open' }));

    verdict = await runWithTenant(tenant._id, learner._id, () => canAccessLesson({ lessonId: lesson._id, userId: learner._id }));
    expect(verdict.allowed).toBe(true);
  });
});
