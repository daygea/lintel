'use strict';

/**
 * Auth hardening (Oct-2026 audit): generic failures + no enumeration, single-use
 * TOTP, atomic single-use onboarding tokens, and changePassword invalidating other
 * sessions. The one-shot authenticate() contract is covered by mfa.test.js.
 */

const { authenticator } = require('otplib');
const { Tenant, User, OnboardingToken } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const auth = require('../../src/services/auth.service');
const onboarding = require('../../src/services/onboarding.service');
const { NotAuthenticatedError } = require('../../src/lib/errors');

let tenant, user;
const as = (fn) => runWithTenant(tenant._id, user ? user._id : null, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'harden', name: 'H', locales: ['en'], status: 'active' });
  user = await User.create({ email: 'u@x.io', name: 'U', passwordHash: await User.hashPassword('password12345') });
});

describe('password verification', () => {
  it('rejects an unknown email the same way as a wrong password', async () => {
    await expect(auth.authenticatePassword({ email: 'nobody@x.io', password: 'whatever12345' }))
      .rejects.toBeInstanceOf(NotAuthenticatedError);
    await expect(auth.authenticatePassword({ email: 'u@x.io', password: 'wrongpassword' }))
      .rejects.toBeInstanceOf(NotAuthenticatedError);
  });

  it('returns the user and mfaRequired=false for a correct password', async () => {
    const { user: u, mfaRequired } = await auth.authenticatePassword({ email: 'u@x.io', password: 'password12345' });
    expect(String(u._id)).toBe(String(user._id));
    expect(mfaRequired).toBe(false);
  });
});

describe('TOTP is single-use', () => {
  it('rejects a code that was just used', async () => {
    const { secret } = await as(() => auth.beginMfaSetup(user));
    await as(() => auth.confirmMfa(user, authenticator.generate(secret)));
    const fresh = await User.findById(user._id).exec();
    const code = authenticator.generate(secret);
    await auth.verifyTotp({ user: fresh, totp: code });                 // first use ok
    await expect(auth.verifyTotp({ user: fresh, totp: code }))          // replay blocked
      .rejects.toBeInstanceOf(NotAuthenticatedError);
  });
});

describe('onboarding token is atomically single-use', () => {
  it('cannot be consumed twice', async () => {
    const { link } = await onboarding.issueOnboarding({ userId: user._id, tenantId: tenant._id });
    const raw = link.split('/onboard/')[1];
    await onboarding.consumeOnboarding({ rawToken: raw, newPassword: 'brandnewpass123' });
    await expect(onboarding.consumeOnboarding({ rawToken: raw, newPassword: 'anotherpass123' }))
      .rejects.toThrow(/already been used/i);
  });
});

describe('changePassword', () => {
  it('rejects a wrong current password', async () => {
    await expect(auth.changePassword({ userId: user._id, currentPassword: 'nope', newPassword: 'newpassword12345' }))
      .rejects.toThrow(/current password/i);
  });

  it('changes the password and bumps sessionEpoch (invalidating other sessions)', async () => {
    const before = (await User.findById(user._id).exec()).sessionEpoch || 0;
    await auth.changePassword({ userId: user._id, currentPassword: 'password12345', newPassword: 'newpassword12345' });
    const after = await User.findById(user._id).select('+passwordHash').exec();
    expect(after.sessionEpoch).toBe(before + 1);
    expect(after.mustChangePassword).toBe(false);
    expect(await after.verifyPassword('newpassword12345')).toBe(true);
  });
});
