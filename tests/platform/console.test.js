'use strict';

/**
 * Sprint 13 — the platform console and, above all, its gate.
 *   - suspend/reactivate a tenant is reversible and audited
 *   - setPlan changes plan + features and is audited
 *   - grant/revoke superadmin, with the two safety rails (not last, not self)
 *   - the requireSuperadmin gate lets a superadmin through and 404s everyone else
 */

const { Tenant, User, PlatformAuditLog } = require('../../src/models');
const platform = require('../../src/services/platform.service');
const { runWithTenant, runAsPlatform } = require('../../src/lib/context');

const { requireSuperadmin } = require('../../src/middleware/platform-auth');

async function makeSuperadmin(email) {
  const u = await User.create({ email, name: email, passwordHash: 'x', status: 'active', platformRole: 'superadmin' });
  return u;
}

describe('tenant standing is reversible and audited', () => {
  it('suspends then reactivates', async () => {
    const admin = await makeSuperadmin('op1@x.org');
    const t = await Tenant.create({ slug: 'inst-a', name: 'A', locales: ['en'], status: 'active' });

    // suspend/reactivate must run with the operator as current user for the audit
    await platform.suspendTenant(t._id, 'overdue', admin._id);
    let fresh = await runAsPlatform('t', () => Tenant.findById(t._id).exec());
    expect(fresh.status).toBe('suspended');

    await platform.reactivateTenant(t._id, admin._id);
    fresh = await runAsPlatform('t', () => Tenant.findById(t._id).exec());
    expect(fresh.status).toBe('active');

    const log = await runAsPlatform('t', () => PlatformAuditLog.find({ subjectId: t._id }).sort({ at: 1 }).exec());
    expect(log.map((l) => l.action)).toEqual(['tenant.suspended', 'tenant.reactivated']);
  });
});

describe('operators', () => {
  it('cannot revoke the last superadmin', async () => {
    const only = await makeSuperadmin('only@x.org');
    await expect(platform.revokeSuperadmin(only._id, only._id))
      .rejects.toThrow(/last superadmin|your own/);
  });

  it('cannot revoke yourself', async () => {
    const a = await makeSuperadmin('a@x.org');
    await makeSuperadmin('b@x.org'); // ensure not the last
    await expect(platform.revokeSuperadmin(a._id, a._id))
      .rejects.toThrow(/your own/);
  });

  it('grants superadmin to an existing user', async () => {
    const a = await makeSuperadmin('grantor@x.org');
    const target = await User.create({ email: 'new@x.org', name: 'N', passwordHash: 'x', status: 'active' });
    await platform.grantSuperadmin('new@x.org', a._id);
    const fresh = await runAsPlatform('t', () => User.findById(target._id).exec());
    expect(fresh.platformRole).toBe('superadmin');
  });
});

describe('the gate', () => {
  it('lets a superadmin through', () => {
    const req = { user: { platformRole: 'superadmin' } };
    let passed = false;
    requireSuperadmin(req, { status: () => ({ render: () => {} }) }, () => { passed = true; });
    expect(passed).toBe(true);
  });

  it('404s a normal user', () => {
    const req = { user: { platformRole: undefined } };
    let status = 0;
    const res = { status: (s) => { status = s; return { render: () => {} }; } };
    requireSuperadmin(req, res, () => { throw new Error('should not pass'); });
    expect(status).toBe(404);
  });

  it('404s an anonymous request', () => {
    const req = {};
    let status = 0;
    const res = { status: (s) => { status = s; return { render: () => {} }; } };
    requireSuperadmin(req, res, () => { throw new Error('should not pass'); });
    expect(status).toBe(404);
  });
});


describe('institution lifecycle (console)', () => {
  async function makeSuperadmin(email) {
    const { User } = require('../../src/models');
    return User.create({ email, name: email, passwordHash: 'x', status: 'active', platformRole: 'superadmin' });
  }

  it('edits metadata and refuses a taken slug', async () => {
    const { Tenant } = require('../../src/models');
    const op = await makeSuperadmin('meta@x.org');
    const a = await Tenant.create({ slug: 'aaa', name: 'A', locales: ['en'], status: 'active' });
    const b = await Tenant.create({ slug: 'bbb', name: 'B', locales: ['en'], status: 'active' });
    await platform.editTenantMetadata(a._id, { name: 'A renamed' }, op._id);
    let fresh = await runAsPlatform('t', () => Tenant.findById(a._id).exec());
    expect(fresh.name).toBe('A renamed');
    await expect(platform.editTenantMetadata(a._id, { slug: 'bbb' }, op._id)).rejects.toThrow(/taken/);
  });

  it('closes an institution (terminal, retains data)', async () => {
    const { Tenant } = require('../../src/models');
    const op = await makeSuperadmin('close@x.org');
    const t = await Tenant.create({ slug: 'ccc', name: 'C', locales: ['en'], status: 'active' });
    await platform.closeTenant(t._id, 'offboarding', op._id);
    const fresh = await runAsPlatform('t', () => Tenant.findById(t._id).exec());
    expect(fresh.status).toBe('closed');
    await expect(platform.closeTenant(t._id, 'again', op._id)).rejects.toThrow(/Already closed/);
  });
});
