'use strict';

/**
 * One-off: provision an OISS-shaped tenant and its head-of-institute account, so
 * that seed/oiss-config.js has something to configure.
 *
 * In normal operation a tenant is provisioned through the signup flow. This is
 * the manual equivalent for a first / rehearsal tenant, before that flow exists.
 *
 *   node seed/provision-oiss.js              → slug "test-oiss" (default, for rehearsal)
 *   node seed/provision-oiss.js oiss         → the real slug, when OISS is ready
 *
 * Idempotent: re-running reuses the existing tenant and owner.
 */

const mongoose = require('mongoose');
const { Tenant, User } = require('../src/models');
const { provision } = require('../src/services/tenant.service');
const { mongoUri } = require('../src/config/env');

const slug = process.argv[2] || 'test-oiss';
const OWNER_EMAIL = `head@${slug}.test`;
const OWNER_PASSWORD = 'change-this-after-first-login';

async function main() {
  await mongoose.connect(mongoUri);

  let owner = await User.findOne({ email: OWNER_EMAIL }).exec();
  if (!owner) {
    owner = await User.create({
      email: OWNER_EMAIL,
      name: 'Head of Institute',
      passwordHash: await User.hashPassword(OWNER_PASSWORD),
      status: 'active',
    });
    console.log(`Created owner: ${OWNER_EMAIL}`);
  } else {
    console.log(`Owner already exists: ${OWNER_EMAIL}`);
  }

  let tenant = await Tenant.findOne({ slug }).exec();
  if (!tenant) {
    tenant = await provision({
      slug,
      name:
        slug === 'oiss'
          ? 'Obatala Institute of Sacred Studies'
          : 'Obatala Institute of Sacred Studies (rehearsal)',
      ownerUserId: owner._id,
      plan: 'institute',
      baseCurrency: 'NGN',
      locales: ['en', 'yo'],
    });
    console.log(`Provisioned tenant: ${tenant.name} (${slug})`);
  } else {
    console.log(`Tenant "${slug}" already exists.`);
  }

  console.log('\nNext:');
  console.log(`  node seed/oiss-config.js ${slug}`);
  console.log(`\nSign in at http://${slug}.localhost:3001`);
  console.log(`  ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
  console.log('  (change the password after first login)\n');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
