'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * PLATFORM-SCOPED, append-only-in-spirit. A break-glass grant: the EXPLICIT,
 * time-boxed, notified permission for a platform operator to read a specific
 * institution's content in response to a credible abuse case.
 *
 * This is the ONLY path from platform staff to tenant content. It exists so that
 * the default answer to "can Lintel see our material?" is NO — access requires
 * an operator to open a grant, which (a) is written here and to the platform
 * audit, (b) notifies the institution's owner immediately, and (c) expires. There
 * is deliberately no silent, standing read capability anywhere in the system.
 *
 * A grant records WHY (justification, linked report), WHO, WHEN, and until when.
 * Revoking it (or its expiry) ends the access.
 */
const BreakglassGrantSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    operatorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reportId: { type: Schema.Types.ObjectId, ref: 'AbuseReport' }, // the case that justified it
    justification: { type: String, required: true },

    grantedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    ownerNotifiedAt: Date, // when the institution's owner was told
  },
  { timestamps: true }
);

// Active = not revoked and not expired. Queried on every content read under a grant.
BreakglassGrantSchema.index({ tenantId: 1, operatorUserId: 1, expiresAt: 1 });

/** Is this grant currently usable? */
BreakglassGrantSchema.methods.isActive = function isActive() {
  return !this.revokedAt && this.expiresAt > new Date();
};

module.exports = mongoose.model('BreakglassGrant', BreakglassGrantSchema);
