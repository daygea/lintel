'use strict';

/**
 * Institution → Lintel billing: paying for a plan activates it (plan, features,
 * active status, a paid period) exactly once, free plans can't be paid for, and a
 * lapsed paid period is swept to suspended.
 */

const { Tenant, PlatformPayment } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const billing = require('../../src/services/billing.service');

const amount = { amount: 5000000, currency: 'NGN' };

it('rejects paying for a free plan', async () => {
  const t = await Tenant.create({ slug: 'free-p', name: 'F', locales: ['en'], status: 'trial', plan: 'trial' });
  await expect(
    runWithTenant(t._id, t._id, () => billing.beginSubscription({ plan: 'trial', returnUrl: 'https://x/y' }))
  ).rejects.toThrow(/free/i);
});

it('activates a paid plan once and is idempotent', async () => {
  const t = await Tenant.create({ slug: 'pay-p', name: 'P', locales: ['en'], status: 'trial', plan: 'trial', trialEndsAt: new Date() });

  const first = await billing.activateSubscription({ tenantId: t._id, plan: 'institute', providerRef: 'ref_1', amount });
  expect(first.activated).toBe(true);

  const fresh = await Tenant.findById(t._id);
  expect(fresh.plan).toBe('institute');
  expect(fresh.status).toBe('active');
  expect(fresh.features).toContain('commerce');
  expect(fresh.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
  expect(await PlatformPayment.countDocuments({ tenantId: t._id })).toBe(1);

  const again = await billing.activateSubscription({ tenantId: t._id, plan: 'institute', providerRef: 'ref_1', amount });
  expect(again.alreadyProcessed).toBe(true);
  expect(await PlatformPayment.countDocuments({ tenantId: t._id })).toBe(1);
});

it('suspends a lapsed paid subscription, leaves current ones', async () => {
  const lapsed = await Tenant.create({ slug: 'lapsed-s', name: 'L', locales: ['en'], status: 'active', plan: 'institute', currentPeriodEnd: new Date(Date.now() - 864e5) });
  const current = await Tenant.create({ slug: 'current-s', name: 'C', locales: ['en'], status: 'active', plan: 'institute', currentPeriodEnd: new Date(Date.now() + 864e5) });

  const result = await billing.sweepSubscriptions();
  expect(result.suspended).toBe(1);
  expect((await Tenant.findById(lapsed._id)).status).toBe('suspended');
  expect((await Tenant.findById(current._id)).status).toBe('active');
});
