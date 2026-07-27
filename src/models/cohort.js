'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

/** A dated run of a programme or course. "Diploma, 2026/2027 intake." */
const CohortSchema = new Schema(
  {
    programId: { type: Schema.Types.ObjectId, ref: 'Program', index: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', index: true },

    title: { ...LocaleMapType, required: true },
    /**
     * A human-facing code a registrar references when importing a roster
     * ('2026-INTAKE'). Optional, but unique per tenant when present, so a SIS
     * import can resolve a cohort by something memorable rather than an ObjectId.
     */
    code: { type: String, trim: true }, // @admin-string — registrar-facing cohort code, not learner content
    session: { type: String, required: true, trim: true }, // '2026/2027'

    mode: { type: String, enum: ['online', 'hybrid', 'residency'], default: 'online' },
    startsAt: Date,
    endsAt: Date,
    capacity: { type: Number, min: 0 },

    /**
     * The application window. Outside it, admissions are closed — a rule the
     * service enforces rather than a decoration. Institutions run intakes; they
     * do not accept students the day before graduation.
     */
    applicationsOpenAt: Date,
    applicationsCloseAt: Date,

    status: { type: String, enum: ['draft', 'open', 'running', 'closed'], default: 'draft' },
  },
  { timestamps: true }
);

CohortSchema.plugin(tenantGuard);
CohortSchema.plugin(localeMap, { paths: ['title'] });
CohortSchema.index({ tenantId: 1, code: 1 }, { unique: true, sparse: true });

CohortSchema.index({ tenantId: 1, session: 1 });
CohortSchema.index({ tenantId: 1, status: 1 });

/** A cohort belongs to a programme OR a course, never neither. */
CohortSchema.pre('validate', function requireParent(next) {
  if (!this.programId && !this.courseId) {
    return next(new Error('A cohort must belong to a programme or a course'));
  }
  next();
});

module.exports = mongoose.model('Cohort', CohortSchema);
