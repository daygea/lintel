'use strict';

/**
 * Sprint 14 — abuse response and break-glass. The governance-critical suite.
 *   - force-logout invalidates existing sessions via sessionEpoch
 *   - suspend/reactivate a user, audited
 *   - a break-glass grant is time-boxed, records justification, notifies the owner,
 *     and is the ONLY thing that ever grants content access (there is no standing read)
 *   - break-glass expiry and revocation end access
 *   - a report can be filed and resolved
 */

const { Tenant, User, Membership, AbuseReport, BreakglassGrant, PlatformAuditLog, Notification } = require('../../src/models');
const platform = require('../../src/services/platform.service');
const { runAsPlatform, runWithTenant } = require('../../src/lib/context');

async function operator(email) {
  return User.create({ email, name: email, passwordHash: 'x', status: 'active', platformRole: 'superadmin' });
}

describe('force logout', () => {
  it('bumps sessionEpoch so old sessions are stale', async () => {
    const op = await operator('op@x.org');
    const u = await User.create({ email: 'u@x.org', name: 'U', passwordHash: 'x', status: 'active' });
    expect(u.sessionEpoch).toBe(0);
    await platform.forceLogout(u._id, op._id);
    const fresh = await runAsPlatform('t', () => User.findById(u._id).exec());
    expect(fresh.sessionEpoch).toBe(1); // a session issued at epoch 0 is now stale
  });
});

describe('user suspension', () => {
  it('suspends and reactivates, audited', async () => {
    const op = await operator('op2@x.org');
    const u = await User.create({ email: 'u2@x.org', name: 'U', passwordHash: 'x', status: 'active' });
    await platform.suspendUser(u._id, 'harassment', op._id);
    let fresh = await runAsPlatform('t', () => User.findById(u._id).exec());
    expect(fresh.status).toBe('suspended');
    await platform.reactivateUser(u._id, op._id);
    fresh = await runAsPlatform('t', () => User.findById(u._id).exec());
    expect(fresh.status).toBe('active');
    const log = await runAsPlatform('t', () => PlatformAuditLog.find({ subjectId: u._id }).sort({ at: 1 }).exec());
    expect(log.map((l) => l.action)).toEqual(['user.suspended', 'user.reactivated']);
  });
});

describe('break-glass is the only content path', () => {
  let op, tenant, owner;
  beforeEach(async () => {
    op = await operator('op3@x.org');
    tenant = await Tenant.create({ slug: 'inst', name: 'Institute', locales: ['en'], status: 'active' });
    owner = await User.create({ email: 'owner@x.org', name: 'Owner', passwordHash: 'x', status: 'active' });
    await runWithTenant(tenant._id, owner._id, () =>
      Membership.create({ userId: owner._id, roles: ['owner'], status: 'active' }));
  });

  it('requires a justification', async () => {
    await expect(platform.openBreakglass({ tenantId: tenant._id, justification: 'too short' }, op._id))
      .rejects.toThrow(/justification/);
  });

  it('opens a time-boxed grant, records it, and notifies the owner', async () => {
    const { grant } = await platform.openBreakglass(
      { tenantId: tenant._id, justification: 'credible report of illegal content', hours: 12 },
      op._id
    );
    expect(grant.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(grant.isActive()).toBe(true);

    // owner was notified
    const note = await runWithTenant(tenant._id, null, () =>
      Notification.findOne({ userId: owner._id, template: 'breakglass_notice' }).exec());
    expect(note).toBeTruthy();

    // it is recorded in the platform audit
    const log = await runAsPlatform('t', () => PlatformAuditLog.findOne({ action: 'breakglass.opened' }).exec());
    expect(log).toBeTruthy();
  });

  it('revocation ends access', async () => {
    const { grant } = await platform.openBreakglass(
      { tenantId: tenant._id, justification: 'investigating a serious report' },
      op._id
    );
    await platform.revokeBreakglass(grant._id, op._id);
    const fresh = await runAsPlatform('t', () => BreakglassGrant.findById(grant._id).exec());
    expect(fresh.isActive()).toBe(false);
  });

  it('an expired grant is not active', async () => {
    const g = await BreakglassGrant.create({
      tenantId: tenant._id, operatorUserId: op._id, justification: 'past window',
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(g.isActive()).toBe(false);
  });
});

describe('reports', () => {
  it('files and resolves a report', async () => {
    const op = await operator('op4@x.org');
    const r = await platform.fileReport({ subjectType: 'resource', subjectRef: '/some/path', category: 'illegal_content', detail: 'x' });
    expect(r.status).toBe('open');
    await platform.resolveReport(r._id, { status: 'dismissed', resolution: 'not substantiated' }, op._id);
    const fresh = await runAsPlatform('t', () => AbuseReport.findById(r._id).exec());
    expect(fresh.status).toBe('dismissed');
  });
});
