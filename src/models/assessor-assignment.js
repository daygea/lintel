'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');

/** Who is marking a submission, and in what capacity. */
const AssessorAssignmentSchema = new Schema(
  {
    submissionId: { type: Schema.Types.ObjectId, ref: 'Submission', required: true, index: true },
    assessorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['primary', 'second', 'moderator'], default: 'primary' },
    status: { type: String, enum: ['assigned', 'completed'], default: 'assigned' },
    assignedAt: { type: Date, default: Date.now },
    completedAt: Date,
  },
  { timestamps: true }
);

AssessorAssignmentSchema.plugin(tenantGuard);

AssessorAssignmentSchema.index({ tenantId: 1, submissionId: 1, assessorUserId: 1 }, { unique: true });

module.exports = mongoose.model('AssessorAssignment', AssessorAssignmentSchema);
