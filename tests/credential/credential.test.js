'use strict';

/**
 * Sprint 7 exit criteria. The assertion that matters most:
 *   - public verification reveals ONLY the award, name, date, validity —
 *     never marks, standings, transcript, or what was taught.
 * Plus: issue generates serial + separate code; revocation flips validity;
 * the verifier works across tenants with no session; export round-trips.
 */

const {
  Tenant, User, Membership, CredentialTemplate, Credential,
  Grade, Attestation,
} = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const cred = require('../../src/services/credential.service');
const exportSvc = require('../../src/services/export.service');

let tenant, staff, learner, template;
const as = (fn) => runWithTenant(tenant._id, staff._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'oiss', name: 'Institute', locales: ['en'] });
  staff = await User.create({ email: 's@x.com', name: 'Registrar', passwordHash: 'x', status: 'active' });
  learner = await User.create({ email: 'l@x.com', name: 'Adéọlá', passwordHash: 'x', status: 'active' });
  await as(async () => {
    await Membership.create({ userId: staff._id, roles: ['registrar'], status: 'active' });
    template = await CredentialTemplate.create({
      slug: 'yis-diploma',
      title: { en: 'Diploma in Indigenous Studies' },
      serialFormat: '{SLUG}/{YEAR}/{SEQ}',
    });
  });
});

describe('issuance', () => {
  it('generates a serial and a SEPARATE verification code', async () => {
    const c = await as(() => cred.issue({ templateId: template._id, userId: learner._id }));
    expect(c.serial).toMatch(/^YIS-DIPLOMA\/\d{4}\/\d{5}$/);
    expect(c.verificationCode).toMatch(/^[a-f0-9]{32}$/);
    expect(c.verificationCode).not.toBe(c.serial); // code must not be derivable from serial
    expect(c.holderName).toBe('Adéọlá'); // snapshot at issue
  });
});

describe('public verification', () => {
  it('reveals only the award, name, date, validity — and NOTHING else', async () => {
    const c = await as(() => cred.issue({ templateId: template._id, userId: learner._id }));

    // The learner also has a grade and an attestation on file — neither must leak.
    await as(() => Grade.create({ submissionId: new (require('mongoose').Types.ObjectId)(), assessorUserId: staff._id, totalPoints: 42 }));
    await as(() => Attestation.create({ subjectUserId: learner._id, typeSlug: 'itefa-standing', issuedByUserId: staff._id }));

    const result = await cred.verifyPublic(c.verificationCode); // no tenant context — as a stranger

    expect(result.valid).toBe(true);
    expect(result.holderName).toBe('Adéọlá');
    expect(result.institution).toBe('Institute');

    // The forbidden fields:
    expect(result).not.toHaveProperty('totalPoints');
    expect(result).not.toHaveProperty('grade');
    expect(result).not.toHaveProperty('standings');
    expect(result).not.toHaveProperty('attestation');
    expect(result).not.toHaveProperty('transcript');
    expect(result).not.toHaveProperty('userId');
    // Only these keys are permitted on the public surface:
    expect(Object.keys(result).sort()).toEqual(
      ['award', 'holderName', 'institution', 'issuedAt', 'revoked', 'serial', 'valid'].sort()
    );
  });

  it('works across tenants with no session (globally-unique code)', async () => {
    const c = await as(() => cred.issue({ templateId: template._id, userId: learner._id }));
    // Called with absolutely no context:
    const result = await cred.verifyPublic(c.verificationCode);
    expect(result.valid).toBe(true);
  });

  it('returns not_found for an unknown code', async () => {
    const result = await cred.verifyPublic('deadbeef'.repeat(4));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('not_found');
  });
});

describe('revocation', () => {
  it('flips validity but keeps the record', async () => {
    const c = await as(() => cred.issue({ templateId: template._id, userId: learner._id }));
    await as(() => cred.revoke({ credentialId: c._id, reason: 'issued in error' }));

    const result = await cred.verifyPublic(c.verificationCode);
    expect(result.valid).toBe(false);
    expect(result.revoked).toBe(true);
    // still verifiable as a revoked credential — the record survives
    expect(result.holderName).toBe('Adéọlá');
  });
});

describe('tenant export', () => {
  it("round-trips the tenant\u2019s own collections", async () => {
    await as(() => cred.issue({ templateId: template._id, userId: learner._id }));
    const data = await as(() => exportSvc.exportTenant());

    expect(data.format).toBe('lintel-export-v1');
    expect(data.summary.Credential).toBe(1);
    expect(data.summary.CredentialTemplate).toBe(1);
    expect(data.collections.Credential[0].serial).toMatch(/YIS-DIPLOMA/);
  });

  it("is scoped to the tenant — another institution\u2019s data is absent", async () => {
    await as(() => cred.issue({ templateId: template._id, userId: learner._id }));

    const other = await Tenant.create({ slug: 'other', name: 'Other' });
    const otherStaff = await User.create({ email: 'o@x.com', name: 'O', passwordHash: 'x', status: 'active' });
    const data = await runWithTenant(other._id, otherStaff._id, () => exportSvc.exportTenant());
    expect(data.summary.Credential).toBe(0);
  });
});
