'use strict';

/**
 * Proves the OISS configuration behaves as the six decisions require — using the
 * real slugs OISS chose. Note: this test names OISS's standings because it is
 * testing OISS's CONFIGURATION (data), not the engine (code). The engine files
 * remain free of these terms; check-no-tenant-terms scans src/, not tenant data.
 */

const { Tenant, User, Membership, AttestationType, EligibilityPolicy, Enrollment, Cohort, Course } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const att = require('../../src/services/attestation.service');
const { evaluate } = require('../../src/services/eligibility/evaluator');

let tenant, elder, assessor, head, registrar, learner;

const asElder = (fn) => runWithTenant(tenant._id, elder._id, fn);
const asAssessor = (fn) => runWithTenant(tenant._id, assessor._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'oiss', name: 'OISS', locales: ['en', 'yo'] });
  elder = await User.create({ email: 'e@x.com', name: 'Elder', passwordHash: 'x', status: 'active' });
  assessor = await User.create({ email: 'a@x.com', name: 'Assessor', passwordHash: 'x', status: 'active' });
  head = await User.create({ email: 'h@x.com', name: 'Head', passwordHash: 'x', status: 'active' });
  registrar = await User.create({ email: 'r@x.com', name: 'Registrar', passwordHash: 'x', status: 'active' });
  learner = await User.create({ email: 'l@x.com', name: 'Learner', passwordHash: 'x', status: 'active' });

  await runWithTenant(tenant._id, head._id, async () => {
    await Membership.create({ userId: elder._id, roles: ['elder'], status: 'active' });
    await Membership.create({ userId: assessor._id, roles: ['assessor'], status: 'active' });
    await Membership.create({ userId: head._id, roles: ['owner'], status: 'active' });
    await Membership.create({ userId: registrar._id, roles: ['registrar'], status: 'active' });
    await Membership.create({ userId: learner._id, roles: ['learner'], status: 'active' });

    await AttestationType.create({ slug: 'itefa-standing', label: { en: 'Ìtẹ̀fá' }, requiresIssuerRole: 'elder', isSensitive: true });
    await AttestationType.create({ slug: 'practitioner-standing', label: { en: 'Practitioner' }, requiresIssuerRole: 'assessor', isSensitive: true, defaultValidityDays: 365 });
  });
});

describe('OISS issuer roles', () => {
  it('an elder may confer initiation', async () => {
    const a = await asElder(() => att.issue({ subjectUserId: learner._id, typeSlug: 'itefa-standing' }));
    expect(a.status).toBe('active');
  });

  it('an assessor may NOT confer initiation', async () => {
    await expect(
      asAssessor(() => att.issue({ subjectUserId: learner._id, typeSlug: 'itefa-standing' }))
    ).rejects.toThrow(/Only a elder may grant/);
  });

  it('an assessor may confer practitioner standing', async () => {
    const a = await asAssessor(() => att.issue({ subjectUserId: learner._id, typeSlug: 'practitioner-standing' }));
    expect(a.status).toBe('active');
  });

  it('an elder may NOT confer practitioner standing', async () => {
    await expect(
      asElder(() => att.issue({ subjectUserId: learner._id, typeSlug: 'practitioner-standing' }))
    ).rejects.toThrow(/Only a assessor may grant/);
  });
});

describe('practitioner standing expires; initiation does not', () => {
  it('sets an expiry on practitioner standing from defaultValidityDays', async () => {
    const a = await asAssessor(() => att.issue({ subjectUserId: learner._id, typeSlug: 'practitioner-standing' }));
    expect(a.expiresAt).toBeInstanceOf(Date);
    expect(a.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('leaves initiation permanent (no expiry)', async () => {
    const a = await asElder(() => att.issue({ subjectUserId: learner._id, typeSlug: 'itefa-standing' }));
    expect(a.expiresAt).toBeUndefined();
  });
});

describe('an expired practitioner standing fails the attestation rule', () => {
  it('withholds when the standing has lapsed', async () => {
    // issue with an expiry in the past by writing directly through the service then ageing it
    const a = await asAssessor(() => att.issue({ subjectUserId: learner._id, typeSlug: 'practitioner-standing' }));
    // Simulate lapse: the rule checks expiresAt < now. Re-evaluate with a now in the future.
    const policy = { rules: [{ type: 'attestation', params: { typeSlug: 'practitioner-standing', mustBeUnexpired: true } }], combinator: 'all', denialMessage: { en: 'held' } };

    const future = new Date(a.expiresAt.getTime() + 86400000);
    const verdict = await runWithTenant(tenant._id, learner._id, () =>
      evaluate(policy, { userId: learner._id, now: future })
    );
    expect(verdict.allowed).toBe(false);
  });
});
