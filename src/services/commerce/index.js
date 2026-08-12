'use strict';

const crypto = require('node:crypto');
const {
  FeeSchedule, Invoice, Payment, Enrollment, AuditLog, User, Tenant,
} = require('../../models');
const { PaystackProvider } = require('./providers/paystack');
const { PLANS } = require('../../config/plans');
const money = require('../../lib/money');
const { ValidationError, NotAuthorisedError } = require('../../lib/errors');
const { currentUserId, currentTenantId } = require('../../lib/context');
const logger = require('../../lib/logger');

const PROVIDERS = { paystack: new PaystackProvider() };

/* -------------------------------------------------------------- fee schedules */

const listSchedules = (filter = {}) => FeeSchedule.find(filter).sort({ createdAt: -1 }).exec();

/**
 * A cohort's default fee schedule (the newest), or null if the cohort is free.
 * "Free vs paid" is derived from this — a cohort with a schedule whose items sum
 * above zero is paid; no schedule (or an empty one) is free.
 */
const scheduleForCohort = (cohortId) =>
  FeeSchedule.findOne({ cohortId }).sort({ createdAt: -1 }).exec();

/** The headline fee for a cohort as a money value, or null when it's free. */
async function cohortFee(cohortId) {
  const schedule = await scheduleForCohort(cohortId);
  if (!schedule || !schedule.items.length) return null;
  const currency = schedule.items[0].amount.currency;
  const total = schedule.items.reduce((sum, i) => money.add(sum, i.amount), money.zero(currency));
  return money.isFree(total) ? null : total;
}

/**
 * The learner's own invoices, newest first, each with what's still outstanding.
 * This is the data behind the learner "My fees" page.
 */
// A listing must never 500 on one bad row. Historical/hand-edited invoices can
// carry a missing or wrong-currency money value; coerce each to a safe, valid,
// same-currency pair so neither subtract() nor the view's format() can throw.
const VALID_CURRENCY = new Set(money.SUPPORTED);
function safeDue(m) {
  const currency = m && VALID_CURRENCY.has(m.currency) ? m.currency : 'NGN';
  const amount = m && Number.isFinite(m.amount) ? m.amount : 0;
  return { amount, currency };
}
function paidIn(m, currency) {
  // count a paid amount only when it's in the invoice's own currency; else treat as 0
  const amount = m && Number.isFinite(m.amount) && m.currency === currency ? m.amount : 0;
  return { amount, currency };
}
function safeMoney(invoice) {
  const amountDue = safeDue(invoice.amountDue);
  const amountPaid = paidIn(invoice.amountPaid, amountDue.currency);
  return { amountDue, amountPaid, outstanding: money.subtract(amountDue, amountPaid) };
}

async function myInvoices(userId) {
  const invoices = await Invoice.find({ userId }).sort({ createdAt: -1 }).exec();
  return invoices.map((inv) => {
    const { amountDue, amountPaid, outstanding } = safeMoney(inv);
    return {
      invoice: inv,
      amountDue,
      amountPaid,
      outstanding,
      settled: money.isFree(outstanding) || inv.state === 'waived',
    };
  });
}

/**
 * Ensure a paid enrolment has an invoice, so the learner can pay without a
 * registrar raising one by hand. Idempotent (one invoice per enrolment). Returns
 * the invoice, or null when the cohort is free (nothing to pay).
 */
async function ensureInvoiceForEnrolment(enrollmentId) {
  const existing = await Invoice.findOne({ enrollmentId }).exec();
  if (existing) return existing;
  const enrollment = await Enrollment.findById(enrollmentId).exec();
  if (!enrollment) return null;
  const schedule = await scheduleForCohort(enrollment.cohortId);
  if (!schedule || !schedule.items.length) return null; // free cohort → no invoice
  return raiseInvoice({ enrollmentId, feeScheduleId: schedule._id });
}


async function createSchedule(data) {
  if (!data.label) throw new ValidationError('A fee schedule needs a label');
  return FeeSchedule.create(data);
}

/* -------------------------------------------------------------------- invoices */

/**
 * Raise an invoice for an enrolment from a schedule. A schedule with no items
 * produces a zero invoice, immediately 'full' — free is first-class and needs no
 * payment provider configured at all.
 */
async function raiseInvoice({ enrollmentId, feeScheduleId, planId }) {
  const enrollment = await Enrollment.findById(enrollmentId).exec();
  if (!enrollment) throw new ValidationError('No such enrolment');

  const schedule = await FeeSchedule.findById(feeScheduleId).exec();
  if (!schedule) throw new ValidationError('No such fee schedule');

  const currency = schedule.items[0]?.amount.currency || 'NGN';
  const amountDue = schedule.items.reduce(
    (sum, i) => money.add(sum, i.amount),
    money.zero(currency)
  );

  let dueDates = [];
  if (planId) {
    const plan = schedule.plans.id(planId);
    if (plan) {
      dueDates = plan.instalments.map((ins) => ({
        amount: ins.amount,
        dueAt: new Date(Date.now() + (ins.dueDayOffset || 0) * 86400000),
      }));
    }
  }

  const invoice = await Invoice.create({
    enrollmentId,
    userId: enrollment.userId,
    feeScheduleId,
    amountDue,
    amountPaid: money.zero(currency),
    dueDates,
    state: money.isFree(amountDue) ? 'full' : 'unpaid',
  });

  // A free invoice settles the enrolment's payment state immediately.
  if (money.isFree(amountDue)) await syncEnrollmentState(enrollment._id, 'full');

  return invoice;
}

/* -------------------------------------------------------------------- payments */

/**
 * Begin an online payment. Returns a provider authorization URL. The reference is
 * ours and unique, so the webhook can find the invoice again.
 */
async function beginPayment({ invoiceId, providerKey = 'paystack', returnUrl }) {
  const invoice = await Invoice.findById(invoiceId).exec();
  if (!invoice) throw new ValidationError('No such invoice');

  const provider = PROVIDERS[providerKey];
  if (!provider) throw new ValidationError(`Unknown provider: ${providerKey}`);

  const outstanding = money.subtract(invoice.amountDue, invoice.amountPaid);
  if (money.isFree(outstanding)) throw new ValidationError('This invoice is already settled');

  const user = await User.findById(invoice.userId).exec();
  const reference = `${currentTenantId()}_${invoice._id}_${crypto.randomBytes(4).toString('hex')}`;

  // Marketplace split (opt-in): if the institution has a Paystack subaccount, the
  // learner's money is credited to it and Lintel keeps a plan-based cut as the
  // transaction charge. No subaccount → settles to Lintel's account as before.
  let subaccount;
  let transactionCharge;
  const tenant = await Tenant.findById(currentTenantId()).exec();
  if (tenant && tenant.paystackSubaccount) {
    subaccount = tenant.paystackSubaccount;
    const bps = (PLANS[tenant.plan] && PLANS[tenant.plan].platformFeeBps) || 0;
    transactionCharge = Math.round((outstanding.amount * bps) / 10000);
  }

  const init = await provider.initialize({
    invoice,
    amount: outstanding,
    email: user?.email,
    reference,
    callbackUrl: returnUrl,
    subaccount,
    transactionCharge,
  });

  return { authorizationUrl: init.authorizationUrl, reference: init.reference };
}

/**
 * Record a payment. THE idempotent core: a providerRef may be recorded once per
 * tenant (a unique index enforces it), so a webhook delivered three times moves
 * the money once. Manual payments (bank transfer, cash) have no ref and are
 * confirmed by a named registrar.
 */
async function recordPayment({ invoiceId, amount, method, provider = 'manual', providerRef, note }) {
  const invoice = await Invoice.findById(invoiceId).exec();
  if (!invoice) throw new ValidationError('No such invoice');

  // Idempotency guard: if this ref is already recorded, return quietly.
  if (providerRef) {
    const seen = await Payment.findOne({ providerRef }).exec();
    if (seen) {
      logger.info({ providerRef }, 'payment already recorded — ignoring replay');
      return { invoice, payment: seen, replay: true };
    }
  }

  const manual = ['bank_transfer', 'cash', 'waiver', 'refund'].includes(method);
  let payment;
  try {
    payment = await Payment.create({
      invoiceId,
      userId: invoice.userId,
      amount,
      method,
      provider,
      providerRef,
      confirmedByUserId: manual ? currentUserId() : undefined,
      note,
    });
  } catch (err) {
    if (err.code === 11000 && providerRef) {
      const seen = await Payment.findOne({ providerRef }).exec();
      return { invoice, payment: seen, replay: true };
    }
    throw err;
  }

  // Move the tally and recompute state.
  const newPaid = money.add(invoice.amountPaid, amount);
  const state = deriveState(invoice.amountDue, newPaid);
  await Invoice.updateOne({ _id: invoice._id }, { amountPaid: newPaid, state }).exec();

  await syncEnrollmentState(invoice.enrollmentId, state);

  await AuditLog.create({
    actorUserId: currentUserId(),
    action: 'payment.recorded',
    subjectType: 'Payment',
    subjectId: payment._id,
    meta: { method, amount: amount.amount, state },
  });

  return { invoice: await Invoice.findById(invoice._id).exec(), payment, replay: false };
}

/** A registrar confirms a bank transfer they have seen land. */
async function confirmBankTransfer({ invoiceId, amount, note }) {
  return recordPayment({ invoiceId, amount, method: 'bank_transfer', provider: 'manual', note });
}

/** A scholarship. Records a waiver payment for the outstanding balance, audited. */
async function waive({ invoiceId, reason }) {
  const invoice = await Invoice.findById(invoiceId).exec();
  if (!invoice) throw new ValidationError('No such invoice');
  const outstanding = money.subtract(invoice.amountDue, invoice.amountPaid);

  await Invoice.updateOne(
    { _id: invoiceId },
    { state: 'waived', waivedByUserId: currentUserId(), waiverReason: reason }
  ).exec();
  await syncEnrollmentState(invoice.enrollmentId, 'waived');

  await AuditLog.create({
    actorUserId: currentUserId(),
    action: 'invoice.waived',
    subjectType: 'Invoice',
    subjectId: invoice._id,
    meta: { reason, outstanding: outstanding.amount },
  });
  return Invoice.findById(invoiceId).exec();
}

/* ------------------------------------------------------------------- webhooks */

/**
 * A provider webhook. Verifies the signature, parses, and records — idempotently.
 * The signature check is why rawBody must reach here unparsed.
 */
async function handleWebhook({ providerKey = 'paystack', rawBody, signature, body }) {
  const provider = PROVIDERS[providerKey];
  if (!provider) throw new ValidationError('Unknown provider');

  if (!provider.verifyWebhook(rawBody, signature)) {
    throw new NotAuthorisedError('Invalid webhook signature');
  }

  const parsed = provider.parseWebhook(body);
  if (parsed.event !== 'charge.success') return { ignored: parsed.event };

  const ref = String(parsed.reference);

  // Platform subscription payment (institution → Lintel): reference sub_<tenantId>_<plan>_<rand>
  if (ref.startsWith('sub_')) {
    const [, tenantId, plan] = ref.split('_');
    return require('../billing.service').activateSubscription({
      tenantId, plan, providerRef: parsed.providerRef, amount: parsed.amount,
    });
  }

  // Learner invoice payment: reference <tenantId>_<invoiceId>_<rand>
  const invoiceId = ref.split('_')[1];
  return recordPayment({
    invoiceId,
    amount: parsed.amount,
    method: 'paystack',
    provider: 'paystack',
    providerRef: parsed.providerRef,
  });
}

/* ------------------------------------------------------------------- helpers */

function deriveState(due, paid) {
  if (money.isFree(due)) return 'full';
  if (paid.amount <= 0) return 'unpaid';
  if (paid.amount >= due.amount) return 'full';
  // A configured deposit threshold could distinguish 'deposit' from 'part';
  // for now any partial payment is 'part'.
  return 'part';
}

/**
 * Reflect the invoice state onto the enrolment's paymentState — the field the
 * eligibility engine's payment_state rule reads. THIS is the join between money
 * and access: nothing in the commerce layer touches lessons; it moves this one
 * enum, and the engine does the rest.
 */
async function syncEnrollmentState(enrollmentId, state) {
  const map = { unpaid: 'unpaid', part: 'part', deposit: 'deposit', full: 'full', waived: 'waived', overdue: 'unpaid' };
  await Enrollment.updateOne(
    { _id: enrollmentId },
    { paymentState: map[state] || 'unpaid' }
  ).exec();
}

const invoiceFor = (enrollmentId) => Invoice.findOne({ enrollmentId }).exec();
const paymentsFor = (invoiceId) => Payment.find({ invoiceId }).sort({ at: -1 }).exec();

/** Everything the invoice detail page needs, composed once. */
async function invoiceView(id) {
  const invoice = await Invoice.findById(id).exec();
  if (!invoice) return null;
  const [user, payments] = await Promise.all([
    User.findById(invoice.userId).exec(),
    paymentsFor(invoice._id),
  ]);
  return { invoice, user, payments, outstanding: safeMoney(invoice).outstanding };
}

/**
 * Refund (part of) what was paid on an invoice. Append-only: this writes a NEW
 * negative Payment (method 'refund'), never touches the original — the ledger
 * shows both the charge and the reversal. recordPayment moves the tally and
 * re-derives the invoice state (paid → part → unpaid). Records the ledger entry;
 * the institution moves the actual money (bank transfer back, or its Paystack
 * dashboard). Can't refund more than the net paid.
 */
async function refund({ invoiceId, amount, reason }) {
  const invoice = await Invoice.findById(invoiceId).exec();
  if (!invoice) throw new ValidationError('No such invoice');
  if (!amount || amount.amount <= 0) throw new ValidationError('Enter a refund amount greater than zero');
  if (amount.currency !== invoice.amountPaid.currency) throw new ValidationError('Refund currency must match the payment');
  if (amount.amount > invoice.amountPaid.amount) throw new ValidationError('Cannot refund more than has been paid');

  const result = await recordPayment({
    invoiceId,
    amount: { amount: -amount.amount, currency: amount.currency },
    method: 'refund',
    provider: 'manual',
    note: reason,
  });
  await AuditLog.create({
    actorUserId: currentUserId(),
    action: 'invoice.refunded',
    subjectType: 'Invoice',
    subjectId: invoiceId,
    meta: { amount: amount.amount, currency: amount.currency, reason },
  });
  return result;
}

module.exports = {
  listSchedules, createSchedule, scheduleForCohort, cohortFee,
  raiseInvoice, invoiceFor, invoiceView, myInvoices, ensureInvoiceForEnrolment,
  beginPayment, recordPayment, confirmBankTransfer, waive, refund, paymentsFor,
  handleWebhook,
  PROVIDERS,
};
