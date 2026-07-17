'use strict';

/**
 * Sprint 4 exit criteria. The assertions that matter:
 *   - a held lesson returns the institution's words, not media
 *   - the pack endpoint REFUSES a stream-only lesson (server-side, authoritative)
 *   - a lesson with archive material can never be packed
 *   - every view is logged
 */

const {
  Tenant, User, Membership, Course, Module, Lesson, ContentBlock, ContentPolicy,
  Enrollment, Cohort, EligibilityPolicy, AttestationType, Asset, AccessLog,
} = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const learner = require('../../src/services/learner.service');

let tenant, user;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);

async function buildLesson({ policyId, blockPolicy, withArchive } = {}) {
  return as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'Course' } });
    const mod = await Module.create({ courseId: course._id, title: { en: 'M' } });
    const lesson = await Lesson.create({
      moduleId: mod._id, courseId: course._id, title: { en: 'Lesson' },
      eligibilityPolicyId: policyId,
    });
    const cohort = await Cohort.create({ courseId: course._id, title: { en: 'R' }, session: '2026/2027' });
    await Enrollment.create({ userId: user._id, courseId: course._id, cohortId: cohort._id, status: 'active' });

    if (withArchive) {
      await ContentBlock.create({
        lessonId: lesson._id, type: 'archive_ref',
        archiveRef: { archiveId: 'a', accessionNumber: 'ARC/1', consentTier: 3 },
      });
    } else {
      const asset = await Asset.create({ kind: 'audio', filename: 'a.mp3', mime: 'audio/mpeg', storageKey: 'k', status: 'ready', derivatives: [] });
      await ContentBlock.create({ lessonId: lesson._id, type: 'audio', assetId: asset._id, contentPolicyId: blockPolicy });
    }
    return lesson;
  });
}

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'inst', name: 'Institute', locales: ['en'] });
  user = await User.create({ email: 'l@x.com', name: 'Learner', passwordHash: 'x', status: 'active' });
  await as(() => Membership.create({ userId: user._id, roles: ['learner'], status: 'active' }));
});

describe('held teachings', () => {
  it("return the institution\u2019s words, not media", async () => {
    const policy = await as(() => EligibilityPolicy.create({
      slug: 'p', label: { en: 'P' }, combinator: 'all',
      rules: [{ type: 'attestation', params: { typeSlug: 'some-standing' } }],
      denialMessage: { en: 'This teaching is held until your standing is attested.' },
    }));
    const lesson = await buildLesson({ policyId: policy._id });

    const result = await as(() => learner.lessonFor({ lessonId: lesson._id, userId: user._id }));
    expect(result.held).toBe(true);
    expect(result.message).toMatch(/held until your standing/);
    expect(result.blocks).toBeUndefined();
  });
});

describe('offline packs', () => {
  it('are refused for a stream-only lesson', async () => {
    const streamOnly = await as(() => ContentPolicy.create({ slug: 'so', label: { en: 'SO' }, streamOnly: true }));
    const lesson = await buildLesson({ blockPolicy: streamOnly._id });
    await expect(
      as(() => learner.packFor({ lessonId: lesson._id, userId: user._id }))
    ).rejects.toThrow(/stream-only/);
  });

  it('are allowed for a downloadable lesson', async () => {
    const open = await as(() => ContentPolicy.create({ slug: 'op', label: { en: 'Open' }, downloadable: true, offlineCacheable: true }));
    const lesson = await buildLesson({ blockPolicy: open._id });
    const pack = await as(() => learner.packFor({ lessonId: lesson._id, userId: user._id }));
    expect(pack.offlineCacheable).toBe(true);
    expect(pack.blocks.length).toBeGreaterThan(0);
  });

  it('are never allowed for a lesson with archive material', async () => {
    const lesson = await buildLesson({ withArchive: true });
    await expect(
      as(() => learner.packFor({ lessonId: lesson._id, userId: user._id }))
    ).rejects.toThrow(/archive material/);
  });
});

describe('access logging', () => {
  it('logs a view when a block is rendered', async () => {
    const open = await as(() => ContentPolicy.create({ slug: 'op2', label: { en: 'O' }, downloadable: true }));
    const lesson = await buildLesson({ blockPolicy: open._id });
    await as(() => learner.lessonFor({ lessonId: lesson._id, userId: user._id }));

    const views = await as(() => AccessLog.find({ action: 'view' }).exec());
    expect(views.length).toBeGreaterThan(0);
  });
});
