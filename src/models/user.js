'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { Schema } = mongoose;

/**
 * PLATFORM-SCOPED. A User is a person, not a member of an institution.
 *
 * This is what makes cross-tenant identity possible later (a learner enrolled at
 * two institutions, a catalog account) with no migration. Roles live on
 * Membership, never here.
 */
const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    name: { type: String, required: true, trim: true },

    /**
     * Required for password users; absent for SSO-only accounts (Sprint 8), where
     * the identity provider holds the credential and we never do. The conditional
     * required keeps password users safe without blocking federated ones.
     */
    passwordHash: {
      type: String,
      select: false,
      required: function requiredUnlessSso() {
        return !this.ssoOnly;
      },
    },
    ssoOnly: { type: Boolean, default: false },

    mfa: {
      enabled: { type: Boolean, default: false },
      secret: { type: String, select: false },
    },

    locale: { type: String, default: 'en' },
    timezone: { type: String, default: 'Africa/Lagos' },

    status: { type: String, enum: ['pending', 'active', 'suspended'], default: 'pending' },

    /**
     * PLATFORM role — a Lintel operator, distinct from any tenant Membership.
     * 'superadmin' may reach the platform console (manage institutions, plans,
     * applications, operators, platform audit). It grants NO access to the
     * contents of any tenant — only to system-level and tenant-metadata actions.
     * Absent for everyone else, which is almost everyone.
     */
    platformRole: { type: String, enum: ['superadmin'], default: undefined },
    /* Set when an account was created with a temporary password (fallback flow);
       first login must change it. Cleared once they do. */
    mustChangePassword: { type: Boolean, default: false },
    lastSeenAt: Date,
    /* Bumped to invalidate all existing sessions for this user (force logout on a
       compromised or abusive account). loadSession compares the session's epoch to
       this; a stale session is dropped. */
    sessionEpoch: { type: Number, default: 0 },
  },
  { timestamps: true }
);

UserSchema.statics.hashPassword = (plain) => bcrypt.hash(plain, 12);

UserSchema.methods.verifyPassword = function verifyPassword(plain) {
  if (!this.passwordHash) throw new Error('passwordHash not selected on this document');
  return bcrypt.compare(plain, this.passwordHash);
};

module.exports = mongoose.model('User', UserSchema);
