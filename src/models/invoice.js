'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { MoneySchema } = require('../lib/money');

/**
 * What a learner owes for an enrolment, and what they have paid so far.
 *
 * amountPaid is a running tally the payment service maintains; it is NOT
 * append-only (a correction should just update it), but every Payment that moves
 * it IS a permanent record. state is derived from the two amounts, never set by
 * hand except for 'waived' (a scholarship, audited).
 */
const InvoiceSchema = new Schema(
  {
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    feeScheduleId: { type: Schema.Types.ObjectId, ref: 'FeeSchedule' },

    amountDue: { type: MoneySchema, required: true },
    amountPaid: { type: MoneySchema, required: true },

    /** Schedule of instalment due dates, if a plan was chosen. */
    dueDates: [{ amount: { type: MoneySchema }, dueAt: Date, _id: false }],

    state: {
      type: String,
      enum: ['unpaid', 'deposit', 'part', 'full', 'waived', 'overdue'],
      default: 'unpaid',
    },
    waivedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    waiverReason: String,
  },
  { timestamps: true }
);

InvoiceSchema.plugin(tenantGuard);

InvoiceSchema.index({ tenantId: 1, enrollmentId: 1 }, { unique: true });
InvoiceSchema.index({ tenantId: 1, userId: 1, state: 1 });

module.exports = mongoose.model('Invoice', InvoiceSchema);
