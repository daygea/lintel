'use strict';

/**
 * Provision an institution directly (bypassing the web signup), and PRINT the
 * owner's set-password link and temporary password to the console — useful while
 * email is still on the dev/log transport.
 *
 *   node scripts/provision-institution.js "Institution Name" <slug> <owner-email> "Owner Name"
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { mongoUri } = require('../src/config/env');
const { runAsPlatform } = require('../src/lib/context');
const signup = require('../src/services/signup.service');

async function main() {
  const [name, slug, email, ownerName] = process.argv.slice(2);
  if (!name || !slug || !email || !ownerName) {
    console.error('Usage: node scripts/provision-institution.js "Name" <slug> <owner-email> "Owner Name"');
    process.exit(1);
  }
  await mongoose.connect(mongoUri);

  // Force the auto-provision path regardless of env, so we get a live tenant now.
  process.env.AUTO_PROVISION_TENANTS = 'true';

  const result = await signup.apply({
    institutionName: name, requestedSlug: slug,
    contactName: ownerName, contactEmail: email,
  });

  console.log('\n=== Institution provisioned ===');
  console.log('  Name:  ', name);
  console.log('  Slug:  ', slug, `(sign in at ${slug}.${process.env.ROOT_DOMAIN})`);
  console.log('  Owner: ', email);
  console.log('\nThe account-details email was written to the LOG (email is on the dev transport).');
  console.log('Look in the server output for the set-password link and temporary password,');
  console.log('or check the notifications the owner would have received.\n');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('\nFAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
