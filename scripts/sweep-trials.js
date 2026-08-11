'use strict';

/**
 * Warn and suspend lapsed trials. Run daily — e.g. a Render Cron Job:
 *   node scripts/sweep-trials.js
 * Needs the same env as the web service (MONGODB_URI etc.).
 */

const mongoose = require('mongoose');
const env = require('../src/config/env');
const { sweepTrials, sweepSubscriptions } = require('../src/services/billing.service');

(async () => {
  await mongoose.connect(env.mongoUri);
  try {
    const trials = await sweepTrials();
    const subs = await sweepSubscriptions();
    console.log(`sweep: trials warned ${trials.warned}/suspended ${trials.suspended}; subscriptions suspended ${subs.suspended}`);
  } finally {
    await mongoose.disconnect();
  }
})().catch((err) => {
  console.error('sweep failed:', err);
  process.exit(1);
});
