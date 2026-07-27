'use strict';

/**
 * Sprint 8 exit criteria:
 *   - a returning SSO subject resolves to the SAME user (no duplicates)
 *   - a new subject with a known email LINKS to the existing user
 *   - auto-provisioning off refuses an unknown identity
 *   - role claims map through the tenant's roleMap
 *   - SIS import is idempotent by student id (re-run creates nothing new)
 *   - the SIS report tells the registrar exactly what happened
 *   - identities are tenant-scoped (same subject, two tenants, two users)
 */

const {
  Tenant, User, Membership, SsoConnection, ExternalIdentity, Cohort, Course, Enrollment,
} = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const identity = require('../../src/services/identity.service');
const sis = require('../../src/services/sis-import.service');

let tenant, staff, connection;
const as = (fn) => runWithTenant(tenant._id, staff?._id || null, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'uni', name: 'University', locales: ['en'] });
  staff = await User.create({ email: 'reg@x.com', name: 'Registrar', passwordHash: 'x', status: 'active' });
  await runWithTenant(tenant._id, staff._id, async () => {
    await Membership.create({ userId: staff._id, roles: ['registrar'], status: 'active' });
    connection = await SsoConnection.create({
      label: 'Campus IdP',
      protocol: 'saml',
      enabled: true,
      attributeMap: { email: 'mail', name: 'cn', role: 'affiliation' },
      roleMap: new Map([['faculty', 'instructor'], ['student', 'learner']]),
      defaultRole: 'learner',
      autoProvision: true,
    });
  });
});

describe('SSO identity linking', () => {
  it('resolves a returning subject to the same user', async () => {
    const first = await as(() => identity.resolveFromAssertion({
      connectionId: connection._id, subject: 'idp|123',
      attributes: { mail: 'ada@uni.edu', cn: 'Ada', affiliation: 'student' },
    }));
    const second = await as(() => identity.resolveFromAssertion({
      connectionId: connection._id, subject: 'idp|123',
      attributes: { mail: 'ada@uni.edu', cn: 'Ada', affiliation: 'student' },
    }));
    expect(String(first._id)).toBe(String(second._id));

    const users = await as(() => User.find({ email: 'ada@uni.edu' }).exec());
    expect(users).toHaveLength(1); // no duplicate
  });

  it('links a new subject to an existing user by email', async () => {
    const existing = await User.create({ email: 'sam@uni.edu', name: 'Sam', passwordHash: 'x', status: 'active' });
    const resolved = await as(() => identity.resolveFromAssertion({
      connectionId: connection._id, subject: 'idp|999',
      attributes: { mail: 'sam@uni.edu', cn: 'Sam', affiliation: 'faculty' },
    }));
    expect(String(resolved._id)).toBe(String(existing._id));
  });

  it('maps a role claim through the tenant roleMap', async () => {
    await as(() => identity.resolveFromAssertion({
      connectionId: connection._id, subject: 'idp|fac',
      attributes: { mail: 'prof@uni.edu', cn: 'Prof', affiliation: 'faculty' },
    }));
    const user = await as(() => User.findOne({ email: 'prof@uni.edu' }).exec());
    const membership = await as(() => Membership.findOne({ userId: user._id }).exec());
    expect(membership.roles).toContain('instructor');
  });

  it('refuses an unknown identity when auto-provisioning is off', async () => {
    await as(() => SsoConnection.updateOne({ _id: connection._id }, { autoProvision: false }).exec());
    await expect(as(() => identity.resolveFromAssertion({
      connectionId: connection._id, subject: 'idp|new',
      attributes: { mail: 'nobody@uni.edu', cn: 'Nobody' },
    }))).rejects.toThrow(/auto-provisioning is off/);
  });

  it('scopes identities to the tenant — same subject in two tenants is two users', async () => {
    await as(() => identity.resolveFromAssertion({
      connectionId: connection._id, subject: 'shared|1',
      attributes: { mail: 'x@a.edu', cn: 'X' },
    }));

    const other = await Tenant.create({ slug: 'other', name: 'Other', locales: ['en'] });
    const otherStaff = await User.create({ email: 'o@x.com', name: 'O', passwordHash: 'x', status: 'active' });
    const otherConn = await runWithTenant(other._id, otherStaff._id, () => SsoConnection.create({
      label: 'Other IdP', protocol: 'saml', enabled: true, autoProvision: true,
      attributeMap: { email: 'mail', name: 'cn' },
    }));
    await runWithTenant(other._id, otherStaff._id, () => identity.resolveFromAssertion({
      connectionId: otherConn._id, subject: 'shared|1',
      attributes: { mail: 'x@b.edu', cn: 'X' },
    }));

    const inA = await as(() => ExternalIdentity.find({ subject: 'shared|1' }).exec());
    const inB = await runWithTenant(other._id, otherStaff._id, () => ExternalIdentity.find({ subject: 'shared|1' }).exec());
    expect(inA).toHaveLength(1);
    expect(inB).toHaveLength(1);
    expect(String(inA[0].userId)).not.toBe(String(inB[0].userId));
  });
});

describe('SIS import', () => {
  it('is idempotent by student id', async () => {
    const rows = [
      { studentId: 'S001', email: 'a@uni.edu', name: 'A', role: 'learner' },
      { studentId: 'S002', email: 'b@uni.edu', name: 'B', role: 'learner' },
    ];
    const first = await as(() => sis.importRoster({ rows }));
    expect(first.created).toBe(2);

    const second = await as(() => sis.importRoster({ rows }));
    expect(second.created).toBe(0);   // nothing new
    expect(second.skipped).toBe(2);

    const users = await as(() => User.find({ email: { $in: ['a@uni.edu', 'b@uni.edu'] } }).exec());
    expect(users).toHaveLength(2);    // not doubled
  });

  it('reports errors per row without aborting the whole import', async () => {
    const rows = [
      { studentId: 'S010', email: 'good@uni.edu', name: 'Good' },
      { name: 'No student id' }, // error
      { studentId: 'S011', email: 'also@uni.edu', name: 'Also' },
    ];
    const report = await as(() => sis.importRoster({ rows }));
    expect(report.created).toBe(2);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].row).toBe(2);
  });

  it('enrols into a cohort by code, idempotently', async () => {
    const { cohort } = await as(async () => {
      const course = await Course.create({ code: 'C1', title: { en: 'Course' } });
      const cohort = await Cohort.create({ courseId: course._id, code: 'COH1', title: { en: 'Run' }, session: '2026/2027' });
      return { cohort };
    });
    const rows = [{ studentId: 'S100', email: 'e@uni.edu', name: 'E', cohortCode: 'COH1' }];
    const first = await as(() => sis.importRoster({ rows }));
    expect(first.enrolled).toBe(1);
    const second = await as(() => sis.importRoster({ rows }));
    expect(second.enrolled).toBe(0); // already enrolled
  });
});
