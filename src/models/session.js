'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

/**
 * A scheduled live meeting — the "Ọjọ́ Ìpàdé" on the learner dashboard.
 *
 * We do NOT build video conferencing. The call happens on Zoom or Meet; we hold
 * the schedule, the link, and the attendance record. Building conferencing would
 * be months of work to reproduce, worse, what already exists for free.
 */
const SessionSchema = new Schema(
  {
    cohortId: { type: Schema.Types.ObjectId, ref: 'Cohort', required: true, index: true },
    title: { ...LocaleMapType, required: true },

    startsAt: { type: Date, required: true },
    durationMinutes: { type: Number, default: 60 },

    /** Link out. We store it; we do not host it. */
    joinUrl: String,
    location: String, // for residency/hybrid

    facilitatorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['scheduled', 'live', 'ended', 'cancelled'], default: 'scheduled' },
  },
  { timestamps: true }
);

SessionSchema.plugin(tenantGuard);
SessionSchema.plugin(localeMap, { paths: ['title'] });

SessionSchema.index({ tenantId: 1, cohortId: 1, startsAt: 1 });

module.exports = mongoose.model('Session', SessionSchema);
