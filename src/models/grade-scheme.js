'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

/**
 * How a course's line items combine into a final grade: weighted categories,
 * optional drop-lowest, and the letter/band mapping.
 *
 * A tenant may run pass/fail, a percentage, or a traditional banding — the scheme
 * is data, so OISS's "ámúrelè / has attained standing" is one row, not code.
 */
const CategorySchema = new Schema(
  {
    key: { type: String, required: true },        // 'recitation', 'oral-exam'
    label: { ...LocaleMapType, required: true },
    weight: { type: Number, required: true, min: 0 }, // relative; normalised at compute
    dropLowest: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const BandSchema = new Schema(
  {
    label: { ...LocaleMapType, required: true },  // 'Attained', 'Distinction', 'A'
    minPercent: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false }
);

const GradeSchemeSchema = new Schema(
  {
    slug: { type: String, required: true, trim: true, lowercase: true },
    label: { ...LocaleMapType, required: true },
    categories: { type: [CategorySchema], default: [] },
    bands: { type: [BandSchema], default: [] },
    passPercent: { type: Number, default: 50, min: 0, max: 100 },
  },
  { timestamps: true }
);

GradeSchemeSchema.plugin(tenantGuard);
GradeSchemeSchema.plugin(localeMap, { paths: ['label'] });

GradeSchemeSchema.index({ tenantId: 1, slug: 1 }, { unique: true });

module.exports = mongoose.model('GradeScheme', GradeSchemeSchema);
