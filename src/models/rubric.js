'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

/**
 * A rubric: criteria, each with ordered levels. You cannot mark an oral recitation
 * with a number pulled from the air — you mark it against described levels of
 * attainment, so two assessors mean roughly the same thing by "secure".
 */
const LevelSchema = new Schema(
  {
    label: { ...LocaleMapType, required: true },   // "Emerging", "Secure", "Exemplary"
    points: { type: Number, required: true },
    descriptor: LocaleMapType,                     // what this level actually looks like
  },
  { _id: true }
);

const CriterionSchema = new Schema(
  {
    label: { ...LocaleMapType, required: true },    // "Tonal accuracy"
    weight: { type: Number, default: 1, min: 0 },
    levels: { type: [LevelSchema], default: [] },
  },
  { _id: true }
);

const RubricSchema = new Schema(
  {
    title: { ...LocaleMapType, required: true },
    criteria: { type: [CriterionSchema], default: [] },
  },
  { timestamps: true }
);

RubricSchema.plugin(tenantGuard);
RubricSchema.plugin(localeMap, { paths: ['title'] });

RubricSchema.index({ tenantId: 1, createdAt: -1 });

/** Max attainable score — the sum of each criterion's top level × its weight. */
RubricSchema.virtual('maxScore').get(function () {
  return this.criteria.reduce((sum, c) => {
    const top = Math.max(0, ...c.levels.map((l) => l.points));
    return sum + top * (c.weight ?? 1);
  }, 0);
});

module.exports = mongoose.model('Rubric', RubricSchema);
