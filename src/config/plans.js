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
const PLANS = {
  trial: { label: 'Trial', features: F('CURRICULUM', 'MEDIA', 'ENROLMENT'), seats: 25 },
  institute: {
    label: 'Institute',
    features: F('CURRICULUM','MEDIA','ENROLMENT','NOTIFICATIONS','ELIGIBILITY','OFFLINE','ASSESSMENT','GRADEBOOK','COMMERCE','CREDENTIALS','DIRECTORY'),
    seats: 500,
  },
  grant: {
    label: 'Grant / nonprofit',
    features: F('CURRICULUM','MEDIA','ENROLMENT','NOTIFICATIONS','ELIGIBILITY','OFFLINE','ASSESSMENT','GRADEBOOK','CREDENTIALS','DIRECTORY'),
    seats: 5000,
  },
  university: {
    label: 'University',
    features: Object.values(FEATURES).map((f) => f.key),
    seats: 20000,
  },
};

module.exports = { PLANS, PLAN_KEYS: Object.keys(PLANS) };
