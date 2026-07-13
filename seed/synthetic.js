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
 */

const mongoose = require('mongoose');
const { Tenant, User, Membership } = require('../src/models');
const { provision } = require('../src/services/tenant.service');
const { runWithTenant } = require('../src/lib/context');
const { mongoUri } = require('../src/config/env');
const { ROLES } = require('../src/lib/roles');

async function main() {
  await mongoose.connect(mongoUri);
  await Promise.all([Tenant.deleteMany({}), User.deleteMany({}), Membership.deleteMany({})]);

  const owner = await User.create({
    email: 'owner@example.test',
    name: 'Founder Account',
    passwordHash: await User.hashPassword('correct-horse-battery-staple'),
    status: 'active',
  });

  // Two tenants, so the isolation boundary is real from day one.
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
    baseCurrency: 'NGN',
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

  console.log('Seeded two synthetic tenants.');
  console.log('  http://alpha.lintel.test:3000   owner@example.test');
  console.log('  http://beta.lintel.test:3000    owner@example.test');
  console.log('  password: correct-horse-battery-staple');
  console.log('\nAdd to /etc/hosts:  127.0.0.1  alpha.lintel.test beta.lintel.test');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
