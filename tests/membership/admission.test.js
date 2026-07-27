'use strict';

/**
 * Learner self-registration + admission wiring (ADR-020, ADR-024).
 *
 * Self-registration creates a role-locked, PENDING learner membership — locked
 * out of everything until a registrar admits it (fail closed). This proves the
 * admission path the dashboard "Admit" button drives: pending → active, audited,
 * role-locked, idempotent. It also pins that self-registration can never mint a
 * non-learner role.
 */

const { Tenant, User, Membership, AuditLog } = require('../../src/models');
const auth = require('../../src/services/auth.service');
const membership = require('../../src/services/membership.service');
const { runWithTenant } = require('../../src/lib/context');
const { ROLES } = require('../../src/lib/roles');

describe('learner admission', () => {
  let tenantId;
  beforeEach(async () => {
    const t = await Tenant.create({ slug: 'test-admit', name: 'T', locales: ['en'], status: 'active' });
    tenantId = t._id;
  });

  it('self-registers as pending learner, then a registrar admits to active', async () => {
    await runWithTenant(tenantId, null, async () => {
      const { user, pending } = await auth.selfRegister({ email: 'learner@x.io', name: 'Ada' });
      expect(pending).toBe(true);

      const m = await Membership.findOne({ userId: user._id }).exec();
      expect(m.status).toBe('pending');
      expect(m.roles).toEqual([ROLES.LEARNER]); // role-locked

      const actorId = new (require('mongoose').Types.ObjectId)();
      const admitted = await membership.activate(m._id, actorId);
      expect(admitted.status).toBe('active');
      expect(admitted.joinedAt).toBeTruthy();

      const log = await AuditLog.findOne({ action: 'membership.admitted', subjectId: m._id }).exec();
      expect(log).toBeTruthy();
      expect(String(log.actorUserId)).toBe(String(actorId));
    });
  });

  it('admit is idempotent — admitting an active member is a no-op, no duplicate audit', async () => {
    await runWithTenant(tenantId, null, async () => {
      const { user } = await auth.selfRegister({ email: 'learner2@x.io', name: 'Bem' });
      const m = await Membership.findOne({ userId: user._id }).exec();
      await membership.activate(m._id, null);
      await membership.activate(m._id, null); // second call
      const logs = await AuditLog.find({ action: 'membership.admitted', subjectId: m._id }).exec();
      expect(logs.length).toBe(1);
    });
  });

  it('rejects admitting a membership that does not exist', async () => {
    await runWithTenant(tenantId, null, async () => {
      const ghost = new (require('mongoose').Types.ObjectId)();
      await expect(membership.activate(ghost, null)).rejects.toThrow();
    });
  });
});
