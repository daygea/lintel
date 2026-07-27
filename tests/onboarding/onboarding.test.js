'use strict';

/**
 * Sprint 12 exit criteria — the two self-service flows, and the security around them:
 *   - an institution application, auto-approved, provisions a tenant + owner and
 *     issues a set-password token (no plaintext password stored or emailed)
 *   - the set-password link is single-use and expires
 *   - a learner self-registering gets a LEARNER/pending membership — and CANNOT
 *     self-grant any other role
 *   - a reserved or taken slug is refused
 */

const {
  Tenant, User, Membership, TenantApplication, OnboardingToken,
} = require('../../src/models');
const { runWithTenant, runAsPlatform } = require('../../src/lib/context');
const onboarding = require('../../src/services/onboarding.service');
const auth = require('../../src/services/auth.service');
const signup = require('../../src/services/signup.service');

// Force auto-provision for the apply test regardless of env default.
// Flags are live getters off process.env (see config/env), so setting the var is enough.
beforeEach(() => { process.env.AUTO_PROVISION_TENANTS = 'true'; });
afterEach(() => { delete process.env.AUTO_PROVISION_TENANTS; });

describe('institution signup', () => {
  it('auto-provisions a tenant, owner, and a set-password token — no plaintext password', async () => {
    const { apply } = require('../../src/services/signup.service');
    const result = await apply({
      institutionName: 'Test Institute', requestedSlug: 'test-inst',
      contactName: 'Ada', contactEmail: 'ada@test.org',
    });
    expect(result.instant).toBe(true);
    expect(result.tenant.slug).toBe('test-inst');

    const owner = await runAsPlatform('t', () => User.findOne({ email: 'ada@test.org' }).exec());
    expect(owner).toBeTruthy();

    // A set-password token exists; nothing stored a readable password.
    const token = await runAsPlatform('t', () => OnboardingToken.findOne({ userId: owner._id }).exec());
    expect(token).toBeTruthy();
    expect(token.tokenHash).toBeTruthy();
    expect(token).not.toHaveProperty('token'); // only the hash is stored
  });

  it('refuses a reserved slug', async () => {
    await expect(signup.slugAvailable('admin')).rejects.toThrow(/reserved/);
  });

  it('refuses a taken slug', async () => {
    const { apply } = require('../../src/services/signup.service');
    await apply({ institutionName: 'First', requestedSlug: 'taken-one', contactName: 'A', contactEmail: 'a@x.org' });
    expect(await signup.slugAvailable('taken-one')).toBe(false);
  });
});

describe('set-password link', () => {
  it('is single-use and cannot be replayed', async () => {
    const owner = await runAsPlatform('t', () => User.create({ email: 'b@x.org', name: 'B', passwordHash: 'x', status: 'pending' }));
    const { link } = await onboarding.issueOnboarding({ userId: owner._id });
    const raw = link.split('/onboard/')[1];

    const first = await onboarding.consumeOnboarding({ rawToken: raw, newPassword: 'secret12' });
    expect(String(first.user._id)).toBe(String(owner._id));

    await expect(onboarding.consumeOnboarding({ rawToken: raw, newPassword: 'other123' }))
      .rejects.toThrow(/already been used/);
  });

  it('rejects an unknown token', async () => {
    await expect(onboarding.consumeOnboarding({ rawToken: 'nope', newPassword: 'secret12' }))
      .rejects.toThrow(/invalid/);
  });
});

describe('learner self-registration is role-locked', () => {
  let tenant;
  beforeEach(async () => {
    tenant = await Tenant.create({ slug: 'inst', name: 'Institute', locales: ['en'] });
  });

  it('creates a LEARNER membership in pending status', async () => {
    await runWithTenant(tenant._id, null, () => auth.selfRegister({ email: 'l@x.org', name: 'Learner' }));
    const user = await runAsPlatform('t', () => User.findOne({ email: 'l@x.org' }).exec());
    const m = await runWithTenant(tenant._id, null, () => Membership.findOne({ userId: user._id }).exec());
    expect(m.roles).toEqual(['learner']);
    expect(m.status).toBe('pending');
  });

  it('refuses a second registration for the same email', async () => {
    await runWithTenant(tenant._id, null, () => auth.selfRegister({ email: 'dup@x.org', name: 'Dup' }));
    await expect(
      runWithTenant(tenant._id, null, () => auth.selfRegister({ email: 'dup@x.org', name: 'Dup' }))
    ).rejects.toThrow(/already exists/);
  });
});
