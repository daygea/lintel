'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');

/**
 * One row per reminder actually sent, so the reminder sweep is idempotent: a
 * deadline reminder for a given item + learner goes out once, no matter how often
 * the sweep runs. Tenant-scoped like the items it refers to.
 *
 * Old rows are pruned by the reminder sweep (createdAt older than the retention
 * window) rather than a TTL index — a TTL index must be single-field on the date,
 * which can't lead with tenantId, so pruning in the job keeps tenant-scoping clean.
 * This is a dedup ledger, not a permanent record.
 */
const ReminderLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, required: true }, // 'session' | 'fee' | 'assessment'
    itemId: { type: String, required: true }, // the source document's id (as a string)
    at: { type: Date }, // the deadline instant the reminder was for
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

ReminderLogSchema.plugin(tenantGuard);

// One reminder per item per learner.
ReminderLogSchema.index({ tenantId: 1, userId: 1, kind: 1, itemId: 1 }, { unique: true });
// Supports the sweep's prune of rows past the retention window.
ReminderLogSchema.index({ tenantId: 1, createdAt: 1 });

module.exports = mongoose.model('ReminderLog', ReminderLogSchema);
