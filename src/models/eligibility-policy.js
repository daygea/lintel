'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

/**
 * A named, reusable set of rules deciding who may receive a teaching.
 *
 * rules[] hold a rule type (from the registry) and its params. The evaluator does
 * NOT know these types — it looks each up in the registry. That is what lets
 * later sprints add payment_state and assessment_score without touching the
 * evaluator (ADR-008).
 *
 * denialMessage is the institution's own words, locale-mapped. It is what the
 * learner reads when the door is held. It must never be an error string.
 */
const RuleSchema = new Schema(
  {
    type: { type: String, required: true }, // 'enrolled', 'attestation', ...
    params: Schema.Types.Mixed,
  },
  { _id: false }
);

const EligibilityPolicySchema = new Schema(
  {
    slug: { type: String, required: true, trim: true, lowercase: true },
    label: { ...LocaleMapType, required: true },

    combinator: { type: String, enum: ['all', 'any'], default: 'all' },
    rules: { type: [RuleSchema], default: [] },

    denialMessage: { ...LocaleMapType, required: true },
  },
  { timestamps: true }
);

EligibilityPolicySchema.plugin(tenantGuard);
EligibilityPolicySchema.plugin(localeMap, { paths: ['label', 'denialMessage'] });

EligibilityPolicySchema.index({ tenantId: 1, slug: 1 }, { unique: true });

module.exports = mongoose.model('EligibilityPolicy', EligibilityPolicySchema);
