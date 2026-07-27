'use strict';

/**
 * Grant platform superadmin, by email. The PRIMARY bootstrapping path.
 *
 *   node scripts/grant-superadmin.js <email>                     # grant to an existing user
 *   node scripts/grant-superadmin.js <email> --create "Full Name" [password]
 *
 * With --create, if no user has that email one is created, so a FRESH system can
 * mint its first operator with no prior account. If no password is given, a random
 * one is set and printed once, and the account is flagged to change it on first
 * login. An env fallback (SUPERADMIN_EMAIL) also auto-promotes on boot.
 */

require('dotenv').config();
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { mongoUri } = require('../src/config/env');
const { User } = require('../src/models');

function parseArgs(argv) {
  const email = (argv[0] || '').toLowerCase().trim();
  const create = argv.includes('--create');
  const rest = argv.slice(1).filter((a) => a !== '--create');
  const name = rest[0];
  const password = rest[1];
  return { email, create, name, password };
}

async function main() {
  const { email, create, name, password } = parseArgs(process.argv.slice(2));
  if (!email) {
    console.error('Usage: node scripts/grant-superadmin.js <email> [--create "Full Name" [password]]');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);

  let user = await User.findOne({ email }).exec();

  if (!user) {
    if (!create) {
      console.error(`No user with email ${email}.`);
      console.error(`To create one now, re-run with:  --create "Full Name" [password]`);
      process.exit(2);
    }
    if (!name) {
      console.error('--create requires a name:  --create "Full Name" [password]');
      process.exit(1);
    }
    const pw = password || crypto.randomBytes(6).toString('base64url');
    user = await User.create({
      email,
      name,
      passwordHash: await User.hashPassword(pw),
      status: 'active',
      mustChangePassword: !password, // if we generated it, force a change
      platformRole: 'superadmin',
    });
    console.log(`Created ${email} and granted superadmin.`);
    if (!password) {
      console.log(`Temporary password: ${pw}`);
      console.log('Change it on first sign-in.');
    }
    await mongoose.disconnect();
    return;
  }

  if (user.platformRole === 'superadmin') {
    console.log(`${email} is already a superadmin.`);
  } else {
    await User.updateOne({ _id: user._id }, { platformRole: 'superadmin' }).exec();
    console.log(`Granted superadmin to ${email}.`);
  }
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
