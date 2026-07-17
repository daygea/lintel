'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');

const QuizAttemptSchema = new Schema(
  {
    quizId: { type: Schema.Types.ObjectId, ref: 'Quiz', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    attemptNo: { type: Number, default: 1 },

    responses: Schema.Types.Mixed, // { questionId: answer }
    autoScore: Number,
    maxScore: Number,
    needsManualMarking: { type: Boolean, default: false }, // essay present

    startedAt: { type: Date, default: Date.now },
    submittedAt: Date,
    status: { type: String, enum: ['in_progress', 'submitted', 'marked'], default: 'in_progress' },
  },
  { timestamps: true }
);

QuizAttemptSchema.plugin(tenantGuard);
QuizAttemptSchema.index({ tenantId: 1, quizId: 1, userId: 1, attemptNo: 1 }, { unique: true });

module.exports = mongoose.model('QuizAttempt', QuizAttemptSchema);
