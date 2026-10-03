'use strict';

/**
 * Per-institution "open teaching" setting. For a lesson with NO eligibility policy:
 *   - default (openLessonsForMembers false): an un-enrolled member is denied (fail closed);
 *   - opted in: an ACTIVE member may open it without enrolling, but a non-member still can't.
 * A policied lesson is unaffected by the setting (covered elsewhere).
 */

const mongoose = require('mongoose');
const { Tenant, User, Membership, Lesson } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const eligibility = require('../../src/services/eligibility.service');

const oid = () => new mongoose.Types.ObjectId();
let tenant, member, lesson;
const asUser = (uid, fn) => runWithTenant(tenant._id, uid, fn);

async function makeMember() {
  const u = await User.create({ email: `m${Math.random()}@x.io`, name: 'M', passwordHash: await User.hashPassword('x'.repeat(12)) });
  await asUser(u._id, () => Membership.create({ userId: u._id, roles: ['learner'], status: 'active' }));
  return u;
}

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'open-t', name: 'O', locales: ['en'], status: 'active' });
  member = await makeMember();
  await asUser(member._id, async () => {
    lesson = await Lesson.create({ moduleId: oid(), courseId: oid(), title: { en: 'L' }, order: 1 });
  });
});

it('denies an un-enrolled member by default (fail closed)', async () => {
  const { verdict } = await asUser(member._id, () => eligibility.previewAccess({ lesson, userId: member._id }));
  expect(verdict.allowed).toBe(false);
});

it('allows an active member when the institution opts in', async () => {
  await Tenant.updateOne({ _id: tenant._id }, { 'access.openLessonsForMembers': true }).exec();
  const { verdict } = await asUser(member._id, () => eligibility.previewAccess({ lesson, userId: member._id }));
  expect(verdict.allowed).toBe(true);
});

it('still denies a non-member even when opted in', async () => {
  await Tenant.updateOne({ _id: tenant._id }, { 'access.openLessonsForMembers': true }).exec();
  const stranger = await User.create({ email: 's@x.io', name: 'S', passwordHash: await User.hashPassword('x'.repeat(12)) });
  const { verdict } = await asUser(stranger._id, () => eligibility.previewAccess({ lesson, userId: stranger._id }));
  expect(verdict.allowed).toBe(false);
});
