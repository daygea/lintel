'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');

const LessonProgressSchema = new Schema(
  {
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true, index: true },
    lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true, index: true },

    state: { type: String, enum: ['not_started', 'in_progress', 'complete'], default: 'not_started' },
    secondsSpent: { type: Number, default: 0 },
    completedAt: Date,
  },
  { timestamps: true }
);

LessonProgressSchema.plugin(tenantGuard);

LessonProgressSchema.index({ tenantId: 1, enrollmentId: 1, lessonId: 1 }, { unique: true });

module.exports = mongoose.model('LessonProgress', LessonProgressSchema);
