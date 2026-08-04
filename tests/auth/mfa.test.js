'use strict';

/**
 * MFA setup. beginMfaSetup provisions a secret (disabled); confirmMfa turns it on
 * only for a valid code; disableMfa turns it off and forgets the secret. Login
 * then requires the code.
 */

const { authenticator } = require('otplib');
const { Tenant, User } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const auth = require('../../src/services/auth.service');

let tenant, user;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-mfa', name: 'Alpha', locales: ['en'], status: 'active' });
  user = await User.create({ email: 'u@x.io', name: 'U', passwordHash: await User.hashPassword('password12345') });
});

it('provisions a disabled secret on begin', async () => {
  const { secret, uri } = await as(() => auth.beginMfaSetup(user));
  expect(secret).toBeTruthy();
  expect(uri).toContain('otpauth://');
  const fresh = await as(() => User.findById(user._id).select('+mfa.secret').exec());
  expect(fresh.mfa.enabled).toBe(false);
  expect(fresh.mfa.secret).toBe(secret);
});

it('enables MFA only for a valid code', async () => {
  const { secret } = await as(() => auth.beginMfaSetup(user));
  await expect(as(() => auth.confirmMfa(user, '000000'))).rejects.toThrow(/not right/i);

  const token = authenticator.generate(secret);
  await as(() => auth.confirmMfa(user, token));
  const fresh = await as(() => User.findById(user._id).exec());
  expect(fresh.mfa.enabled).toBe(true);
});

it('login then requires the code', async () => {
  const { secret } = await as(() => auth.beginMfaSetup(user));
  await as(() => auth.confirmMfa(user, authenticator.generate(secret)));

  await expect(as(() => auth.authenticate({ email: 'u@x.io', password: 'password12345' })))
    .rejects.toThrow(/authenticator/i);
  const ok = await as(() => auth.authenticate({ email: 'u@x.io', password: 'password12345', totp: authenticator.generate(secret) }));
  expect(String(ok._id)).toBe(String(user._id));
});

it('disables MFA and forgets the secret', async () => {
  const { secret } = await as(() => auth.beginMfaSetup(user));
  await as(() => auth.confirmMfa(user, authenticator.generate(secret)));
  await as(() => auth.disableMfa(user));
  const fresh = await as(() => User.findById(user._id).select('+mfa.secret').exec());
  expect(fresh.mfa.enabled).toBe(false);
  expect(fresh.mfa.secret).toBeFalsy();
});
