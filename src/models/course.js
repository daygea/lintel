'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

const CourseSchema = new Schema(
  {
    programId: { type: Schema.Types.ObjectId, ref: 'Program', index: true },

    code: { type: String, required: true, trim: true, uppercase: true },
    title: { ...LocaleMapType, required: true },
    summary: LocaleMapType,

    /** The academic session this run belongs to. "2026/2027". */
    session: { type: String, trim: true },
    order: { type: Number, default: 0 },

    instructorIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],

    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft' },
    visibility: { type: String, enum: ['private', 'directory', 'catalog'], default: 'private' },

    /**
     * Sprint 3 will hang an EligibilityPolicy here. Declared now so the field
     * exists before anything depends on it, and so nobody invents a second
     * mechanism in the meantime.
     */
    eligibilityPolicyId: { type: Schema.Types.ObjectId, ref: 'EligibilityPolicy' },

    /** Set when this course was cloned from another. Provenance, not a pointer. */
    copiedFromCourseId: { type: Schema.Types.ObjectId, ref: 'Course' },
    version: { type: Number, default: 1 },
  },
  { timestamps: true }
);

CourseSchema.plugin(tenantGuard);
CourseSchema.plugin(localeMap, { paths: ['title', 'summary'] });

CourseSchema.index({ tenantId: 1, code: 1, session: 1 }, { unique: true });
CourseSchema.index({ tenantId: 1, programId: 1, order: 1 });
CourseSchema.index({ tenantId: 1, visibility: 1, status: 1 });

module.exports = mongoose.model('Course', CourseSchema);
