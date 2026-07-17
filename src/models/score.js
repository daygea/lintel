'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');

/**
 * A learner's score on one line item.
 *
 * Deliberately NOT append-only: unlike a Grade (an assessor's judgement of a
 * performance, which is a matter of record), a gradebook Score is a mutable
 * tally that a legitimate correction should simply update. An override records
 * WHO changed it and when — accountability without immutability. The audit log
 * carries the history.
 *
 * scoreOf(final Grade) flows in here; a manual line item is entered directly.
 */
const ScoreSchema = new Schema(
  {
    lineItemId: { type: Schema.Types.ObjectId, ref: 'LineItem', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    points: { type: Number, required: true },
    /** Set when a human overrode a computed score. */
    overriddenByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    overrideNote: String,

    comment: String,
  },
  { timestamps: true }
);

ScoreSchema.plugin(tenantGuard);

ScoreSchema.index({ tenantId: 1, lineItemId: 1, userId: 1 }, { unique: true });
ScoreSchema.index({ tenantId: 1, userId: 1 });

module.exports = mongoose.model('Score', ScoreSchema);
