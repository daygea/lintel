'use strict';

/**
 * A course cover is an optional reference to an image Asset. Setting it stores the
 * id; clearing it (empty selection → null) removes it. Signing/serving is covered
 * by the learner payload; here we just pin the model + service behaviour.
 */

const mongoose = require('mongoose');
const { Tenant, Course } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const curriculum = require('../../src/services/curriculum.service');

let tenant;
const as = (fn) => runWithTenant(tenant._id, tenant._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'cover-t', name: 'C', locales: ['en'], status: 'active', plan: 'institute' });
});

it('sets and clears a course cover', async () => {
  const course = await as(() => Course.create({ code: 'IFA101', title: { en: 'Ifá' }, session: '2026', status: 'active' }));
  const assetId = new mongoose.Types.ObjectId();

  const set = await as(() => curriculum.updateCourse(course._id, { coverAssetId: assetId }));
  expect(String(set.coverAssetId)).toBe(String(assetId));

  const cleared = await as(() => curriculum.updateCourse(course._id, { coverAssetId: null }));
  expect(cleared.coverAssetId == null).toBe(true);
});
