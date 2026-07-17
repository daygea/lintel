'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');

/**
 * A request to join a cohort, awaiting a human decision.
 *
 * Admission is a person's judgement, never the software's and never a payment's
 * — the same principle that governs attestations in Sprint 3. A registrar admits;
 * money does not.
 */
const ApplicationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    cohortId: { type: Schema.Types.ObjectId, ref: 'Cohort', required: true, index: true },

    answers: Schema.Types.Mixed, // tenant-defined intake questions
    assetIds: [{ type: Schema.Types.ObjectId, ref: 'Asset' }], // supporting documents

    status: {
      type: String,
      enum: ['submitted', 'under_review', 'admitted', 'declined', 'withdrawn'],
      default: 'submitted',
    },
    decidedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    decisionNote: String,
  },
  { timestamps: true }
);

ApplicationSchema.plugin(tenantGuard);

ApplicationSchema.index({ tenantId: 1, cohortId: 1, status: 1 });
ApplicationSchema.index({ tenantId: 1, userId: 1, cohortId: 1 }, { unique: true });

module.exports = mongoose.model('Application', ApplicationSchema);
