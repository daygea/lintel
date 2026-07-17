'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

/**
 * A KIND of attestation the institution recognises. Tenant data, never code.
 *
 * At OISS one of these might be "initiation standing"; at a school of midwifery,
 * "registered licence". Lintel knows nothing of either — it stores the slug the
 * tenant chose and the role permitted to grant it. Invariant 1.
 */
const AttestationTypeSchema = new Schema(
  {
    slug: { type: String, required: true, trim: true, lowercase: true },
    label: { ...LocaleMapType, required: true },
    description: LocaleMapType,

    /** Which membership role may issue this. An elder, an examiner, the registrar. */
    requiresIssuerRole: {
      type: String,
      enum: ['owner', 'admin', 'registrar', 'instructor', 'assessor', 'elder'],
      default: 'assessor',
    },

    /**
     * Sensitive standings (health, initiation) are held to tighter visibility and
     * retention. The flag travels with the type so a policy can reason about it.
     */
    isSensitive: { type: Boolean, default: false },

    /** If set, an attestation of this type expires this many days after issue. */
    defaultValidityDays: { type: Number, min: 1 },
  },
  { timestamps: true }
);

AttestationTypeSchema.plugin(tenantGuard);
AttestationTypeSchema.plugin(localeMap, { paths: ['label', 'description'] });

AttestationTypeSchema.index({ tenantId: 1, slug: 1 }, { unique: true });

module.exports = mongoose.model('AttestationType', AttestationTypeSchema);
