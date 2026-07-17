'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

const LessonSchema = new Schema(
  {
    moduleId: { type: Schema.Types.ObjectId, ref: 'Module', required: true, index: true },
    /** Denormalised so a lesson can be found without walking up through its module. */
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },

    title: { ...LocaleMapType, required: true },
    order: { type: Number, default: 0 },
    estimatedMinutes: { type: Number, min: 0 },

    /** Sprint 3. A lesson-level policy overrides its course's. */
    eligibilityPolicyId: { type: Schema.Types.ObjectId, ref: 'EligibilityPolicy' },
  },
  { timestamps: true }
);

LessonSchema.plugin(tenantGuard);
LessonSchema.plugin(localeMap, { paths: ['title'] });

LessonSchema.index({ tenantId: 1, moduleId: 1, order: 1 });
LessonSchema.index({ tenantId: 1, courseId: 1 });

module.exports = mongoose.model('Lesson', LessonSchema);
