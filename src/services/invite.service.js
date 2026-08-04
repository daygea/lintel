'use strict';

const auth = require('./auth.service');
const onboarding = require('./onboarding.service');
const { Tenant } = require('../models');
const { ROLES } = require('../lib/roles');
const { ValidationError } = require('../lib/errors');
const { currentTenantId } = require('../lib/context');

/**
 * Roles a registrar/admin may hand out via invite. Owner is excluded on purpose
 * — a tenant has one founder-owner, not one you mint by email. (Who may grant
 * which staff role is a finer escalation policy for later; for now the invite is
 * staff-gated and the option list is the guard.)
 */
const INVITABLE = [
  ROLES.LEARNER,
  ROLES.INSTRUCTOR,
  ROLES.ASSESSOR,
  ROLES.ELDER,
  ROLES.REGISTRAR,
  ROLES.ADMIN,
];

const LABELS = {
  [ROLES.LEARNER]: 'learner',
  [ROLES.INSTRUCTOR]: 'instructor',
  [ROLES.ASSESSOR]: 'assessor',
  [ROLES.ELDER]: 'elder',
  [ROLES.REGISTRAR]: 'registrar',
  [ROLES.ADMIN]: 'administrator',
};

/**
 * Invite a person into this institution and send them a set-password link.
 *
 * A registrar's invite IS the admission — unlike self-registration (which lands
 * pending, awaiting a human), an invited member is granted access immediately
 * with the chosen role. They still can't sign in until they set a password from
 * the emailed link; the account starts pending on the USER, active on the
 * MEMBERSHIP. Idempotent per person: re-inviting updates the role and re-sends.
 */
async function inviteMember({ email, name, role, invitedByUserId }) {
  if (!email || !String(email).includes('@')) throw new ValidationError('A valid email is required');
  const chosen = INVITABLE.includes(role) ? role : ROLES.LEARNER;

  const tenantId = currentTenantId();
  const tenant = await Tenant.findById(tenantId).exec();

  const { user, membership } = await auth.invite({
    email,
    name,
    roles: [chosen],
    invitedByUserId,
  });

  // Grant access now — the invite is the deliberate act (ADR-020). requireMember
  // only lets 'active' through, so without this the invitee would set a password
  // and still be locked out.
  if (membership.status !== 'active') {
    membership.status = 'active';
    membership.joinedAt = membership.joinedAt || new Date();
    await membership.save();
  }

  await onboarding.sendAccountDetails({
    userId: user._id,
    tenantId,
    institutionName: tenant ? tenant.name : undefined,
    roleLabel: LABELS[chosen] || chosen,
    withTempPassword: false,
  });

  return { user, membership };
}

module.exports = { inviteMember, INVITABLE, LABELS };
