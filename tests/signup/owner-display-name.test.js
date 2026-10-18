'use strict';

/**
 * Per-tenant owner name (Oct-2026 identity fix). The owner's Membership carries a
 * displayName set from the application's contact name — even when the owner User
 * already exists under another institution's name — so each institution shows the
 * name it supplied, and the shared global User.name is never overwritten.
 */

const { User, Membership } = require('../../src/models');
const { runWithTenant, runAsPlatform } = require('../../src/lib/context');
const signup = require('../../src/services/signup.service');

beforeEach(() => { process.env.AUTO_PROVISION_TENANTS = 'true'; });
afterEach(() => { delete process.env.AUTO_PROVISION_TENANTS; });

const membershipFor = (tenant, userId) =>
  runWithTenant(tenant._id, userId, () => Membership.findOne({ userId }).exec());

it('sets the owner membership displayName from the application contact name', async () => {
  const { tenant } = await signup.apply({
    institutionName: 'Alpha Institute', requestedSlug: 'alpha-inst',
    contactName: 'Ada Alpha', contactEmail: 'owner@shared.org',
  });
  const owner = await runAsPlatform('t', () => User.findOne({ email: 'owner@shared.org' }).exec());
  const m = await membershipFor(tenant, owner._id);
  expect(m.displayName).toBe('Ada Alpha');
});

it('reuses an existing owner but gives the new institution its own name, leaving the global name untouched', async () => {
  // First institution creates the global User with name 'Ada Alpha'.
  await signup.apply({
    institutionName: 'Alpha Institute', requestedSlug: 'alpha-inst',
    contactName: 'Ada Alpha', contactEmail: 'owner@shared.org',
  });
  const owner = await runAsPlatform('t', () => User.findOne({ email: 'owner@shared.org' }).exec());

  // Second institution: SAME email, DIFFERENT submitted name.
  const second = await signup.apply({
    institutionName: 'Beta College', requestedSlug: 'beta-college',
    contactName: 'Dr. A. Beta', contactEmail: 'owner@shared.org',
  });

  // The global User is reused and its name is NOT overwritten.
  const reused = await runAsPlatform('t', () => User.findById(owner._id).exec());
  expect(String(reused._id)).toBe(String(owner._id)); // same account reused
  expect(reused.name).toBe('Ada Alpha');              // global name untouched

  // But Beta's membership shows Beta's chosen name, not Alpha's.
  const mBeta = await membershipFor(second.tenant, owner._id);
  expect(mBeta.displayName).toBe('Dr. A. Beta');
});
