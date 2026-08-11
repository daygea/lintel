'use strict';

/**
 * sweepTrials suspends trials whose window has lapsed and warns (once) those
 * ending within a week, leaving healthy trials alone.
 */

const { Tenant } = require('../../src/models');
const { sweepTrials } = require('../../src/services/billing.service');

const days = (n) => new Date(Date.now() + n * 864e5);

it('suspends lapsed trials, warns soon-to-end ones, leaves the rest', async () => {
  const lapsed = await Tenant.create({ slug: 'lapsed', name: 'Lapsed', locales: ['en'], status: 'trial', plan: 'trial', trialEndsAt: days(-1) });
  const soon = await Tenant.create({ slug: 'soon', name: 'Soon', locales: ['en'], status: 'trial', plan: 'trial', trialEndsAt: days(3) });
  const healthy = await Tenant.create({ slug: 'healthy', name: 'Healthy', locales: ['en'], status: 'trial', plan: 'trial', trialEndsAt: days(30) });
  const paid = await Tenant.create({ slug: 'paid', name: 'Paid', locales: ['en'], status: 'active', plan: 'institute' });

  const result = await sweepTrials();
  expect(result.suspended).toBe(1);
  expect(result.warned).toBe(1);

  expect((await Tenant.findById(lapsed._id)).status).toBe('suspended');
  const soonFresh = await Tenant.findById(soon._id);
  expect(soonFresh.status).toBe('trial');
  expect(soonFresh.trialWarnedAt).toBeTruthy();
  expect((await Tenant.findById(healthy._id)).status).toBe('trial');
  expect((await Tenant.findById(paid._id)).status).toBe('active');
});

it('is idempotent — a second sweep warns/suspends nothing new', async () => {
  await Tenant.create({ slug: 'soon2', name: 'S2', locales: ['en'], status: 'trial', plan: 'trial', trialEndsAt: days(3) });
  await sweepTrials();
  const second = await sweepTrials();
  expect(second.warned).toBe(0);
  expect(second.suspended).toBe(0);
});
