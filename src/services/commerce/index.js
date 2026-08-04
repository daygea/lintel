'use strict';

const crypto = require('node:crypto');
const {
  FeeSchedule, Invoice, Payment, Enrollment, AuditLog, User,
} = require('../../models');
const { PaystackProvider } = require('./providers/paystack');
const money = require('../../lib/money');
const { ValidationError, NotAuthorisedError } = require('../../lib/errors');
const { currentUserId, currentTenantId } = require('../../lib/context');
const logger = require('../../lib/logger');

const PROVIDERS = { paystack: new PaystackProvider() };

/* -------------------------------------------------------------- fee schedules */

const listSchedules = (filter = {}) => FeeSchedule.find(filter).sort({ createdAt: -1 }).exec();

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
async function beginPayment({ invoiceId, providerKey = 'paystack' }) {
  const invoice = await Invoice.findById(invoiceId).exec();
  if (!invoice) throw new ValidationError('No such invoice');

  const provider = PROVIDERS[providerKey];
  if (!provider) throw new ValidationError(`Unknown provider: ${providerKey}`);

  const outstanding = money.subtract(invoice.amountDue, invoice.amountPaid);
  if (money.isFree(outstanding)) throw new ValidationError('This invoice is already settled');

  const user = await User.findById(invoice.userId).exec();
  const reference = `${currentTenantId()}_${invoice._id}_${crypto.randomBytes(4).toString('hex')}`;

  const init = await provider.initialize({
    invoice,
    amount: outstanding,
    email: user?.email,
    reference,
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

  const manual = ['bank_transfer', 'cash', 'waiver'].includes(method);
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

  // reference format: <tenantId>_<invoiceId>_<rand>
  const invoiceId = String(parsed.reference).split('_')[1];
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
  return { invoice, user, payments, outstanding: money.subtract(invoice.amountDue, invoice.amountPaid) };
}

module.exports = {
  listSchedules, createSchedule,
  raiseInvoice, invoiceFor, invoiceView,
  beginPayment, recordPayment, confirmBankTransfer, waive, paymentsFor,
  handleWebhook,
  PROVIDERS,
};
