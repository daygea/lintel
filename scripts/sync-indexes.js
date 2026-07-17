'use strict';

/**
 * Build (and prune) every model's indexes to match the code.
 *
 * Mongoose only creates indexes it doesn't already know about, and it will NOT
 * retrofit a unique constraint onto a collection that predates the declaration.
 * So an index you add to a schema after first seeding silently never exists —
 * and a business rule that leans on it silently stops being enforced.
 *
 * Run this after adding or changing any index:  npm run indexes
 *
 * syncIndexes() also DROPS indexes no longer in the schema, so it is the honest
 * "make the database match the code" button. Safe in dev; in production run it
 * in a maintenance window, because building a large unique index takes time and
 * will fail loudly if existing data already violates it (which is information you
 * want, not an error to route around).
 */

const mongoose = require('mongoose');
const models = require('../src/models');
const { mongoUri } = require('../src/config/env');

async function main() {
  await mongoose.connect(mongoUri);
  console.log(`Syncing indexes on ${mongoose.connection.name}\n`);

  for (const [name, Model] of Object.entries(models)) {
    if (typeof Model.syncIndexes !== 'function') continue;
    const dropped = await Model.syncIndexes();
    const after = await Model.listIndexes();
    console.log(`  ${name.padEnd(16)} ${after.length} index(es)${dropped.length ? `  (dropped ${dropped.length})` : ''}`);
  }

  console.log('\nDone.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
