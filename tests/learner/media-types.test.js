'use strict';

/**
 * Every media asset type is served to the learner as a playable, typed block —
 * not just audio/video. The learner PWA branches on `type` to pick the right
 * element (video/audio/img/iframe), so the server must preserve `type` and hand
 * back a streamUrl for image and pdf exactly as it does for audio and video.
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
  tenant = await Tenant.create({ slug: 'test-mediatypes', name: 'Alpha', locales: ['en'], status: 'active' });
  user = await User.create({ email: 'l@x.io', name: 'Ada', passwordHash: await User.hashPassword('x'.repeat(12)) });
  await as(() => Membership.create({ userId: user._id, roles: ['learner'], status: 'active' }));
});

// Build an open lesson carrying one ready media block of the given kind/type.
async function renderReadyBlock(kind, type) {
  return as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'Course' }, status: 'active' });
    const mod = await Module.create({ courseId: course._id, title: { en: 'M' }, order: 0 });
    const lesson = await Lesson.create({ moduleId: mod._id, courseId: course._id, title: { en: 'Lesson' }, order: 0 });
    const cohort = await Cohort.create({ courseId: course._id, title: { en: 'R' }, session: '2026/2027' });
    await Enrollment.create({ userId: user._id, courseId: course._id, cohortId: cohort._id, status: 'active' });

    const asset = await Asset.create({ kind, filename: `f.${kind}`, mime: `${kind}/x`, storageKey: 'k', status: 'ready', derivatives: [] });
    await ContentBlock.create({ lessonId: lesson._id, type, assetId: asset._id, order: 0 });

    const out = await learner.lessonFor({ lessonId: lesson._id, userId: user._id });
    return out.blocks[0];
  });
}

it.each([
  ['audio', 'audio'],
  ['video', 'video'],
  ['image', 'image'],
  ['pdf', 'pdf'],
])('serves a %s block as a typed, playable stream URL', async (kind, type) => {
  const block = await renderReadyBlock(kind, type);
  expect(block.type).toBe(type);
  expect(block.streamUrl).toBeTruthy();
  expect(block.unavailable).toBeFalsy();
  expect(block.preparing).toBeFalsy();
});
