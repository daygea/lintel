'use strict';

/**
 * Within-tenant ownership (IDOR regression). tenant-guard scopes queries to the
 * tenant but NOT to the user, so these assert that one member cannot read or write
 * another member's records by passing their id. Added after the Oct-2026 audit.
 */

const mongoose = require('mongoose');
const { Tenant, User, Enrollment, Lesson, Invoice } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const enrolment = require('../../src/services/enrolment.service');
const commerce = require('../../src/services/commerce');
const eligibility = require('../../src/services/eligibility.service');
const { NotAuthorisedError } = require('../../src/lib/errors');

const oid = () => new mongoose.Types.ObjectId();
let tenant, alice, bob, lesson, aliceEnr;
const asUser = (uid, fn) => runWithTenant(tenant._id, uid, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'inst', name: 'Inst', locales: ['en'] });
  alice = await User.create({ email: 'alice@x.io', name: 'Alice', passwordHash: await User.hashPassword('x'.repeat(12)) });
  bob = await User.create({ email: 'bob@x.io', name: 'Bob', passwordHash: await User.hashPassword('x'.repeat(12)) });
  await asUser(alice._id, async () => {
    lesson = await Lesson.create({ moduleId: oid(), courseId: oid(), title: { en: 'L1' }, order: 1 });
    aliceEnr = await Enrollment.create({ userId: alice._id, cohortId: oid(), courseId: lesson.courseId, status: 'active' });
  });
});

describe('progress is owner-only', () => {
  it('lets the owner mark their own lesson', async () => {
    const p = await asUser(alice._id, () =>
      enrolment.markLesson({ enrollmentId: aliceEnr._id, lessonId: lesson._id, state: 'complete' })
    );
    expect(p.state).toBe('complete');
  });

  it('forbids marking another learner’s enrolment', async () => {
    await expect(
      asUser(bob._id, () => enrolment.markLesson({ enrollmentId: aliceEnr._id, lessonId: lesson._id, state: 'complete' }))
    ).rejects.toBeInstanceOf(NotAuthorisedError);
  });

  it('forbids reading another learner’s progress', async () => {
    await expect(
      asUser(bob._id, () => enrolment.progressFor(aliceEnr._id))
    ).rejects.toBeInstanceOf(NotAuthorisedError);
  });
});

describe('invoice payment is owner-only (learner path)', () => {
  it('forbids beginning payment on another learner’s invoice', async () => {
    const inv = await asUser(alice._id, () =>
      Invoice.create({
        enrollmentId: aliceEnr._id, userId: alice._id,
        amountDue: { amount: 500000, currency: 'NGN' }, amountPaid: { amount: 0, currency: 'NGN' }, state: 'unpaid',
      })
    );
    await expect(
      asUser(bob._id, () => commerce.beginPayment({ invoiceId: inv._id, requireOwnerId: bob._id }))
    ).rejects.toBeInstanceOf(NotAuthorisedError);
  });
});

describe('no-policy lessons still require enrolment (fail closed)', () => {
  it('allows an enrolled learner', async () => {
    const { verdict } = await asUser(alice._id, () =>
      eligibility.previewAccess({ lesson, userId: alice._id })
    );
    expect(verdict.allowed).toBe(true);
  });

  it('denies a member with no active enrolment', async () => {
    const { verdict } = await asUser(bob._id, () =>
      eligibility.previewAccess({ lesson, userId: bob._id })
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.failedRules).toContain('enrolled');
  });
});
