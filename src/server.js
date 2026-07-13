'use strict';

const mongoose = require('mongoose');
const { createApp } = require('./app');
const { mongoUri, port } = require('./config/env');
const logger = require('./lib/logger');

async function main() {
  await mongoose.connect(mongoUri);
  logger.info('connected to mongodb');

  createApp().listen(port, () => logger.info(`lintel listening on :${port}`));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
