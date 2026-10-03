'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * PLATFORM-SCOPED. A fixed-window counter for throttling sensitive endpoints
 * (login, registration, set-password). Keyed per window so it needs no cron: a
 * TTL index drops each window's doc once it expires. Platform-scoped because a
 * brute-force attempt has no tenant and may precede any session.
 */
const RateHitSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    count: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false }
);

// TTL: Mongo removes the document shortly after the window ends.
RateHitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RateHit', RateHitSchema);
