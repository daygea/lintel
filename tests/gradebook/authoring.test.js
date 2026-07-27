'use strict';

/**
 * Gradebook authoring: create a scheme (categories + bands), a line item on a
 * course, and enter a hand score against it.
 */

const { Tenant } = require('../../src/models');
const gb = require('../../src/services/gradebook.service');
const curriculum = require('../../src/services/curriculum.service');
const { runWithTenant } = require('../../src/lib/context');
const mongoose = require('mongoose');

describe('gradebook authoring', () => {
  let tenantId, courseId;
  beforeEach(async () => {
    const t = await Tenant.create({ slug: 'test-gb', name: 'T', locales: ['en'], status: 'active' });
    tenantId = t._id;
    await runWithTenant(tenantId, null, async () => {
      const c = await curriculum.createCourse({ code: 'C1', title: { en: 'Course' } });
      courseId = c._id;
    });
  });

  it('creates a scheme with categories and bands', async () => {
    await runWithTenant(tenantId, null, async () => {
      const scheme = await gb.upsertScheme({
        slug: 'diploma',
        label: { en: 'Diploma' },
        categories: [{ key: 'recitation', label: { en: 'Recitation' }, weight: 2 }],
        bands: [{ label: { en: 'Distinction' }, minPercent: 70 }],
        passPercent: 50,
      });
      expect(scheme.categories).toHaveLength(1);
      expect(scheme.bands[0].minPercent).toBe(70);
    });
  });

  it('creates a line item and records a score', async () => {
    await runWithTenant(tenantId, null, async () => {
      const li = await gb.createLineItem({ courseId, label: { en: 'Mid-term' }, category: 'recitation', maxPoints: 50 });
      expect(li._id).toBeTruthy();

      const learner = new mongoose.Types.ObjectId();
      const score = await gb.putScore({ lineItemId: li._id, userId: learner, points: 42 });
      expect(score.points).toBe(42);

      // idempotent — putting again updates, not duplicates
      const again = await gb.putScore({ lineItemId: li._id, userId: learner, points: 45 });
      expect(again.points).toBe(45);
    });
  });

  it('rejects a line item with no course', async () => {
    await runWithTenant(tenantId, null, async () => {
      await expect(gb.createLineItem({ label: { en: 'X' }, category: 'y' })).rejects.toThrow(/course/);
    });
  });
});
