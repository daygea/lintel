'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');

/**
 * A learner's active place in a cohort.
 *
 * paymentState lives here but is NOT enforced here. In Sprint 3 the eligibility
 * engine reads it as one rule among several (payment_state), so that "fees at
 * least part-paid" composes with "holds an attestation" rather than being a
 * separate, hard-coded gate. Free ≠ open: a waived enrolment can still be held
 * pending an attestation.
 */
const EnrollmentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    cohortId: { type: Schema.Types.ObjectId, ref: 'Cohort', required: true, index: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', index: true },

    status: {
      type: String,
      enum: ['active', 'paused', 'completed', 'withdrawn', 'expired'],
      default: 'active',
    },
    paymentState: {
      type: String,
      enum: ['unpaid', 'deposit', 'part', 'full', 'waived'],
      default: 'unpaid',
    },

    enrolledAt: { type: Date, default: Date.now },
    completedAt: Date,
  },
  { timestamps: true }
);

EnrollmentSchema.plugin(tenantGuard);

EnrollmentSchema.index({ tenantId: 1, userId: 1, cohortId: 1 }, { unique: true });
EnrollmentSchema.index({ tenantId: 1, cohortId: 1, status: 1 });

module.exports = mongoose.model('Enrollment', EnrollmentSchema);
