'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');

/**
 * A MongoDB-backed job queue.
 *
 * The plan said BullMQ. Redis is another service to run, monitor and pay for,
 * and at this volume — hundreds of uploads a week, not hundreds a second —
 * Mongo is entirely adequate. Fewer moving parts is worth more to a solo builder
 * than throughput nobody will use for two years.
 *
 * The interface in lib/queue.js is deliberately narrow so that swapping to
 * BullMQ later is a driver change, not a rewrite. Swap when you are regularly
 * seeing more than a few jobs per second, or when you want fan-out across
 * several machines.
 */
const JobSchema = new Schema(
  {
    type: { type: String, required: true },
    payload: Schema.Types.Mixed,

    status: {
      type: String,
      enum: ['queued', 'running', 'done', 'failed'],
      default: 'queued',
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },

    runAfter: { type: Date, default: Date.now },
    lockedAt: Date,
    lockedBy: String,

    error: String,
    finishedAt: Date,
  },
  { timestamps: true }
);

JobSchema.plugin(tenantGuard);

JobSchema.index({ tenantId: 1, status: 1, runAfter: 1 });
JobSchema.index({ tenantId: 1, type: 1, status: 1 });

module.exports = mongoose.model('Job', JobSchema);
