'use strict';

const { Membership, AuditLog } = require('../models');
const { ALL: ALL_ROLES } = require('../lib/roles');
const { ValidationError } = require('../lib/errors');
const { paginate } = require('../lib/paginate');

const list = (filter = {}) => Membership.find(filter).populate('userId', 'name email status').lean();

// Paginated members list — what the admin dashboard renders, so a large institution
// pages through its people instead of loading every membership at once.
const pageMembers = ({ filter = {}, page = 1, perPage = 25 } = {}) =>
  paginate(Membership, filter, {
    page, perPage, sort: { createdAt: -1 }, populate: { path: 'userId', select: 'name email status' },
  });

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
  // Tell the admitted person their access is open — best-effort, never blocks the
  // admission. (Previously nothing was sent when a self-registered member was admitted.)
  try {
    const { notify } = require('./notification');
    const { Tenant } = require('../models');
    const { currentTenantId } = require('../lib/context');
    const tenant = await Tenant.findById(currentTenantId()).exec();
    await notify({
      userId: membership.userId,
      template: 'member.admitted',
      channels: ['email'],
      data: { institutionName: tenant ? tenant.name : undefined },
    });
  } catch (err) { /* best-effort */ }
  return membership;
}

module.exports = { list, pageMembers, setRoles, activate };
