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
  /**
   * A senior-initiate role whose authority is spiritual, not operational. An
   * elder may confer initiation and office; an admin may not, and gains no such
   * power merely by being an admin. Kept separate on purpose (OISS decision #2).
   */
  ELDER: 'elder',
  LEARNER: 'learner',
};

const ALL = Object.values(ROLES);

const STAFF = [ROLES.OWNER, ROLES.ADMIN, ROLES.REGISTRAR, ROLES.INSTRUCTOR, ROLES.ASSESSOR, ROLES.ELDER];

const has = (membership, ...roles) =>
  !!membership && roles.some((r) => membership.roles.includes(r));

module.exports = { ROLES, ALL, STAFF, has };
