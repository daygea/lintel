'use strict';

/**
 * Roles live on Membership, never on User. A person may be a learner at one
 * institution and an assessor at another.
 *
 * ASSESSOR is deliberately separate from INSTRUCTOR: an external elder or
 * examiner must be able to grade without being able to author or administer.
 */
const ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  REGISTRAR: 'registrar',
  INSTRUCTOR: 'instructor',
  ASSESSOR: 'assessor',
  LEARNER: 'learner',
};

const ALL = Object.values(ROLES);

const STAFF = [ROLES.OWNER, ROLES.ADMIN, ROLES.REGISTRAR, ROLES.INSTRUCTOR, ROLES.ASSESSOR];

const has = (membership, ...roles) =>
  !!membership && roles.some((r) => membership.roles.includes(r));

module.exports = { ROLES, ALL, STAFF, has };
