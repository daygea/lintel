'use strict';

const { Membership, AuditLog } = require('../models');
const { ALL: ALL_ROLES } = require('../lib/roles');
const { ValidationError } = require('../lib/errors');

const list = (filter = {}) => Membership.find(filter).populate('userId', 'name email status').lean();

async function setRoles({ membershipId, roles, actorUserId }) {
  if (!roles?.length || !roles.every((r) => ALL_ROLES.includes(r))) {
    throw new ValidationError('Unknown role');
  }
  const membership = await Membership.findByIdAndUpdate(membershipId, { roles }, { new: true });
  if (!membership) throw new ValidationError('No such member of this institution');

  await AuditLog.create({
    actorUserId,
    action: 'membership.roles_changed',
    subjectType: 'Membership',
    subjectId: membership._id,
    meta: { roles },
  });
  return membership;
}

async function activate(membershipId, actorUserId) {
  const membership = await Membership.findById(membershipId).exec();
  if (!membership) throw new ValidationError('No such member of this institution');
  if (membership.status === 'active') return membership; // already admitted — idempotent

  membership.status = 'active';
  membership.joinedAt = new Date();
  await membership.save();

  await AuditLog.create({
    actorUserId,
    action: 'membership.admitted',
    subjectType: 'Membership',
    subjectId: membership._id,
    meta: { roles: membership.roles },
  });
  return membership;
}

module.exports = { list, setRoles, activate };
