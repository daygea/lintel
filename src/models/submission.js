'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');

/**
 * A learner's attempt. The recording is an Asset (reusing Sprint 1's resumable
 * upload — a six-minute recitation on 3G survives a dropped connection because
 * the upload path already does).
 */
const SubmissionSchema = new Schema(
  {
    assessmentId: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    attemptNo: { type: Number, default: 1 },

    text: String,
    assetIds: [{ type: Schema.Types.ObjectId, ref: 'Asset' }],

    status: {
      type: String,
      enum: ['draft', 'submitted', 'under_review', 'returned', 'graded'],
      default: 'submitted',
    },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

SubmissionSchema.plugin(tenantGuard);

SubmissionSchema.index({ tenantId: 1, assessmentId: 1, userId: 1, attemptNo: 1 }, { unique: true });
SubmissionSchema.index({ tenantId: 1, status: 1 });

module.exports = mongoose.model('Submission', SubmissionSchema);
