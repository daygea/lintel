'use strict';

/**
 * Fee authoring: a schedule's cost is expressed through its items[] (each a
 * labelled Money in integer minor units, invariant #7). There is NO top-level
 * amount. A schedule with no items is free — and free is first-class.
 */

const { Tenant } = require('../../src/models');
const commerce = require('../../src/services/commerce');
const { runWithTenant } = require('../../src/lib/context');

describe('fee authoring', () => {
  let tenantId;
  beforeEach(async () => {
    const t = await Tenant.create({ slug: 'test-fees', name: 'T', locales: ['en'], status: 'active' });
    tenantId = t._id;
  });

  it('creates a schedule whose total is carried by its items', async () => {
    await runWithTenant(tenantId, null, async () => {
      const sched = await commerce.createSchedule({
        label: { en: '2026 Tuition' },
        items: [
          { label: { en: 'Tuition' }, amount: { amount: 20000, currency: 'NGN' } },      // 200.00
          { label: { en: 'Registration' }, amount: { amount: 5000, currency: 'NGN' } },  // 50.00
        ],
      });
      expect(sched.items).toHaveLength(2);
      const total = sched.items.reduce((a, i) => a + i.amount.amount, 0);
      expect(total).toBe(25000);
      expect(sched.items[0].amount.currency).toBe('NGN');
    });
  });

  it('accepts a free schedule (no items)', async () => {
    await runWithTenant(tenantId, null, async () => {
      const free = await commerce.createSchedule({ label: { en: 'Bursary place' }, items: [] });
      expect(free.items).toHaveLength(0);
    });
  });

  it('rejects a schedule with no label', async () => {
    await runWithTenant(tenantId, null, async () => {
      await expect(commerce.createSchedule({ items: [] })).rejects.toThrow(/label/);
    });
  });
});
