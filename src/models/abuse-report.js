'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * PLATFORM-SCOPED. A report of potential abuse — filed by anyone (a learner, an
 * institution, an automated flag) and worked by a platform operator. It names a
 * SUBJECT (a tenant, a user, or a specific resource) but never copies the content
 * itself; an operator investigates through the metadata and audit trail, and only
 * reaches actual content via an explicit, notified break-glass grant.
 */
const AbuseReportSchema = new Schema(
  {
    // Who/what is reported. tenantId names the institution the report concerns (if any).
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' },
    subjectType: { type: String, enum: ['tenant', 'user', 'resource'], required: true },
    subjectId: Schema.Types.ObjectId,          // a userId, or a resource id
    subjectRef: String,                         // free text when there's no id (e.g. a URL/path)

    category: {
      type: String,
      enum: ['illegal_content', 'harassment', 'compromised_account', 'spam', 'other'],
      default: 'other',
    },
    detail: String,                             // the reporter's description
    reportedByUserId: { type: Schema.Types.ObjectId, ref: 'User' }, // null if anonymous/system
    reporterEmail: String,                       // for a reporter without an account

    status: { type: String, enum: ['open', 'investigating', 'actioned', 'dismissed'], default: 'open', index: true },
    resolution: String,
    handledByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    handledAt: Date,
  },
  { timestamps: true }
);

AbuseReportSchema.index({ status: 1, createdAt: -1 });
AbuseReportSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('AbuseReport', AbuseReportSchema);
