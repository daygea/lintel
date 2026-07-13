'use strict';

/**
 * SYNTHETIC DATA ONLY.
 *
 * Invariant 10: no real restricted material enters any environment before Sprint 3
 * ships. Not for testing. Not for a demo. An elder's recording sitting in a
 * database with no access log and no policy engine is exactly the harm this
 * architecture exists to prevent.
 *
 * Every person named below is invented.
 *
 * This script DESTROYS data. It refuses to run unless the target database is
 * unmistakably a development one. If you are reading this because it refused,
 * that is the guard doing its job — do not weaken it, point it somewhere else.
 */

const mongoose = require('mongoose');
const { Tenant, User, Membership, AuditLog } = require('../src/models');
const { provision } = require('../src/services/tenant.service');
const { runWithTenant } = require('../src/lib/context');
const { mongoUri, env, rootDomain, port } = require('../src/config/env');
const { ROLES } = require('../src/lib/roles');


const SAFE_DB_NAMES = ['lintel-dev', 'lintel-test', 'lintel-local', 'lintel'];

function assertSafeToDestroy(uri) {
  if (env === 'production') {
    throw new Error('Refusing to seed: NODE_ENV is production.');
  }

  let dbName;
  try {
    dbName = new URL(uri.replace('mongodb+srv://', 'https://')).pathname.replace('/', '');
  } catch {
    throw new Error('Could not parse MONGODB_URI.');
  }

  if (!dbName) {
    throw new Error(
      'MONGODB_URI has no database name. Add one before the "?" — e.g. .../lintel-dev?retryWrites=true\n' +
        'Without it you are silently connected to a database called "test".'
    );
  }

  const isLocal = /127\.0\.0\.1|localhost/.test(uri);
  if (!isLocal && !SAFE_DB_NAMES.includes(dbName)) {
    throw new Error(
      `Refusing to seed a remote database named "${dbName}".\n\n` +
        'This script deletes every tenant, user and membership. On a shared cluster that\n' +
        'wipes every institution on the platform.\n\n' +
        `Point MONGODB_URI at localhost, or name the database one of: ${SAFE_DB_NAMES.join(', ')}`
    );
  }

  return dbName;
}

async function main() {
  const dbName = assertSafeToDestroy(mongoUri);
  console.log(`Seeding "${dbName}" — this deletes all tenants, users and memberships.\n`);

  await mongoose.connect(mongoUri);
  await Promise.all([
    Tenant.deleteMany({}),
    User.deleteMany({}),
    mongoose.connection.collection('memberships').deleteMany({}),
    mongoose.connection.collection('auditlogs').deleteMany({}),
  ]);

  const owner = await User.create({
    email: 'owner@example.test',
    name: 'Founder Account',
    passwordHash: await User.hashPassword('correct-horse-battery-staple'),
    status: 'active',
  });

  // Two tenants, so the isolation boundary is real from the first commit.
  const alpha = await provision({
    slug: 'alpha',
    name: 'Alpha Institute of Synthetic Studies',
    ownerUserId: owner._id,
    plan: 'institute',
  });

  const beta = await provision({
    slug: 'beta',
    name: 'Beta School of Nothing In Particular',
    ownerUserId: owner._id,
    plan: 'grant',
  });

  for (const [tenant, names] of [
    [alpha, ['Ada Placeholder', 'Ben Fictional', 'Cara Invented']],
    [beta, ['Dele Notreal', 'Efe Madeup']],
  ]) {
    await runWithTenant(tenant._id, owner._id, async () => {
      for (const name of names) {
        const u = await User.create({
          email: `${name.split(' ')[0].toLowerCase()}@${tenant.slug}.test`,
          name,
          passwordHash: await User.hashPassword('correct-horse-battery-staple'),
          status: 'active',
        });
        await Membership.create({ userId: u._id, roles: [ROLES.LEARNER], status: 'active' });
      }
    });
  }

  console.log('Seeded two synthetic tenants.\n');
  console.log(`  http://alpha.${rootDomain}:${port}`);
  console.log(`  http://beta.${rootDomain}:${port}`);
  console.log('  owner@example.test / correct-horse-battery-staple');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
