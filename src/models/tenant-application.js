'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * An institution's request to open a space on Lintel. Platform-scoped (there is
 * no tenant yet — this is the thing that BECOMES one). When auto-provision is on,
 * an application is created and immediately approved in one step; when it is off,
 * it waits here for a human to approve, and approval is what provisions the tenant
 * and emails the owner their account details.
 *
 * We keep the application even after approval — it is the record of who asked for
 * an institution and when, which matters for a platform that holds real people's
 * records.
 */
const TenantApplicationSchema = new Schema(
  {
    institutionName: { type: String, required: true },
    requestedSlug: { type: String, required: true, lowercase: true, trim: true },
    contactName: { type: String, required: true },
    contactEmail: { type: String, required: true, lowercase: true, trim: true },
    country: String,
    about: String,
    plan: { type: String, default: 'trial' },

    status: { type: String, enum: ['pending', 'approved', 'declined'], default: 'pending' },
    declineReason: String,
    reviewedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,

    // Filled once approved.
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

TenantApplicationSchema.index({ requestedSlug: 1 });
TenantApplicationSchema.index({ status: 1, createdAt: -1 });
TenantApplicationSchema.index({ contactEmail: 1 });

module.exports = mongoose.model('TenantApplication', TenantApplicationSchema);
