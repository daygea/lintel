'use strict';

const { FEATURES } = require('./features');
const F = (...keys) => keys.map((k) => FEATURES[k].key);

/**
 * Plans grant features.
 *
 * A tenant that charges its learners nothing still pays for the platform —
 * unless it is on the grant plan, which exists because a state-funded midwifery
 * school genuinely cannot. Price to the learner and price to us are unrelated.
 */
// price is what the INSTITUTION pays Lintel, per cycle, in minor units of the
// currency (kobo for NGN). This is data only — the pricing page and the billing
// step (roadmap #3) read it; nothing charges yet. price 0 = free plan.
const PLANS = {
  trial: {
    label: 'Trial',
    features: F('CURRICULUM', 'MEDIA', 'ENROLMENT'),
    seats: 25,
    price: { amount: 0, currency: 'NGN' },
    cycle: 'monthly',
    trialDays: 14,
    platformFeeBps: 500, // 5% of learner payments (highest cut nudges an upgrade)
  },
  institute: {
    label: 'Institute',
    features: F('CURRICULUM','MEDIA','ENROLMENT','NOTIFICATIONS','ELIGIBILITY','OFFLINE','ASSESSMENT','GRADEBOOK','COMMERCE','CREDENTIALS','DIRECTORY'),
    seats: 500,
    price: { amount: 5000000, currency: 'NGN' }, // ₦50,000 / month
    cycle: 'monthly',
    platformFeeBps: 200, // 2%
  },
  grant: {
    label: 'Grant / nonprofit',
    features: F('CURRICULUM','MEDIA','ENROLMENT','NOTIFICATIONS','ELIGIBILITY','OFFLINE','ASSESSMENT','GRADEBOOK','CREDENTIALS','DIRECTORY'),
    seats: 5000,
    price: { amount: 0, currency: 'NGN' }, // free for approved nonprofits
    cycle: 'monthly',
    platformFeeBps: 0,
  },
  university: {
    label: 'University',
    features: Object.values(FEATURES).map((f) => f.key),
    seats: 20000,
    price: { amount: 25000000, currency: 'NGN' }, // ₦250,000 / month
    cycle: 'monthly',
    platformFeeBps: 0, // no cut on the top plan
  },
};

module.exports = { PLANS, PLAN_KEYS: Object.keys(PLANS) };
