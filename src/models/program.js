'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

/** A qualification. "Diploma in Indigenous Studies." Contains courses. */
const ProgramSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    title: { ...LocaleMapType, required: true },
    description: LocaleMapType,

    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft' },

    // Invariant 6: fail closed. Nothing is public until a human publishes it.
    visibility: { type: String, enum: ['private', 'directory', 'catalog'], default: 'private' },
  },
  { timestamps: true }
);

ProgramSchema.plugin(tenantGuard);
ProgramSchema.plugin(localeMap, { paths: ['title', 'description'] });

ProgramSchema.index({ tenantId: 1, code: 1 }, { unique: true });
ProgramSchema.index({ tenantId: 1, status: 1 });

module.exports = mongoose.model('Program', ProgramSchema);
