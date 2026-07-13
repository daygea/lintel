'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const appendOnly = require('../plugins/append-only');

/**
 * The first append-only collection. Attestation, Grade and AccessLog will join it
 * in Sprints 3 and 5.
 *
 * Nothing here is ever updated or deleted. If a fact changes, write a new record.
 */
const AuditLogSchema = new Schema(
  {
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    subjectType: String,
    subjectId: Schema.Types.ObjectId,
    meta: Schema.Types.Mixed,
    ip: String,
    userAgent: String,
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

AuditLogSchema.plugin(tenantGuard);
AuditLogSchema.plugin(appendOnly, { modelName: 'AuditLog' });

AuditLogSchema.index({ tenantId: 1, at: -1 });
AuditLogSchema.index({ tenantId: 1, action: 1, at: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
