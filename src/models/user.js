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
    passwordHash: { type: String, required: true, select: false },

    mfa: {
      enabled: { type: Boolean, default: false },
      secret: { type: String, select: false },
    },

    locale: { type: String, default: 'en' },
    timezone: { type: String, default: 'Africa/Lagos' },

    status: { type: String, enum: ['pending', 'active', 'suspended'], default: 'pending' },
    lastSeenAt: Date,
  },
  { timestamps: true }
);

UserSchema.statics.hashPassword = (plain) => bcrypt.hash(plain, 12);

UserSchema.methods.verifyPassword = function verifyPassword(plain) {
  if (!this.passwordHash) throw new Error('passwordHash not selected on this document');
  return bcrypt.compare(plain, this.passwordHash);
};

module.exports = mongoose.model('User', UserSchema);
