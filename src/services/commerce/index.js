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
      settled: outstanding.amount <= 0 || inv.state === 'waived',
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
async function beginPayment({ invoiceId, providerKey = 'paystack', returnUrl, requireOwnerId }) {
  const invoice = await Invoice.findById(invoiceId).exec();
  if (!invoice) throw new ValidationError('No such invoice');

  // Ownership. A learner may only pay their OWN invoice. When a learner-facing
  // route calls this it passes requireOwnerId = req.user._id; staff routes omit it
  // (staff may raise a checkout link for any invoice in their tenant). Without this,
  // a learner could begin payment against — and probe the amount/status of — anyone's invoice.
  if (requireOwnerId && String(invoice.userId) !== String(requireOwnerId)) {
    throw new NotAuthorisedError('That invoice is not yours');
  }

  const provider = PROVIDERS[providerKey];
  if (!provider) throw new ValidationError(`Unknown provider: ${providerKey}`);

  const outstanding = money.subtract(invoice.amountDue, invoice.amountPaid);
  if (outstanding.amount <= 0) throw new ValidationError('This invoice is already settled');

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

  // Persist the reference so a return-from-checkout or the reconcile sweep can
  // re-verify it if the webhook is slow or never arrives. This is what makes the
  // webhook a fast path rather than the only path.
  await Invoice.updateOne(
    { _id: invoice._id },
    { pendingReference: init.reference, pendingReferenceAt: new Date() }
  ).exec();

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

  // Reject a currency mismatch BEFORE writing anything. Otherwise the Payment row is
  // created and the later tally (money.add) throws on mismatched currency — leaving the
  // invoice un-synced while the replay guard short-circuits every retry, so a learner
  // who has paid stays locked out forever. Fail before the row exists.
  if (amount && amount.currency !== invoice.amountDue.currency) {
    throw new ValidationError(
      `Payment currency ${amount && amount.currency} does not match invoice currency ${invoice.amountDue.currency}`
    );
  }

  // Idempotency: one Payment per providerRef.
  let payment = providerRef ? await Payment.findOne({ providerRef }).exec() : null;
  let replay = !!payment;

  if (!payment) {
    const manual = ['bank_transfer', 'cash', 'waiver', 'refund'].includes(method);
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
        payment = await Payment.findOne({ providerRef }).exec();
        replay = true;
      } else {
        throw err;
      }
    }
  }

  let state;
  if (replay) {
    // The payment already existed — this is a duplicate/retried delivery, possibly
    // after a previous attempt crashed between the row write and the invoice update.
    // Re-derive the tally from ALL rows so the invoice + enrolment converge to the
    // correct state instead of short-circuiting and leaving a paid learner locked out.
    logger.info({ providerRef }, 'payment already recorded — re-syncing invoice (idempotent)');
    ({ state } = await resyncInvoice(invoice));
  } else {
    // Normal path: move the running tally by this payment (a refund is negative).
    const outstandingBefore = money.subtract(invoice.amountDue, invoice.amountPaid);
    const newPaid = money.add(invoice.amountPaid, amount);
    state = invoice.state === 'waived' ? 'waived' : deriveState(invoice.amountDue, newPaid);

    // Flag an online payment that doesn't match what we asked for (#5). It's not an
    // error — instalments underpay by design — but a silent mismatch should be
    // visible, so it lands in the audit meta and the log rather than vanishing.
    const isOnline = provider === 'paystack';
    const mismatch = isOnline && amount.amount !== outstandingBefore.amount;
    if (mismatch) {
      logger.warn(
        { invoiceId: String(invoice._id), expected: outstandingBefore.amount, paid: amount.amount, providerRef },
        'online payment amount does not match outstanding balance'
      );
    }

    const patch = { amountPaid: newPaid, state };
    // A recorded online payment consumes its pending reference — clear it so the
    // reconcile sweep doesn't keep re-verifying a reference already settled.
    if (providerRef) { patch.pendingReference = null; patch.pendingReferenceAt = null; }
    await Invoice.updateOne({ _id: invoice._id }, patch).exec();
    await syncEnrollmentState(invoice.enrollmentId, state);
    await AuditLog.create({
      actorUserId: currentUserId(),
      action: 'payment.recorded',
      subjectType: 'Payment',
      subjectId: payment._id,
      meta: { method, amount: amount.amount, state, expected: outstandingBefore.amount, mismatch },
    });
  }

  return { invoice: await Invoice.findById(invoice._id).exec(), payment, replay };
}

/**
 * Recompute an invoice's paid tally as the SUM of every payment recorded against it
 * (a refund is a negative payment, so the sum is the true net paid), then persist the
 * derived state and sync the enrolment. Idempotent — safe to call on every (re)delivery.
 */
async function resyncInvoice(invoice) {
  const payments = await Payment.find({ invoiceId: invoice._id }).exec();
  let paid = money.zero(invoice.amountDue.currency);
  for (const p of payments) {
    // Defensive: ignore any legacy row in a foreign currency so a resync can never
    // throw and re-introduce the lockout it exists to prevent.
    if (!p.amount || p.amount.currency !== paid.currency) continue;
    paid = money.add(paid, p.amount);
  }
  // A waiver is a decision that outlives later ledger movement; a resync must not undo it.
  const state = invoice.state === 'waived' ? 'waived' : deriveState(invoice.amountDue, paid);
  await Invoice.updateOne({ _id: invoice._id }, { amountPaid: paid, state }).exec();
  await syncEnrollmentState(invoice.enrollmentId, state);
  return { paid, state };
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

/* -------------------------------------------------- verify-on-return / reconcile */

/**
 * Confirm a payment by its provider reference, server-side (#2, #3). The webhook is
 * the primary confirmation; this is the backstop for when it is slow or lost. Safe
 * to call from the payer's return-from-checkout and from the reconcile sweep: it
 * asks the provider whether the reference actually succeeded, and only then records
 * — through the same idempotent recordPayment, so running alongside the webhook can
 * never double-count.
 *
 * Runs inside a tenant context. The reference carries its tenant (`‹tenantId›_…`);
 * a reference for another tenant is ignored rather than acted on.
 */
async function confirmByReference(reference, { requireOwnerId, providerKey = 'paystack' } = {}) {
  if (!reference) return { paid: false, ignored: 'no_reference' };
  const parts = String(reference).split('_');
  if (parts[0] !== String(currentTenantId())) return { paid: false, ignored: 'foreign_tenant' };

  const invoiceId = parts[1];
  const invoice = await Invoice.findById(invoiceId).exec();
  if (!invoice) return { paid: false, ignored: 'no_invoice' };
  // On a learner's return we pass their id; a reference must resolve to their own
  // invoice. (Staff/reconcile omit this — they act for the whole tenant.)
  if (requireOwnerId && String(invoice.userId) !== String(requireOwnerId)) {
    return { paid: false, ignored: 'not_owner' };
  }

  const provider = PROVIDERS[providerKey];
  if (!provider) return { paid: false, ignored: 'unknown_provider' };

  const result = await provider.verify(reference);
  if (!result.paid) return { paid: false, invoice };

  const { invoice: updated } = await recordPayment({
    invoiceId,
    amount: result.amount,
    method: providerKey,
    provider: providerKey,
    providerRef: result.providerRef,
  });
  return { paid: true, invoice: updated };
}

/**
 * Sweep unsettled invoices that carry a pending online reference older than a grace
 * window, re-verify each with the provider, and record any that have actually
 * succeeded. The safety net under the webhook: a payment that completed while the
 * webhook was dropped or our endpoint was briefly down still reconciles. Runs inside
 * a tenant context (the cron iterates tenants). Idempotent throughout.
 */
async function reconcilePendingPayments({ olderThanMinutes = 10, providerKey = 'paystack' } = {}) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60000);
  const pending = await Invoice.find({
    state: { $in: ['unpaid', 'part', 'deposit', 'overdue'] },
    pendingReference: { $type: 'string' },
    pendingReferenceAt: { $lte: cutoff },
  }).exec();

  let recovered = 0;
  for (const inv of pending) {
    try {
      const r = await confirmByReference(inv.pendingReference, { providerKey });
      if (r.paid) recovered += 1;
    } catch (err) {
      logger.warn({ invoiceId: String(inv._id), err: err.message }, 'reconcile: verify failed, will retry next sweep');
    }
  }
  return { checked: pending.length, recovered };
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
  handleWebhook, confirmByReference, reconcilePendingPayments,
  PROVIDERS,
};
