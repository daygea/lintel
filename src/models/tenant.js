'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const { SUPPORTED } = require('../lib/money');
const { PLAN_KEYS } = require('../config/plans');
const { ALL: ALL_FEATURES } = require('../config/features');

/**
 * PLATFORM-SCOPED. Does not use tenant-guard — it IS the tenant.
 * Listed in scripts/checkers/check-tenant-guard.js under PLATFORM_SCOPED.
 */
const TenantSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true,
            match: [/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, 'slug must be subdomain-safe'] },
    name: { type: String, required: true, trim: true },
    domains: [{ type: String, lowercase: true, trim: true }],

    region: { type: String, enum: ['af-west', 'af-east', 'eu', 'us'], default: 'af-west' },
    baseCurrency: { type: String, enum: SUPPORTED, default: 'NGN' },
    defaultLocale: { type: String, default: 'en' },
    locales: { type: [String], default: ['en'] },
    timezone: { type: String, default: 'Africa/Lagos' },

    branding: {
      logoUrl: String,
      primaryColor: { type: String, default: '#26314F' },
      wordmark: String,
    },

    plan: { type: String, enum: PLAN_KEYS, default: 'trial' },
    features: {
      type: [String],
      default: [],
      validate: {
        validator: (v) => v.every((f) => ALL_FEATURES.includes(f)),
        message: 'Unknown feature key. Declare it in config/features.js first.',
      },
    },

    status: { type: String, enum: ['trial', 'active', 'suspended', 'closed'], default: 'trial' },
    trialEndsAt: { type: Date },   // when a trial lapses (set at provision for trial plans)
    trialWarnedAt: { type: Date }, // set once when the "trial ending" notice is sent
    currentPeriodEnd: { type: Date }, // paid plans: when the current paid period lapses
    // Opt-in marketplace payouts: the institution's Paystack subaccount that
    // receives learner payments directly (Lintel keeps a plan-based cut). Unset =
    // payments settle to Lintel's account as before.
    paystackSubaccount: { type: String, trim: true },
  },
  { timestamps: true }
);

TenantSchema.index({ domains: 1 });

TenantSchema.methods.hasFeature = function hasFeature(key) {
  return this.features.includes(key);
};

module.exports = mongoose.model('Tenant', TenantSchema);
