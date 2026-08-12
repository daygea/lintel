'use strict';

/**
 * The console overview summarises live institutions, recurring value (active paid
 * subscriptions only), 7-day attention signals, 30-day revenue, and deletions.
 */

const { Tenant, PlatformPayment } = require('../../src/models');
const platform = require('../../src/services/platform.service');
const { PLANS } = require('../../src/config/plans');

it('summarises institutions, recurring value, attention, and deletions', async () => {
  const now = Date.now();
  await Tenant.create({ slug: 'inst-a', name: 'A', locales: ['en'], status: 'active', plan: 'institute' });
  await Tenant.create({ slug: 'inst-b', name: 'B', locales: ['en'], status: 'active', plan: 'institute', currentPeriodEnd: new Date(now + 3 * 864e5) }); // lapsing soon
  await Tenant.create({ slug: 'trial-a', name: 'T', locales: ['en'], status: 'trial', plan: 'trial', trialEndsAt: new Date(now + 3 * 864e5) }); // expiring soon
  await Tenant.create({ slug: 'susp-a', name: 'S', locales: ['en'], status: 'suspended', plan: 'institute' });
  await Tenant.create({ slug: 'closed-a', name: 'C', locales: ['en'], status: 'closed', plan: 'trial' });
  const del = await Tenant.create({ slug: 'del-a', name: 'D', locales: ['en'], status: 'deleted', plan: 'trial', deletedAt: new Date() });

  await PlatformPayment.create({ tenantId: del._id, plan: 'institute', amount: { amount: 5000000, currency: 'NGN' }, provider: 'paystack', providerRef: 'r1', paidAt: new Date() });

  const o = await platform.overview();

  expect(o.tenants).toBe(4); // active(2) + trial(1) + suspended(1); excludes closed + deleted
  expect(o.mrr).toBe(PLANS.institute.price.amount * 2); // only the 2 ACTIVE institutes
  expect(o.deletedCount).toBe(1);
  expect(o.recentDeletions.map((d) => d.slug)).toContain('del-a');
  expect(o.trialsExpiring).toBe(1);
  expect(o.subsLapsing).toBe(1);
  expect((o.revenue.find((r) => r._id === 'NGN') || {}).total).toBe(5000000);
});
