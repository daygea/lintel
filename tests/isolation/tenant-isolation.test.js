'use strict';

/**
 * THE SUITE THAT MATTERS.
 *
 * If this file goes red, stop what you are doing. A tenant reading another
 * tenant's data is not a bug to be triaged — it is the failure this product
 * exists to prevent, and it would end the OISS relationship on the day it
 * was discovered.
 *
 * Sprint 0 exit criteria live here.
 */

const { Tenant, User, Membership, AuditLog } = require('../../src/models');
const { runWithTenant, runAsPlatform } = require('../../src/lib/context');
const { NoTenantContextError, CrossTenantWriteError, ImmutableRecordError } = require('../../src/lib/errors');

let alpha, beta, userA, userB;

beforeEach(async () => {
  alpha = await Tenant.create({ slug: 'alpha', name: 'Alpha Institute' });
  beta = await Tenant.create({ slug: 'beta', name: 'Beta Institute' });
  userA = await User.create({ email: 'a@example.com', name: 'A', passwordHash: 'x', status: 'active' });
  userB = await User.create({ email: 'b@example.com', name: 'B', passwordHash: 'x', status: 'active' });

  await runWithTenant(alpha._id, userA._id, () =>
    Membership.create({ userId: userA._id, roles: ['learner'], status: 'active' })
  );
  await runWithTenant(beta._id, userB._id, () =>
    Membership.create({ userId: userB._id, roles: ['learner'], status: 'active' })
  );
});

describe('a query with no tenant context', () => {
  it('throws rather than leaking', async () => {
    await expect(Membership.find({})).rejects.toThrow(NoTenantContextError);
  });

  it('throws on write too', async () => {
    await expect(Membership.create({ userId: userA._id, roles: ['learner'] })).rejects.toThrow(
      NoTenantContextError
    );
  });
});

describe('tenant Alpha', () => {
  it('sees only its own members', async () => {
    const found = await runWithTenant(alpha._id, userA._id, () => Membership.find({}));
    expect(found).toHaveLength(1);
    expect(String(found[0].userId)).toBe(String(userA._id));
  });

  it('cannot read Beta’s member by id', async () => {
    const betaMembership = await runWithTenant(beta._id, userB._id, () => Membership.findOne({}));
    const stolen = await runWithTenant(alpha._id, userA._id, () =>
      Membership.findById(betaMembership._id)
    );
    expect(stolen).toBeNull();
  });

  it('cannot update Beta’s member', async () => {
    const betaMembership = await runWithTenant(beta._id, userB._id, () => Membership.findOne({}));
    await runWithTenant(alpha._id, userA._id, () =>
      Membership.updateOne({ _id: betaMembership._id }, { roles: ['admin'] })
    );
    const after = await runWithTenant(beta._id, userB._id, () => Membership.findById(betaMembership._id));
    expect(after.roles).toEqual(['learner']);
  });

  it('cannot delete Beta’s member', async () => {
    const betaMembership = await runWithTenant(beta._id, userB._id, () => Membership.findOne({}));
    await runWithTenant(alpha._id, userA._id, () => Membership.deleteOne({ _id: betaMembership._id }));
    const survivor = await runWithTenant(beta._id, userB._id, () => Membership.findById(betaMembership._id));
    expect(survivor).not.toBeNull();
  });

  it('cannot count Beta’s members', async () => {
    const n = await runWithTenant(alpha._id, userA._id, () => Membership.countDocuments({}));
    expect(n).toBe(1);
  });

  it('cannot aggregate across tenants', async () => {
    const rows = await runWithTenant(alpha._id, userA._id, () => Membership.aggregate([{ $group: { _id: '$tenantId', n: { $sum: 1 } } }]));
    expect(rows).toHaveLength(1);
    expect(String(rows[0]._id)).toBe(String(alpha._id));
  });

  it('cannot forge a foreign tenantId on save', async () => {
    await expect(
      runWithTenant(alpha._id, userA._id, () =>
        Membership.create({ tenantId: beta._id, userId: userA._id, roles: ['learner'] })
      )
    ).rejects.toThrow(CrossTenantWriteError);
  });

  it('cannot smuggle a foreign tenantId into a filter', async () => {
    await expect(
      runWithTenant(alpha._id, userA._id, () => Membership.find({ tenantId: beta._id }))
    ).rejects.toThrow(CrossTenantWriteError);
  });
});

describe('append-only collections', () => {
  it('accept writes', async () => {
    const log = await runWithTenant(alpha._id, userA._id, () =>
      AuditLog.create({ action: 'test.event', actorUserId: userA._id })
    );
    expect(log.action).toBe('test.event');
  });

  it('refuse updates', async () => {
    await runWithTenant(alpha._id, userA._id, () => AuditLog.create({ action: 'test.event' }));
    await expect(
      runWithTenant(alpha._id, userA._id, () => AuditLog.updateOne({}, { action: 'tampered' }))
    ).rejects.toThrow(ImmutableRecordError);
  });

  it('refuse deletes', async () => {
    await runWithTenant(alpha._id, userA._id, () => AuditLog.create({ action: 'test.event' }));
    await expect(
      runWithTenant(alpha._id, userA._id, () => AuditLog.deleteMany({}))
    ).rejects.toThrow(ImmutableRecordError);
  });
});

describe('platform context', () => {
  it('can read across tenants, and is greppable', async () => {
    const all = await runAsPlatform('isolation test: counting all memberships', () =>
      Membership.find({})
    );
    expect(all).toHaveLength(2);
  });
});
