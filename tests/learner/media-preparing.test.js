'use strict';

/**
 * Media block states for a learner (renderBlock via lessonFor).
 * A still-transcoding asset must read as "being prepared" (transient), NOT the
 * same generic "unavailable" as a failed or withdrawn one — so a learner (and an
 * operator) can tell "the worker hasn't finished" from "this is gone".
 */

const {
  Tenant, User, Membership, Course, Module, Lesson, ContentBlock,
  Enrollment, Cohort, Asset,
} = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const learner = require('../../src/services/learner.service');

let tenant, user;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-media', name: 'Alpha', locales: ['en'], status: 'active' });
  user = await User.create({ email: 'l@x.io', name: 'Ada', passwordHash: await User.hashPassword('x'.repeat(12)) });
  await as(() => Membership.create({ userId: user._id, roles: ['learner'], status: 'active' }));
});

// Build an open lesson (no policy) carrying one audio block backed by an asset
// in the given status, and return the rendered block.
async function renderWithAssetStatus(status) {
  return as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'Course' }, status: 'active' });
    const mod = await Module.create({ courseId: course._id, title: { en: 'M' }, order: 0 });
    const lesson = await Lesson.create({ moduleId: mod._id, courseId: course._id, title: { en: 'Lesson' }, order: 0 });
    const cohort = await Cohort.create({ courseId: course._id, title: { en: 'R' }, session: '2026/2027' });
    await Enrollment.create({ userId: user._id, courseId: course._id, cohortId: cohort._id, status: 'active' });

    const asset = await Asset.create({ kind: 'audio', filename: 'a.mp3', mime: 'audio/mpeg', storageKey: 'k', status, derivatives: [] });
    await ContentBlock.create({ lessonId: lesson._id, type: 'audio', assetId: asset._id, order: 0 });

    const out = await learner.lessonFor({ lessonId: lesson._id, userId: user._id });
    return out.blocks[0];
  });
}

it('a transcoding (processing) asset renders as preparing, not unavailable', async () => {
  const block = await renderWithAssetStatus('processing');
  expect(block.preparing).toBe(true);
  expect(block.unavailable).toBeFalsy();
  expect(block.streamUrl).toBeUndefined();
  expect(block.reason).toMatch(/prepared/i);
});

it('a failed asset renders as unavailable', async () => {
  const block = await renderWithAssetStatus('failed');
  expect(block.unavailable).toBe(true);
  expect(block.preparing).toBeFalsy();
});
