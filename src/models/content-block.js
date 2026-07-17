'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

const BLOCK_TYPES = ['rich_text', 'audio', 'video', 'pdf', 'image', 'embed', 'archive_ref'];

/**
 * archive_ref holds METADATA ONLY — an accession number and the terms the
 * depositor agreed to. Never media bytes. See ADR-004: if we copy archive media
 * into our storage, consent revocation cannot propagate and the platform becomes
 * a consent-laundering machine.
 *
 * Resolved at render time via a signed, short-TTL URL from the archive. Sprint 3.
 */
const ArchiveRefSchema = new Schema(
  {
    archiveId: { type: String, required: true },
    accessionNumber: { type: String, required: true },
    tkLabels: [{ type: String }],
    consentTier: { type: Number, min: 0, max: 5, required: true },
    cachedTitle: LocaleMapType,
    cachedDurationMs: Number,
    lastVerifiedAt: Date,

    /**
     * Whether the archive still permits this reference to resolve. Set false when
     * the depositor revokes consent. Kept SEPARATE from consentTier on purpose:
     * the tier is what they agreed to; availability is whether that agreement
     * still stands. Conflating them (a magic tier value) hides a revocation
     * inside a number.
     */
    available: { type: Boolean, default: true },
    revokedAt: Date,
    revocationReason: String,
  },
  { _id: false }
);

const ContentBlockSchema = new Schema(
  {
    lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true, index: true },
    order: { type: Number, default: 0 },

    type: { type: String, enum: BLOCK_TYPES, required: true },

    body: LocaleMapType,
    assetId: { type: Schema.Types.ObjectId, ref: 'Asset' },
    embedUrl: String,
    archiveRef: ArchiveRefSchema,

    /** Sprint 3. Sensitivity classification: watermark, stream-only, logging. */
    contentPolicyId: { type: Schema.Types.ObjectId, ref: 'ContentPolicy' },

    visibility: { type: String, enum: ['private', 'catalog'], default: 'private' },
    /** Preview is a per-block opt-in the engine may REFUSE. See ADR-011. */
    previewable: { type: Boolean, default: false },
  },
  { timestamps: true }
);

ContentBlockSchema.plugin(tenantGuard);
ContentBlockSchema.plugin(localeMap, { paths: ['body'] });

ContentBlockSchema.index({ tenantId: 1, lessonId: 1, order: 1 });

/**
 * Fail closed, structurally. An archive-sourced block above consent tier 1 can
 * never be marked previewable — not even by a tenant admin who insists.
 * "Watch lesson 1 free" is the industry's standard leak vector.
 */
ContentBlockSchema.pre('validate', function refusePreviewOfRestricted(next) {
  if (this.previewable && this.archiveRef && this.archiveRef.consentTier > 1) {
    return next(
      new Error(
        `Refusing to mark ${this.archiveRef.accessionNumber} previewable: it was deposited at ` +
          `consent tier ${this.archiveRef.consentTier}. Its depositor did not agree to publication.`
      )
    );
  }
  return next();
});

module.exports = mongoose.model('ContentBlock', ContentBlockSchema);
module.exports.BLOCK_TYPES = BLOCK_TYPES;
