'use strict';

const { Tenant, ContentPolicy, ContentBlock, Lesson, Module, Course, AccessLog } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const { onConsentRevoked } = require('../../src/services/archive.service');
const { ImmutableRecordError } = require('../../src/lib/errors');

let tenant;
const as = (fn) => runWithTenant(tenant._id, null, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'inst', name: 'Institute', locales: ['en'] });
});

describe('content policy reconciles offline and restricted', () => {
  it('cannot be offline-cacheable without being downloadable', async () => {
    const p = await as(() =>
      ContentPolicy.create({ slug: 'p1', label: { en: 'P' }, offlineCacheable: true, downloadable: false })
    );
    expect(p.offlineCacheable).toBe(false);
  });

  it('stream-only forces download and offline off', async () => {
    const p = await as(() =>
      ContentPolicy.create({ slug: 'p2', label: { en: 'P' }, streamOnly: true, downloadable: true, offlineCacheable: true })
    );
    expect(p.downloadable).toBe(false);
    expect(p.offlineCacheable).toBe(false);
  });
});

describe('access log is append-only', () => {
  it('refuses updates', async () => {
    const e = await as(() => AccessLog.create({ action: 'view', subjectType: 'Lesson' }));
    await expect(
      as(() => AccessLog.updateOne({ _id: e._id }, { action: 'denied' }).exec())
    ).rejects.toThrow(ImmutableRecordError);
  });
});

describe('archive consent revocation', () => {
  it('withholds every block that references the accession, and logs it', async () => {
    const block = await as(async () => {
      const c = await Course.create({ code: 'C', title: { en: 'C' } });
      const m = await Module.create({ courseId: c._id, title: { en: 'M' } });
      const l = await Lesson.create({ moduleId: m._id, courseId: c._id, title: { en: 'L' } });
      return ContentBlock.create({
        lessonId: l._id,
        type: 'archive_ref',
        archiveRef: { archiveId: 'a', accessionNumber: 'ARC/2026/00417', consentTier: 3 },
      });
    });

    const result = await as(() => onConsentRevoked({ accessionNumber: 'ARC/2026/00417', reason: 'withdrawn' }));
    expect(result.affectedBlocks).toBe(1);

    const after = await as(() => ContentBlock.findById(block._id).exec());
    expect(after.archiveRef.available).toBe(false);
    expect(after.archiveRef.consentTier).toBe(3); // the tier they agreed to is unchanged
    expect(after.archiveRef.revocationReason).toBe('withdrawn');
    expect(after.previewable).toBe(false);

    const log = await as(() => AccessLog.find({ accessionNumber: 'ARC/2026/00417' }).exec());
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].failedRules).toContain('consent_revoked');
  });

  it('refuses to resolve a playback URL for a revoked reference, even if asked directly', async () => {
    const { accessUrl } = require('../../src/services/archive.service');
    const block = await as(async () => {
      const c = await Course.create({ code: 'C2', title: { en: 'C' } });
      const m = await Module.create({ courseId: c._id, title: { en: 'M' } });
      const l = await Lesson.create({ moduleId: m._id, courseId: c._id, title: { en: 'L' } });
      return ContentBlock.create({
        lessonId: l._id,
        type: 'archive_ref',
        archiveRef: { archiveId: 'a', accessionNumber: 'ARC/2026/00999', consentTier: 2 },
      });
    });

    await as(() => onConsentRevoked({ accessionNumber: 'ARC/2026/00999', reason: 'withdrawn' }));
    const revoked = await as(() => ContentBlock.findById(block._id).exec());

    await expect(as(() => accessUrl({ block: revoked }))).rejects.toThrow(/withdrew consent/);
  });
});
