'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');

/**
 * A record of every message the platform tried to send.
 *
 * "Did the reminder actually go out?" must be answerable without reading provider
 * dashboards. Every attempt is logged with its channel and outcome, so a
 * registrar can see that Adéọlá was reminded on Tuesday and Hauwa's SMS bounced.
 */
const NotificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    channel: { type: String, enum: ['email', 'sms', 'webpush', 'whatsapp'], required: true },

    template: { type: String, required: true }, // 'session.reminder', 'application.decided'
    payload: Schema.Types.Mixed,

    to: String, // resolved address at send time
    status: { type: String, enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
    providerRef: String,
    error: String,
    sentAt: Date,
  },
  { timestamps: true }
);

NotificationSchema.plugin(tenantGuard);

NotificationSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
NotificationSchema.index({ tenantId: 1, template: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);
