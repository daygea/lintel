'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const appendOnly = require('../plugins/append-only');
const { MoneySchema } = require('../lib/money');

/**
 * A payment against an invoice. APPEND-ONLY — a ledger entry is a matter of
 * record. A refund is a new negative Payment, never a mutation of the original.
 *
 * providerRef is unique per tenant so a replayed webhook (Paystack delivers more
 * than once) cannot be recorded twice — the whole idempotency story hangs on it.
 *
 * method includes 'bank_transfer' as a first-class citizen, confirmed manually by
 * a registrar. This is Nigeria: transfer-and-confirm is not a fallback, it is how
 * a great many learners will actually pay.
 */
const PaymentSchema = new Schema(
  {
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    amount: { type: MoneySchema, required: true }, // negative for a refund
    method: { type: String, enum: ['paystack', 'bank_transfer', 'cash', 'waiver', 'refund'], required: true },

    provider: { type: String, enum: ['paystack', 'flutterwave', 'stripe', 'manual'], default: 'manual' },
    providerRef: String,

    confirmedByUserId: { type: Schema.Types.ObjectId, ref: 'User' }, // for manual methods
    note: String,
    at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

PaymentSchema.plugin(tenantGuard);
PaymentSchema.plugin(appendOnly, { modelName: 'Payment' });

PaymentSchema.index({ tenantId: 1, invoiceId: 1, at: -1 });
// Idempotency: a provider reference may appear once per tenant. Sparse, because
// manual payments have no ref.
// Unique per tenant — but ONLY for payments that actually carry a providerRef
// (Paystack/webhook payments), so a replayed webhook moves the money once.
// A partial index, NOT sparse: a *compound* sparse index still indexes a document
// when any of its keys is present, and tenantId always is — so `sparse` would let
// two ref-less manual payments (bank transfer, cash) collide on {tenant, null}.
PaymentSchema.index(
  { tenantId: 1, providerRef: 1 },
  { unique: true, partialFilterExpression: { providerRef: { $type: 'string' } } }
);

module.exports = mongoose.model('Payment', PaymentSchema);
