'use strict';

/**
 * Media CRUD. rename changes the display name; delete removes the record and every
 * object it owns (original + derivatives + captions) from storage, and REFUSES if a
 * lesson block still references the file.
 */

const { Tenant, User, Asset, ContentBlock, Course, Module, Lesson } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const media = require('../../src/services/media.service');
const storage = require('../../src/lib/storage');

let tenant, user;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-media', name: 'Alpha', locales: ['en'], status: 'active' });
  user = await User.create({ email: 'm@x.io', name: 'M', passwordHash: await User.hashPassword('x'.repeat(12)) });
});

const seedAsset = () => as(() => Asset.create({
  kind: 'video', filename: 'lecture.mp4', mime: 'video/mp4', bytes: 1000,
  storageKey: 'orig/k1', status: 'ready',
  derivatives: [{ rung: 'video-360p', key: 'der/k2' }],
  captions: [{ locale: 'en', key: 'cap/k3' }],
}));

it('renames a file', async () => {
  const a = await seedAsset();
  await as(() => media.renameAsset(a._id, '  Week 1 lecture.mp4  '));
  const fresh = await as(() => Asset.findById(a._id).exec());
  expect(fresh.filename).toBe('Week 1 lecture.mp4');
});

it('deletes the record and every stored object', async () => {
  const a = await seedAsset();
  const delSpy = vi.spyOn(storage, 'del').mockResolvedValue({});
  const result = await as(() => media.deleteAsset(a._id));
  expect(result.deleted).toBe(true);
  expect(result.keysRemoved).toBe(3); // original + 1 derivative + 1 caption
  expect(delSpy.mock.calls.map((c) => c[0]).sort()).toEqual(['cap/k3', 'der/k2', 'orig/k1']);
  const gone = await as(() => Asset.findById(a._id).exec());
  expect(gone).toBeNull();
  delSpy.mockRestore();
});

it('refuses to delete a file still used in a lesson', async () => {
  const a = await seedAsset();
  await as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'C' }, status: 'active' });
    const mod = await Module.create({ courseId: course._id, title: { en: 'M' }, order: 0 });
    const lesson = await Lesson.create({ moduleId: mod._id, courseId: course._id, title: { en: 'L' }, order: 0 });
    await ContentBlock.create({ lessonId: lesson._id, type: 'video', assetId: a._id, order: 0 });
  });
  const delSpy = vi.spyOn(storage, 'del').mockResolvedValue({});
  await expect(as(() => media.deleteAsset(a._id))).rejects.toThrow(/used in 1 lesson/i);
  expect(delSpy).not.toHaveBeenCalled(); // nothing removed from storage
  const still = await as(() => Asset.findById(a._id).exec());
  expect(still).toBeTruthy();
  delSpy.mockRestore();
});
