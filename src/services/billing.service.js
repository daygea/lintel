'use strict';

const crypto = require('crypto');
const { Tenant, Membership, User, PlatformAuditLog, PlatformPayment } = require('../models');
const { runAsPlatform, runWithTenant, currentTenantId } = require('../lib/context');
const { PLANS } = require('../config/plans');
const { PaystackProvider } = require('./commerce/providers/paystack');
const money = require('../lib/money');
const { ValidationError } = require('../lib/errors');
const { notify } = require('./notification');

const paystack = new PaystackProvider();

const DAY = 864e5;

function periodEndFrom(now, cycle) {
  const d = new Date(now);
  if (cycle === 'annual') d.setFullYear(d.getFullYear() + 1);
  else d.setDate(d.getDate() + 30); // monthly (default)
  return d;
}

// Best-effort owner notice. The trial belongs to the institution's owner; find
// them via their membership and email them. Never let a failed notice block the
// status change.
async function notifyOwner(tenant, template, data) {
  try {
    const owner = await runWithTenant(tenant._id, null, () =>
      Membership.findOne({ roles: 'owner', status: 'active' }).exec());
    if (!owner) return;
    await runWithTenant(tenant._id, owner.userId, () =>
      notify({ userId: owner.userId, template, data, channels: ['email'] }));
  } catch (err) { /* best-effort */ }
}

/**
 * Move trials through their lifecycle: warn owners whose trial ends within a week
 * (once), then suspend trials that have lapsed. Intended to run daily (see
 * scripts/sweep-trials.js). Idempotent — re-running does nothing new.
 *
 * Reactivation (a suspended tenant paying to come back) belongs to the billing
 * step; this only handles the trial→suspended transition and the notices.
 */
async function sweepTrials(now = new Date()) {
  return runAsPlatform('sweep trials', async () => {
    const warnBy = new Date(now.getTime() + 7 * DAY);

    const expiringSoon = await Tenant.find({
      status: 'trial',
      trialEndsAt: { $gt: now, $lte: warnBy },
      trialWarnedAt: null,
    }).exec();
    for (const t of expiringSoon) {
      await notifyOwner(t, 'trial.ending', { institutionName: t.name, endsAt: t.trialEndsAt });
      t.trialWarnedAt = now;
      await t.save();
    }

    const lapsed = await Tenant.find({ status: 'trial', trialEndsAt: { $lte: now } }).exec();
    for (const t of lapsed) {
      t.status = 'suspended';
      await t.save();
      await notifyOwner(t, 'trial.suspended', { institutionName: t.name });
      await PlatformAuditLog.create({
        action: 'tenant.trial_suspended', subjectType: 'Tenant', subjectId: t._id,
        meta: { name: t.name, trialEndsAt: t.trialEndsAt },
      });
    }

    return { warned: expiringSoon.length, suspended: lapsed.length };
  });
}

/**
 * Start a plan subscription: initialise a Paystack payment (Lintel's account) for
 * the plan price and hand back the hosted-checkout URL. The reference is prefixed
 * `sub_` so the shared webhook routes it here, not to a learner invoice.
 * Runs in the tenant's context (the owner is upgrading their own institution).
 */
async function beginSubscription({ plan, returnUrl, email }) {
  const spec = PLANS[plan];
  if (!spec) throw new ValidationError(`Unknown plan: ${plan}`);
  if (!spec.price || money.isFree(spec.price)) throw new ValidationError('That plan is free — no payment needed.');

  const tenantId = currentTenantId();
  const reference = `sub_${tenantId}_${plan}_${crypto.randomBytes(4).toString('hex')}`;
  const init = await paystack.initialize({ amount: spec.price, email, reference, callbackUrl: returnUrl });
  return { authorizationUrl: init.authorizationUrl, reference: init.reference };
}

/**
 * Apply a successful plan payment (called by the webhook): record it, set the plan
 * + features, mark the tenant active, and extend the paid period. Idempotent on
 * providerRef, so repeated webhook deliveries move the money and the period once.
 */
async function activateSubscription({ tenantId, plan, providerRef, amount }) {
  const spec = PLANS[plan];
  if (!spec) return { ignored: 'unknown_plan' };

  return runAsPlatform('activate subscription', async () => {
    const existing = await PlatformPayment.findOne({ tenantId, providerRef }).exec();
    if (existing) return { alreadyProcessed: true };

    const tenant = await Tenant.findById(tenantId).exec();
    if (!tenant) return { ignored: 'no_tenant' };

    const periodEnd = periodEndFrom(new Date(), spec.cycle);
    await PlatformPayment.create({ tenantId, plan, amount, providerRef, provider: 'paystack', periodEnd });
    await Tenant.updateOne(
      { _id: tenantId },
      { plan, features: spec.features, status: 'active', currentPeriodEnd: periodEnd, trialWarnedAt: null }
    ).exec();
    await PlatformAuditLog.create({
      action: 'tenant.subscription_activated', subjectType: 'Tenant', subjectId: tenantId,
      meta: { plan, providerRef, periodEnd },
    });
    return { activated: true, plan };
  });
}

/**
 * Suspend paid tenants whose period has lapsed (they didn't renew). Complements
 * sweepTrials; run from the same daily job. Reactivation is a fresh subscription
 * payment.
 */
async function sweepSubscriptions(now = new Date()) {
  return runAsPlatform('sweep subscriptions', async () => {
    const lapsed = await Tenant.find({ status: 'active', currentPeriodEnd: { $lte: now } }).exec();
    for (const t of lapsed) {
      t.status = 'suspended';
      await t.save();
      await notifyOwner(t, 'subscription.lapsed', { institutionName: t.name });
      await PlatformAuditLog.create({
        action: 'tenant.subscription_lapsed', subjectType: 'Tenant', subjectId: t._id, meta: { plan: t.plan },
      });
    }
    return { suspended: lapsed.length };
  });
}

module.exports = { sweepTrials, sweepSubscriptions, beginSubscription, activateSubscription };
