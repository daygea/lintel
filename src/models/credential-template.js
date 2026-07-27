'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

/**
 * The shape of a credential a tenant issues: its title, the serial format, and
 * the (locale-mapped) body that names the award. A template is reusable; a
 * Credential is one issuance of it.
 *
 * serialFormat is a pattern with tokens the issuer fills: {YEAR}, {SEQ}, {SLUG}.
 * OISS might use "OISS/YIS/{YEAR}/{SEQ}"; a midwifery school something else. The
 * format is data, per invariant 1.
 */
const CredentialTemplateSchema = new Schema(
  {
    slug: { type: String, required: true, trim: true, lowercase: true },
    title: { ...LocaleMapType, required: true },
    body: LocaleMapType, // "has completed the programme of study in..."

    serialFormat: { type: String, default: '{SLUG}/{YEAR}/{SEQ}' },
    /** Which programme/course completion this attests to. */
    programId: { type: Schema.Types.ObjectId, ref: 'Program' },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course' },

    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

CredentialTemplateSchema.plugin(tenantGuard);
CredentialTemplateSchema.plugin(localeMap, { paths: ['title', 'body'] });

CredentialTemplateSchema.index({ tenantId: 1, slug: 1 }, { unique: true });

module.exports = mongoose.model('CredentialTemplate', CredentialTemplateSchema);
