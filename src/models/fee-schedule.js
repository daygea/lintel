'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');
const { MoneySchema } = require('../lib/money');

/**
 * What a cohort costs, and how it may be paid.
 *
 * Free is first-class: a schedule with an empty items[] is valid, and a tenant
 * may charge nothing for everything. Free is NOT the same as open — an unpriced
 * course can still be gated by attestation. Do not conflate them.
 *
 * platformFee is present and set to zero. Retrofitting revenue share into a
 * settled ledger is genuinely painful; anticipating it is one field.
 */
const FeeItemSchema = new Schema(
  {
    label: { ...LocaleMapType, required: true },
    amount: { type: MoneySchema, required: true },
  },
  { _id: true }
);

const InstalmentPlanSchema = new Schema(
  {
    label: { ...LocaleMapType, required: true },
    /** Each instalment: a fraction due by a relative day offset from enrolment. */
    instalments: [
      {
        amount: { type: MoneySchema, required: true },
        dueDayOffset: { type: Number, default: 0 }, // days after enrolment
        _id: false,
      },
    ],
  },
  { _id: true }
);

const FeeScheduleSchema = new Schema(
  {
    cohortId: { type: Schema.Types.ObjectId, ref: 'Cohort', index: true },
    label: { ...LocaleMapType, required: true },

    items: { type: [FeeItemSchema], default: [] },
    plans: { type: [InstalmentPlanSchema], default: [] }, // pay-in-full is the empty case

    /** Zero today. The one field that keeps a future marketplace out of a migration. */
    platformFee: { type: MoneySchema },

    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

FeeScheduleSchema.plugin(tenantGuard);
FeeScheduleSchema.plugin(localeMap, { paths: ['label'] });

FeeScheduleSchema.index({ tenantId: 1, cohortId: 1 });

module.exports = mongoose.model('FeeSchedule', FeeScheduleSchema);
