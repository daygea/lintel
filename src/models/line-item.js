'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

/**
 * A gradable column in a course gradebook. THE central abstraction of the
 * gradebook, and named deliberately: LTI Advantage's Assignment and Grade
 * Services (Sprint 9) post scores against "line items". Build the gradebook any
 * other way and LTI becomes a migration. Build it line-item-native and LTI is a
 * feature that reads rows that already exist.
 *
 * A line item is fed by an assessment, a quiz, or entered by hand. Its category
 * ties it to a weight in the course's GradeScheme.
 */
const LineItemSchema = new Schema(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    label: { ...LocaleMapType, required: true },
    category: { type: String, required: true }, // matches a GradeScheme category key

    source: { type: String, enum: ['assessment', 'quiz', 'manual', 'lti'], default: 'manual' },
    assessmentId: { type: Schema.Types.ObjectId, ref: 'Assessment' },
    quizId: { type: Schema.Types.ObjectId, ref: 'Quiz' },

    maxPoints: { type: Number, required: true, default: 100 },
    /** A resourceLinkId for LTI, so an external tool's line item round-trips. */
    ltiResourceId: String,

    /** ISO-8601 due; surfaced to LTI and the learner. */
    dueAt: Date,
    published: { type: Boolean, default: false },
  },
  { timestamps: true }
);

LineItemSchema.plugin(tenantGuard);
LineItemSchema.plugin(localeMap, { paths: ['label'] });

LineItemSchema.index({ tenantId: 1, courseId: 1, category: 1 });

module.exports = mongoose.model('LineItem', LineItemSchema);
