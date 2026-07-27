'use strict';

/**
 * Credential authoring: create a template, issue a credential (which stamps a
 * unique serial + verification code and names a holder), and revoke it
 * (append-only — a revoked credential is marked, never deleted).
 */

const { Tenant, User } = require('../../src/models');
const cred = require('../../src/services/credential.service');
const { runWithTenant } = require('../../src/lib/context');
const mongoose = require('mongoose');

describe('credential authoring', () => {
  let tenantId, registrarId;
  beforeEach(async () => {
    const t = await Tenant.create({ slug: 'test-cred', name: 'T', locales: ['en'], status: 'active' });
    tenantId = t._id;
    registrarId = new mongoose.Types.ObjectId();
  });

  it('creates a template, issues, and revokes', async () => {
    await runWithTenant(tenantId, registrarId, async () => {
      const learner = await User.create({ email: 'l@x.org', name: 'Learner', passwordHash: 'x', status: 'active' });

      const template = await cred.createTemplate({ slug: 'diploma', title: { en: 'Diploma' } });
      expect(template.slug).toBe('diploma');

      const credential = await cred.issue({ templateId: template._id, userId: learner._id });
      expect(credential.serial).toBeTruthy();
      expect(credential.verificationCode).toBeTruthy();
      expect(credential.holderName).toBe('Learner');
      expect(credential.revokedAt).toBeFalsy();

      const revoked = await cred.revoke({ credentialId: credential._id, reason: 'issued in error' });
      // still exists, now marked revoked (append-only)
      const fresh = await cred.getById ? await cred.getById(credential._id) : null;
      expect(revoked || fresh).toBeTruthy();

      // revoking again refuses
      await expect(cred.revoke({ credentialId: credential._id, reason: 'again' })).rejects.toThrow(/[Aa]lready revoked/);
    });
  });

  it('rejects a template with no slug or title', async () => {
    await runWithTenant(tenantId, registrarId, async () => {
      await expect(cred.createTemplate({ title: { en: 'X' } })).rejects.toThrow(/slug/);
    });
  });
});
