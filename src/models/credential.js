'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');

/**
 * One issued credential. APPEND-ONLY in spirit — a credential is a matter of
 * record — but not via the plugin, because a REVOCATION must flip a field the
 * public verifier reads. So revocation is a controlled write of revokedAt, and
 * the audit log carries the history. Nothing else is ever mutated.
 *
 * verificationCode is a public, unguessable token (not the serial) — the thing in
 * the QR. The serial is human-facing and printed; the code is what proves
 * authenticity, so it must not be derivable from the serial.
 *
 * WHAT THIS RECORD MUST NOT CARRY: marks, standings, transcript, what was taught.
 * A credential proves an award and nothing more. The public verifier returns only
 * the award, the holder's name, the date, and validity.
 */
const CredentialSchema = new Schema(
  {
    templateId: { type: Schema.Types.ObjectId, ref: 'CredentialTemplate', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    serial: { type: String, required: true },       // human-facing, printed
    verificationCode: { type: String, required: true }, // public token, in the QR

    holderName: { type: String, required: true },    // snapshot at issue time
    awardTitle: { type: Schema.Types.Mixed },         // locale map snapshot
    issuedAt: { type: Date, default: Date.now },
    issuedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },

    revokedAt: Date,
    revocationReason: String,
  },
  { timestamps: true }
);

CredentialSchema.plugin(tenantGuard);

CredentialSchema.index({ tenantId: 1, serial: 1 }, { unique: true });
CredentialSchema.index({ tenantId: 1, verificationCode: 1 }, { unique: true });
CredentialSchema.index({ tenantId: 1, userId: 1 });

module.exports = mongoose.model('Credential', CredentialSchema);
