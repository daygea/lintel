'use strict';

/**
 * Member invite. A registrar's invite grants access immediately (active
 * membership, chosen role) and sends a set-password email — unlike self-
 * registration, which lands pending. Idempotent per person.
 */

const { Tenant, User, Membership, Notification, AuditLog } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const invite = require('../../src/services/invite.service');

let tenant, actor;
const as = (fn) => runWithTenant(tenant._id, actor._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-invite', name: 'Alpha', locales: ['en'], status: 'active' });
  actor = await User.create({ email: 'reg@x.io', name: 'Reg', passwordHash: await User.hashPassword('x'.repeat(12)) });
  await as(() => Membership.create({ userId: actor._id, roles: ['registrar'], status: 'active' }));
});

it('invites a new person with an active membership and the chosen role', async () => {
  const { user, membership } = await as(() =>
    invite.inviteMember({ email: 'Newbie@x.io', name: 'Newbie', role: 'instructor', invitedByUserId: actor._id })
  );

  expect(user.email).toBe('newbie@x.io'); // normalised
  expect(user.status).toBe('pending'); // can't sign in until they set a password
  expect(membership.status).toBe('active'); // but access is granted
  expect(membership.roles).toEqual(['instructor']);

  const log = await as(() => AuditLog.findOne({ action: 'membership.invited', subjectId: user._id }).exec());
  expect(log).toBeTruthy();
});

it('sends the account-created onboarding email', async () => {
  const { user } = await as(() =>
    invite.inviteMember({ email: 'mail@x.io', role: 'learner', invitedByUserId: actor._id })
  );
  const note = await as(() =>
    Notification.findOne({ userId: user._id, template: 'account_created' }).exec()
  );
  expect(note).toBeTruthy();
  expect(note.channel).toBe('email');
});

it('falls back to learner for a role that is not invitable (e.g. owner)', async () => {
  const { membership } = await as(() =>
    invite.inviteMember({ email: 'o@x.io', role: 'owner', invitedByUserId: actor._id })
  );
  expect(membership.roles).toEqual(['learner']);
});

it('re-inviting the same email updates the role, keeps one membership', async () => {
  await as(() => invite.inviteMember({ email: 'dup@x.io', role: 'learner', invitedByUserId: actor._id }));
  const { membership } = await as(() =>
    invite.inviteMember({ email: 'dup@x.io', role: 'assessor', invitedByUserId: actor._id })
  );
  expect(membership.roles).toEqual(['assessor']);
  const count = await as(() => Membership.countDocuments({ userId: membership.userId }).exec());
  expect(count).toBe(1);
});

it('rejects an invalid email', async () => {
  await expect(as(() => invite.inviteMember({ email: 'not-an-email', invitedByUserId: actor._id }))).rejects.toThrow();
});
