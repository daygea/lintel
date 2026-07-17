'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');

/**
 * Attendance at a live session. Append-only-ish: recorded once per person per
 * session, and marking is idempotent (a unique index), because a facilitator
 * ticking the same name twice must not create two rows.
 */
const AttendanceSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    state: { type: String, enum: ['present', 'absent', 'excused', 'late'], default: 'present' },
    recordedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    recordedAt: { type: Date, default: Date.now },
    note: String,
  },
  { timestamps: true }
);

AttendanceSchema.plugin(tenantGuard);

AttendanceSchema.index({ tenantId: 1, sessionId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', AttendanceSchema);
