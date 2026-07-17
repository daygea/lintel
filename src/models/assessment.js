'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

/**
 * A thing to be assessed. Its submission types say what a learner may hand in —
 * for an Oríkì recitation, 'audio'; for a written reflection, 'text'.
 *
 * requiresModeration + moderatorRole encode the rule that matters at OISS: a
 * junior assessor's mark is provisional until an elder moderates it.
 */
const AssessmentSchema = new Schema(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', index: true },
    title: { ...LocaleMapType, required: true },
    instructions: LocaleMapType,

    type: { type: String, enum: ['oral', 'written', 'practical', 'quiz'], default: 'oral' },
    submissionTypes: { type: [String], default: ['audio'] }, // audio|video|text|file

    rubricId: { type: Schema.Types.ObjectId, ref: 'Rubric' },
    weight: { type: Number, default: 1 },
    attemptsAllowed: { type: Number, default: 3 },
    dueAt: Date,

    requiresModeration: { type: Boolean, default: false },
    moderatorRole: { type: String, enum: ['assessor', 'elder', 'owner'], default: 'elder' },

    status: { type: String, enum: ['draft', 'open', 'closed'], default: 'draft' },
  },
  { timestamps: true }
);

AssessmentSchema.plugin(tenantGuard);
AssessmentSchema.plugin(localeMap, { paths: ['title', 'instructions'] });

AssessmentSchema.index({ tenantId: 1, courseId: 1 });

module.exports = mongoose.model('Assessment', AssessmentSchema);
