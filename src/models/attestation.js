'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const appendOnly = require('../plugins/append-only');

/**
 * A verified statement about a learner, issued by a named person.
 *
 * APPEND-ONLY. A revocation is a WRITE — a new document with status 'revoked' —
 * not a deletion and not an update of the original. When an institution says "we
 * withdrew Ṣadé's standing on 2 May, and here is why", that record must survive
 * intact, alongside the original grant.
 *
 * "Current" therefore means: the latest attestation for (subject, type) whose
 * status is 'active' and whose expiry, if any, has not passed. The service
 * computes this; nothing here is mutated.
 */
const AttestationSchema = new Schema(
  {
    subjectUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    typeSlug: { type: String, required: true },

    status: { type: String, enum: ['active', 'revoked'], default: 'active' },

    value: String, // optional payload, e.g. a licence number
    issuedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    issuedAt: { type: Date, default: Date.now },
    expiresAt: Date,
    evidenceAssetId: { type: Schema.Types.ObjectId, ref: 'Asset' },
    note: String,

    /** Set only on a revocation record. Points at the grant it revokes. */
    revokesAttestationId: { type: Schema.Types.ObjectId, ref: 'Attestation' },
    revocationReason: String,
  },
  { timestamps: true }
);

AttestationSchema.plugin(tenantGuard);
AttestationSchema.plugin(appendOnly, { modelName: 'Attestation' });

AttestationSchema.index({ tenantId: 1, subjectUserId: 1, typeSlug: 1, createdAt: -1 });

module.exports = mongoose.model('Attestation', AttestationSchema);
