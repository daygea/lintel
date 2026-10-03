'use strict';

/**
 * Apex /login must not 500 and must lead to the superadmin console (Oct-2026 audit).
 *
 * The bug: /login is mounted below the tenant resolver, which lets apex requests
 * through WITHOUT a tenant context. loadSession then ran a tenant-scoped Membership
 * query (→ NoTenantContextError → 500), and completeLogin would too. The page
 * rendered for a fresh visitor but died the moment the flow touched tenant data —
 * and there was no discoverable superadmin login.
 *
 * These tests exercise the two fixed seams directly (no HTTP harness in this repo):
 *   1. loadSession skips the Membership load when there is no tenant context.
 *   2. the login controller redirects apex requests to the console login.
 */

const { User } = require('../../src/models');
const { loadSession } = require('../../src/middleware/auth');
const authController = require('../../src/controllers/web/auth.controller');

function fakeRes() {
  return {
    locals: {},
    redirectedTo: null,
    redirect(url) { this.redirectedTo = url; },
  };
}

describe('apex /login', () => {
  it('loadSession on the apex (no tenant context) loads the user but never runs a tenant query', async () => {
    // User is platform-scoped, so this create needs no tenant context.
    const user = await User.create({ name: 'Ops', email: 'ops@lintel.africa', passwordHash: 'x', sessionEpoch: 0 });

    const req = { session: { userId: String(user._id), epoch: 0, destroy() {} } };
    const res = fakeRes();
    let nextErr = 'unset';
    // Called OUTSIDE runWithTenant — exactly the apex situation. Before the fix the
    // Membership.findOne here threw NoTenantContextError and next received it.
    await loadSession(req, res, (err) => { nextErr = err; });

    expect(nextErr).toBeUndefined();          // no 500 propagated
    expect(String(req.user._id)).toBe(String(user._id));
    expect(req.membership).toBeUndefined();   // tenant-scoped load was skipped
  });

  it('showLogin on the apex (no req.tenant) redirects to the console login', () => {
    const req = { tenant: undefined, user: undefined };
    const res = fakeRes();
    authController.showLogin(req, res);
    expect(res.redirectedTo).toBe('/console/login');
  });

  it('an already-signed-in superadmin on the apex is sent to the console', () => {
    const req = { tenant: undefined, user: { platformRole: 'superadmin' } };
    const res = fakeRes();
    authController.showLogin(req, res);
    expect(res.redirectedTo).toBe('/console');
  });

  it('POST login on the apex redirects to the console login instead of touching tenant data', async () => {
    const req = { tenant: undefined, user: undefined, body: { email: 'a@b.c', password: 'x' }, session: {} };
    const res = fakeRes();
    let nextErr = 'unset';
    await authController.login(req, res, (err) => { nextErr = err; });
    expect(res.redirectedTo).toBe('/console/login');
    expect(nextErr).toBe('unset');            // handler returned early; next never called
  });

  it('on a tenant host the login page still renders (no redirect)', () => {
    const req = { tenant: { _id: 'abc' }, user: undefined };
    const res = fakeRes();
    res.render = (view, data) => { res.rendered = { view, data }; };
    authController.showLogin(req, res);
    expect(res.redirectedTo).toBeNull();
    expect(res.rendered.view).toBe('auth/login');
  });
});
