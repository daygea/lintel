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

    status: { type: String, enum: ['trial', 'active', 'suspended', 'closed', 'deleted'], default: 'trial' },
    deletedAt: { type: Date }, // set when soft-deleted; the tenant is hidden from the console and stops resolving
    trialEndsAt: { type: Date },   // when a trial lapses (set at provision for trial plans)
    trialWarnedAt: { type: Date }, // set once when the "trial ending" notice is sent
    currentPeriodEnd: { type: Date }, // paid plans: when the current paid period lapses
    // Opt-in marketplace payouts: the institution's Paystack subaccount that
    // receives learner payments directly (Lintel keeps a plan-based cut). Unset =
    // payments settle to Lintel's account as before. This is the code the split
    // reads at checkout; it is created automatically from the bank details below.
    paystackSubaccount: { type: String, trim: true },

    // The institution's settlement bank account. The admin enters bank + account
    // number; we resolve the account name and create/update the Paystack subaccount
    // from it, so no one ever handles a raw subaccount code by hand. accountNumber
    // is the institution's own payout account (not a card) — stored so the
    // subaccount can be updated without re-entry; only its last 4 are ever shown.
    payout: {
      bankName: { type: String, trim: true },
      bankCode: { type: String, trim: true },
      accountNumber: { type: String, trim: true },
      accountName: { type: String, trim: true },
      updatedAt: { type: Date },
    },

    // Access policy the institution controls for itself.
    access: {
      // When a lesson has NO eligibility policy: default (false) requires an active
      // enrolment to open it (fail closed); true lets ANY active member of the
      // institution open such "open teaching" without enrolling. OISS stays strict;
      // a more open institution can opt in. Policied lessons are unaffected either way.
      openLessonsForMembers: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

TenantSchema.index({ domains: 1 });

TenantSchema.methods.hasFeature = function hasFeature(key) {
  return this.features.includes(key);
};

module.exports = mongoose.model('Tenant', TenantSchema);
