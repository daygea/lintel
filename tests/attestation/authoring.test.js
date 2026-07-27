'use strict';

/**
 * Attestation authoring: create a standing (type), attest a person to it (which
 * requires the issuer to hold the type's requiresIssuerRole — the integrity rule
 * that keeps standings from being self-granted), and revoke it (append-only).
 */

const { Tenant, User, Membership } = require('../../src/models');
const att = require('../../src/services/attestation.service');
const { runWithTenant } = require('../../src/lib/context');

describe('attestation authoring', () => {
  let tenantId, elderId, learnerId;
  beforeEach(async () => {
    const t = await Tenant.create({ slug: 'test-attest', name: 'T', locales: ['en'], status: 'active' });
    tenantId = t._id;
    await runWithTenant(tenantId, null, async () => {
      const elder = await User.create({ email: 'elder@x.org', name: 'Elder', passwordHash: 'x', status: 'active' });
      const learner = await User.create({ email: 'learner@x.org', name: 'Learner', passwordHash: 'x', status: 'active' });
      elderId = elder._id;
      learnerId = learner._id;
      await Membership.create({ userId: elder._id, roles: ['elder'], status: 'active' });
      await Membership.create({ userId: learner._id, roles: ['learner'], status: 'active' });
    });
  });

  it('an elder attests a standing, then revokes it', async () => {
    await runWithTenant(tenantId, elderId, async () => {
      await att.createType({ slug: 'initiated', label: { en: 'Initiated' }, requiresIssuerRole: 'elder' });

      const grant = await att.issue({ subjectUserId: learnerId, typeSlug: 'initiated' });
      expect(grant.status).toBe('active');

      // in force after issue
      let current = await att.currentFor(learnerId);
      expect(current.find((a) => a.typeSlug === 'initiated').inForce).toBe(true);

      // revocation is a NEW append-only tombstone pointing at the original;
      // the original row is never mutated.
      const revocation = await att.revoke({ attestationId: grant._id, reason: 'test' });
      expect(revocation.status).toBe('revoked');
      expect(String(revocation.revokesAttestationId)).toBe(String(grant._id));

      // no longer in force — currentFor takes the newest row per type
      current = await att.currentFor(learnerId);
      expect(current.find((a) => a.typeSlug === 'initiated').inForce).toBe(false);

      // revoking the tombstone itself is refused (it isn't active)
      await expect(att.revoke({ attestationId: revocation._id, reason: 'again' })).rejects.toThrow(/not active/);
    });
  });

  it('refuses to attest when the issuer lacks the required role', async () => {
    await runWithTenant(tenantId, elderId, async () => {
      await att.createType({ slug: 'examined', label: { en: 'Examined' }, requiresIssuerRole: 'elder' });
    });
    await runWithTenant(tenantId, learnerId, async () => {
      await expect(att.issue({ subjectUserId: learnerId, typeSlug: 'examined' }))
        .rejects.toThrow(/may grant|elder/);
    });
  });
});
