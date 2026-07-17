'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');

/** A learner's Web Push subscription. One device = one row. */
const PushSubscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true },
    keys: { p256dh: String, auth: String },
    userAgent: String,
  },
  { timestamps: true }
);

PushSubscriptionSchema.plugin(tenantGuard);
PushSubscriptionSchema.index({ tenantId: 1, userId: 1, endpoint: 1 }, { unique: true });

module.exports = mongoose.model('PushSubscription', PushSubscriptionSchema);
