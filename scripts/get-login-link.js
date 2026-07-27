'use strict';

/**
 * Re-issue a set-password link (and a temporary password) for an existing user,
 * and PRINT them to the terminal. Use when email is on the dev transport and you
 * need to actually sign in as an owner/learner you created.
 *
 *   node scripts/get-login-link.js <email>
 *
 * This issues a FRESH single-use link and temp password (the old ones, if any,
 * still work until they expire — but this is the simplest way to get a usable one).
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { mongoUri } = require('../src/config/env');
const { runAsPlatform, runWithTenant } = require('../src/lib/context');
const { User, Membership } = require('../src/models');
const { issueOnboarding } = require('../src/services/onboarding.service');

async function main() {
  const email = (process.argv[2] || '').toLowerCase().trim();
  if (!email) {
    console.error('Usage: node scripts/get-login-link.js <email>');
    process.exit(1);
  }
  await mongoose.connect(mongoUri);

  const user = await runAsPlatform('get-login-link', () => User.findOne({ email }).exec());
  if (!user) {
    console.error(`No user with email ${email}.`);
    process.exit(2);
  }

  // Find a tenant this user belongs to, so the link points at the right subdomain.
  const membership = await runAsPlatform('get-login-link membership', () =>
    Membership.findOne({ userId: user._id }).exec());
  const tenantId = membership ? membership.tenantId : undefined;

  const issue = () => issueOnboarding({ userId: user._id, tenantId, withTempPassword: true });
  const { link, tempPassword, expiresInHours } = tenantId
    ? await runWithTenant(tenantId, user._id, issue)
    : await runAsPlatform('get-login-link issue', issue);

  console.log('\n=== Sign-in details for', email, '===');
  console.log('  Set-password link (primary, expires in ' + expiresInHours + 'h):');
  console.log('    ' + link);
  console.log('  Temporary password (fallback — change on first login):');
  console.log('    ' + tempPassword);
  console.log('\nOpen the link, or sign in with the temp password at the institution\'s login.\n');

  await mongoose.disconnect();
}

main().catch((err) => { console.error('\nFAILED:', err.message); console.error(err.stack); process.exit(1); });
