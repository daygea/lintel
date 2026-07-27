'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');

/**
 * Links one of our Users to a stable external subject (the IdP's nameID / sub, or
 * a SIS student number). This is what makes re-login find the SAME person instead
 * of minting duplicates.
 *
 * Scoped to a tenant AND a source: the same human at two institutions is two
 * memberships of one User, but their external identities are distinct rows — an
 * institution's IdP subject means nothing at another institution.
 */
const ExternalIdentitySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    source: { type: String, enum: ['sso', 'sis'], required: true },
    connectionId: { type: Schema.Types.ObjectId, ref: 'SsoConnection' }, // for sso
    subject: { type: String, required: true }, // the IdP nameID / sub / student number

    lastSeenAt: Date,
  },
  { timestamps: true }
);

ExternalIdentitySchema.plugin(tenantGuard);
ExternalIdentitySchema.index({ tenantId: 1, source: 1, subject: 1 }, { unique: true });

module.exports = mongoose.model('ExternalIdentity', ExternalIdentitySchema);
