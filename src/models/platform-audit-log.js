'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const appendOnly = require('../plugins/append-only');

/**
 * PLATFORM-SCOPED, append-only. The record of operator actions that happen ABOVE
 * any tenant — suspending an institution, changing a plan, approving an
 * application, granting or revoking a superadmin. The tenant-scoped AuditLog
 * cannot hold these (they belong to no tenant), so they live here.
 *
 * Same discipline as every audit surface: nothing is ever updated or deleted.
 */
const PlatformAuditLogSchema = new Schema(
  {
    // Null actor = system-originated (e.g. the automated trial sweep). Human
    // actions always set this; only unattended jobs leave it empty.
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true }, // e.g. 'tenant.suspended', 'superadmin.granted'
    subjectType: String,                       // 'Tenant' | 'User' | 'TenantApplication'
    subjectId: Schema.Types.ObjectId,
    meta: Schema.Types.Mixed,
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

PlatformAuditLogSchema.plugin(appendOnly, { modelName: 'PlatformAuditLog' });
PlatformAuditLogSchema.index({ at: -1 });

module.exports = mongoose.model('PlatformAuditLog', PlatformAuditLogSchema);
