'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const appendOnly = require('../plugins/append-only');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

/**
 * A grade. APPEND-ONLY.
 *
 * Moderation writes a NEW grade with moderatedFromGradeId set — it never mutates
 * the first. When an elder overrules a junior assessor, both marks survive in the
 * record, each with its author. "Provisional" means no final grade exists yet;
 * the final is the moderator's, and the provisional remains readable beside it.
 *
 * feedbackAssetId is spoken feedback — first-class, not an afterthought. In a
 * tradition carried by voice, written marginalia is the wrong instrument, and a
 * learner who reads slowly is not a learner who learns slowly.
 */
const CriterionScoreSchema = new Schema(
  {
    criterionId: { type: Schema.Types.ObjectId, required: true },
    levelId: { type: Schema.Types.ObjectId, required: true },
    points: { type: Number, required: true },
    comment: String,
  },
  { _id: false }
);

const GradeSchema = new Schema(
  {
    submissionId: { type: Schema.Types.ObjectId, ref: 'Submission', required: true, index: true },
    assessorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    criterionScores: { type: [CriterionScoreSchema], default: [] },
    totalPoints: { type: Number, required: true },

    feedback: LocaleMapType,
    feedbackAssetId: { type: Schema.Types.ObjectId, ref: 'Asset' }, // spoken feedback

    isFinal: { type: Boolean, default: false },
    moderatedFromGradeId: { type: Schema.Types.ObjectId, ref: 'Grade' },
  },
  { timestamps: true }
);

GradeSchema.plugin(tenantGuard);
GradeSchema.plugin(appendOnly, { modelName: 'Grade' });
GradeSchema.plugin(localeMap, { paths: ['feedback'] });

GradeSchema.index({ tenantId: 1, submissionId: 1, createdAt: -1 });

module.exports = mongoose.model('Grade', GradeSchema);
