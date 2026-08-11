'use strict';

/**
 * On upload completion, audio is served immediately (ready) because browsers play
 * it natively; only video waits on the transcode worker. Images/PDFs are ready too.
 */

const { Tenant, User, Asset } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const media = require('../../src/services/media.service');
const storage = require('../../src/lib/storage');

let tenant, user;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-ar', name: 'Alpha', locales: ['en'], status: 'active' });
  user = await User.create({ email: 'm@x.io', name: 'M', passwordHash: await User.hashPassword('x'.repeat(12)) });
  vi.spyOn(storage, 'completeMultipart').mockResolvedValue({});
  vi.spyOn(storage, 'head').mockResolvedValue({ ContentLength: 1000 });
});

afterEach(() => vi.restoreAllMocks());

const seed = (kind, mime) => as(() => Asset.create({
  kind, filename: `f.${kind}`, mime, storageKey: `k-${kind}`, uploadId: 'u', status: 'uploading',
}));

const complete = (id) => as(() => media.completeUpload(id, { parts: [{ ETag: 'e', PartNumber: 1 }], checksum: 'c' }));

it('marks audio ready immediately on upload', async () => {
  const a = await seed('audio', 'audio/mpeg');
  const done = await complete(a._id);
  expect(done.status).toBe('ready');
});

it('keeps video in processing until the worker finishes', async () => {
  const v = await seed('video', 'video/mp4');
  const done = await complete(v._id);
  expect(done.status).toBe('processing');
});
