'use strict';

const mongoose = require('mongoose');
const { start } = require('../lib/queue');
const { transcode } = require('./transcode');
const { mongoUri } = require('../config/env');
const logger = require('../lib/logger');

/**
 * Run as a separate process: `npm run worker`.
 *
 * It must be separate. Transcoding a 90-minute lecture saturates a CPU for
 * minutes, and a web process busy encoding video is a web process not answering
 * learners.
 */
const HANDLERS = {
  'media.transcode': transcode,
};

async function main() {
  await mongoose.connect(mongoUri);
  logger.info({ handlers: Object.keys(HANDLERS) }, 'worker started');

  const stop = start(HANDLERS);
  let shuttingDown = false;

  /**
   * Ctrl-C during a transcode should not wedge the job for ten minutes waiting
   * to be declared dead. Give the job a moment to finish; if it cannot, hand it
   * back to the queue so the next worker picks it straight up.
   *
   * A second Ctrl-C means the operator is not asking any more, and we exit.
   */
  async function shutdown(signal) {
    if (shuttingDown) {
      logger.warn('second signal — exiting immediately, job left to the stale-lock reclaim');
      process.exit(1);
    }
    shuttingDown = true;
    logger.info({ signal }, 'worker stopping');

    await stop();
    await mongoose.disconnect();
    logger.info('worker stopped cleanly');
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
