'use strict';

const { Tenant, User, Asset, Job } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const { enqueue, claim } = require('../../src/lib/queue');

let alpha, beta, user;

beforeEach(async () => {
  alpha = await Tenant.create({ slug: 'alpha', name: 'Alpha' });
  beta = await Tenant.create({ slug: 'beta', name: 'Beta' });
  user = await User.create({ email: 'a@x.com', name: 'A', passwordHash: 'x', status: 'active' });
});

describe('assets', () => {
  it('belong to one institution and are invisible to another', async () => {
    await runWithTenant(alpha._id, user._id, () =>
      Asset.create({
        kind: 'audio',
        filename: 'lesson.mp3',
        mime: 'audio/mpeg',
        storageKey: 'k',
        status: 'ready',
      })
    );

    const seen = await runWithTenant(beta._id, user._id, () => Asset.find({}).exec());
    expect(seen).toHaveLength(0);
  });
});

describe('the job queue', () => {
  it('remembers which institution a job belongs to', async () => {
    await runWithTenant(alpha._id, user._id, () => enqueue('media.transcode', { assetId: 'x' }));
    const job = await claim(['media.transcode']);
    expect(String(job.tenantId)).toBe(String(alpha._id));
  });

  it('claims a job only once', async () => {
    await runWithTenant(alpha._id, user._id, () => enqueue('media.transcode', { assetId: 'x' }));

    const first = await claim(['media.transcode']);
    const second = await claim(['media.transcode']);

    expect(first).not.toBeNull();
    expect(second).toBeNull(); // already running — not handed out twice
  });

  it('does not hand a worker a job type it did not ask for', async () => {
    await runWithTenant(alpha._id, user._id, () => enqueue('something.else', {}));
    const job = await claim(['media.transcode']);
    expect(job).toBeNull();
  });
});
