'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const appendOnly = require('../plugins/append-only');

/**
 * Every eligibility evaluation and every content access, granted OR withheld.
 *
 * APPEND-ONLY. This is the record an institution answers to — "who saw this
 * recording, and when were they refused?" A withheld evaluation is logged as
 * deliberately as a granted one, because "the door held" is itself the evidence
 * that the policy worked.
 */
const AccessLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    action: {
      type: String,
      enum: ['eligibility_granted', 'eligibility_withheld', 'view', 'stream', 'download', 'denied'],
      required: true,
    },
    policySlug: String,
    subjectType: String, // 'Lesson', 'ContentBlock', 'Course'
    subjectId: Schema.Types.ObjectId,
    failedRules: [String],
    accessionNumber: String, // set when the access touched archive material
    ip: String,
    userAgent: String,
    sessionId: String,
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

AccessLogSchema.plugin(tenantGuard);
AccessLogSchema.plugin(appendOnly, { modelName: 'AccessLog' });

AccessLogSchema.index({ tenantId: 1, at: -1 });
AccessLogSchema.index({ tenantId: 1, userId: 1, at: -1 });
AccessLogSchema.index({ tenantId: 1, subjectType: 1, subjectId: 1, at: -1 });

module.exports = mongoose.model('AccessLog', AccessLogSchema);
