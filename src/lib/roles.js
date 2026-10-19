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

// A membership whose `roles` is absent (a legacy or imported document that
// predates the schema default) means "holds no roles" — never a thrown error.
// `has` runs on the hot path (completeLogin, the dashboard gate, requireRole),
// so an unguarded `.includes` here 500's sign-in and the institution root.
const has = (membership, ...roles) =>
  !!membership && (membership.roles || []).some((r) => roles.includes(r));

module.exports = { ROLES, ALL, STAFF, has };
