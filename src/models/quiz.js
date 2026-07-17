'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

/**
 * A quiz: a set of questions, drawn optionally from a larger pool, optionally
 * randomised and timed. Auto-marked where the type allows; essay questions fall
 * through to human marking (and can feed an assessment).
 *
 * Question types: mcq (one right), multi (several right, partial credit),
 * matching, cloze (fill-in), numeric (with tolerance), short (exact/keyword),
 * essay (not auto-marked).
 */
const OptionSchema = new Schema(
  { key: String, text: LocaleMapType, correct: { type: Boolean, default: false } },
  { _id: true }
);

const QuestionSchema = new Schema(
  {
    type: { type: String, enum: ['mcq', 'multi', 'matching', 'cloze', 'numeric', 'short', 'essay'], required: true },
    prompt: { ...LocaleMapType, required: true },
    points: { type: Number, default: 1 },

    options: { type: [OptionSchema], default: [] },   // mcq / multi
    pairs: { type: [{ left: String, right: String }], default: [] }, // matching
    answers: { type: [String], default: [] },         // cloze / short (accepted)
    numericAnswer: Number,                            // numeric
    tolerance: { type: Number, default: 0 },          // numeric ± band
    caseSensitive: { type: Boolean, default: false },
  },
  { _id: true }
);

const QuizSchema = new Schema(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', index: true },
    title: { ...LocaleMapType, required: true },

    questions: { type: [QuestionSchema], default: [] },
    drawCount: { type: Number },      // pull N at random from the pool; null = all
    shuffle: { type: Boolean, default: false },
    timeLimitMinutes: Number,
    attemptsAllowed: { type: Number, default: 1 },
    passPercent: { type: Number, default: 50 },

    status: { type: String, enum: ['draft', 'open', 'closed'], default: 'draft' },
  },
  { timestamps: true }
);

QuizSchema.plugin(tenantGuard);
QuizSchema.plugin(localeMap, { paths: ['title'] });

QuizSchema.index({ tenantId: 1, courseId: 1 });

module.exports = mongoose.model('Quiz', QuizSchema);
