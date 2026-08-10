'use strict';

/**
 * notify() must send a real subject string to the provider. Templates whose
 * subject is a FUNCTION of the data (e.g. account_created) previously resolved to
 * the function object, which JSON.stringify drops — so Resend received no subject
 * and rejected the send with 422. This drives notify through the live email path
 * (fetch stubbed) and asserts the subject arrives.
 */

const { Tenant, User } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const { notify } = require('../../src/services/notification');
const env = require('../../src/config/env');

let tenant, user, realIsTest;

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-subj', name: 'Alpha', locales: ['en'], status: 'active' });
  user = await User.create({ email: 'owner@x.io', name: 'Owner', passwordHash: await User.hashPassword('x'.repeat(12)) });
  realIsTest = env.isTest;
  env.isTest = false; // exercise the live send path (fetch is stubbed, never the network)
  vi.stubEnv('RESEND_API_KEY', 'test-key');
  vi.stubEnv('EMAIL_FROM', 'Lintel <no-reply@lintel.test>');
});

afterEach(() => {
  env.isTest = realIsTest;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function sentBody(template, data) {
  const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'r1' }) }));
  vi.stubGlobal('fetch', fetchSpy);
  await runWithTenant(tenant._id, user._id, () =>
    notify({ userId: user._id, template, data, channels: ['email'] }));
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  return JSON.parse(fetchSpy.mock.calls[0][1].body);
}

it('sends a resolved subject for a FUNCTION-subject template (account_created)', async () => {
  const body = await sentBody('account_created', { institutionName: 'OISS' });
  expect(body.subject).toBe('Your OISS account');
  expect(typeof body.subject).toBe('string');
});

it('still sends the subject for a STRING-subject template (enrollment.activated)', async () => {
  const body = await sentBody('enrollment.activated', { cohortTitle: 'Autumn' });
  expect(body.subject).toBe('You are enrolled');
});
