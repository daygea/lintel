'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * A single-use, expiring token for setting a password without one ever travelling
 * by email. This is the secure half of "credentials by email": we mail a LINK
 * carrying this token, the person clicks it, sets their own password, and the
 * token is consumed. It cannot be replayed.
 *
 * Platform-scoped (NOT tenant-guarded): the person clicking the link has no
 * session and no tenant context yet — they are resolved BY the token. The token
 * value is a 256-bit random string, so it is not guessable, and we store only its
 * hash — a leak of this collection does not hand anyone a working link.
 *
 * The optional tempPassword flow (fallback) sets a known password AND emails this
 * link; either path works, and using the link invalidates the temp password by
 * forcing a reset. The temp password is itself expired and must be changed on
 * first login (User.mustChangePassword).
 */
const OnboardingTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' }, // context to land in after set
    tokenHash: { type: String, required: true, unique: true },
    purpose: { type: String, enum: ['set_password', 'reset_password'], default: 'set_password' },
    expiresAt: { type: Date, required: true },
    consumedAt: Date,
  },
  { timestamps: true }
);

// TTL index: Mongo removes expired tokens automatically.
OnboardingTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OnboardingToken', OnboardingTokenSchema);
