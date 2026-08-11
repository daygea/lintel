'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const appendOnly = require('../plugins/append-only');
const { MoneySchema } = require('../lib/money');

/**
 * PLATFORM-SCOPED, append-only. What an institution paid LINTEL for its plan — the
 * SaaS side of the ledger, entirely separate from the tenant-scoped Invoice/Payment
 * (which is a learner paying their institution). Names a tenant as a field but
 * belongs to the platform: it's Lintel's revenue record.
 *
 * providerRef is unique per tenant, so a webhook delivered several times records
 * the money — and extends the plan — exactly once.
 */
const PlatformPaymentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    plan: { type: String, required: true },
    amount: { type: MoneySchema, required: true },
    provider: { type: String, default: 'paystack' },
    providerRef: { type: String, required: true },
    periodEnd: { type: Date },
    paidAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

PlatformPaymentSchema.plugin(appendOnly, { modelName: 'PlatformPayment' });
// providerRef is always present, so a plain unique compound needs no sparse/partial.
PlatformPaymentSchema.index({ tenantId: 1, providerRef: 1 }, { unique: true });

module.exports = mongoose.model('PlatformPayment', PlatformPaymentSchema);
