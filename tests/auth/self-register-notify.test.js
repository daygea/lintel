'use strict';

/**
 * When a learner self-registers, the people who can admit them (owner / admin /
 * registrar) are notified — the learner→institution handoff. Other members aren't.
 */

const { Tenant, User, Membership } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const { CHANNELS } = require('../../src/services/notification');
const auth = require('../../src/services/auth.service');

async function member(tenant, email, roles) {
  const u = await User.create({ email, name: email, passwordHash: await User.hashPassword('x'.repeat(12)) });
  await runWithTenant(tenant._id, u._id, () =>
    Membership.create({ userId: u._id, roles, status: 'active', joinedAt: new Date() })
  );
  return u;
}

it('notifies admission staff, and only them, on self-registration', async () => {
  const tenant = await Tenant.create({ slug: 'reg-t', name: 'R', locales: ['en'], status: 'active', plan: 'institute' });
  const registrar = await member(tenant, 'registrar@r.io', ['registrar']);
  const instructor = await member(tenant, 'instructor@r.io', ['instructor']); // cannot admit

  const spy = vi.spyOn(CHANNELS.email, 'send').mockResolvedValue({ providerRef: 'x' });

  await runWithTenant(tenant._id, registrar._id, () =>
    auth.selfRegister({ email: 'newlearner@r.io', name: 'New Learner' })
  );

  const admissionNotices = spy.mock.calls
    .map((c) => c[0])
    .filter((m) => /awaiting admission/i.test(m.subject || ''));
  const to = admissionNotices.map((m) => m.to);
  expect(to).toContain('registrar@r.io');
  expect(to).not.toContain('instructor@r.io');
  expect(to).not.toContain('newlearner@r.io');

  spy.mockRestore();
});
