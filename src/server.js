'use strict';

const mongoose = require('mongoose');
const { createApp } = require('./app');
const { mongoUri, port } = require('./config/env');
const logger = require('./lib/logger');

async function main() {
  await mongoose.connect(mongoUri);
  logger.info('connected to mongodb');

  await ensureBootstrapSuperadmin();

  createApp().listen(port, () => logger.info(`lintel listening on :${port}`));
}

/**
 * Env fallback for bootstrapping the first operator: if SUPERADMIN_EMAIL is set
 * and that user exists without the role, promote them on boot. The CLI script is
 * the primary path; this is the backup so a fresh deploy is never locked out.
 */
async function ensureBootstrapSuperadmin() {
  const email = (process.env.SUPERADMIN_EMAIL || '').toLowerCase().trim();
  if (!email) return;
  const { User } = require('./models');
  const user = await User.findOne({ email }).exec();
  if (user && user.platformRole !== 'superadmin') {
    await User.updateOne({ _id: user._id }, { platformRole: 'superadmin' }).exec();
    logger.info({ email }, 'bootstrapped superadmin from SUPERADMIN_EMAIL');
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
