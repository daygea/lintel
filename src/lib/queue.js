'use strict';

const crypto = require('node:crypto');
const { Job } = require('../models');
const { runWithTenant, runAsPlatform } = require('./context');
const logger = require('./logger');

const WORKER_ID = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

/** How long before another worker may assume this one has died. */
const STALE_LOCK_MS = 10 * 60 * 1000;

/** Enqueue inside a tenant context. The job remembers which institution it belongs to. */
const enqueue = (type, payload, { runAfter } = {}) =>
  Job.create({ type, payload, runAfter: runAfter || new Date() });

/**
 * Claim one job atomically.
 *
 * Runs as platform, because a worker polls across all tenants — but the handler
 * is then re-entered INSIDE the job's own tenant context, so every query it makes
 * is scoped exactly as it would be in a request. A worker that forgot to do this
 * would be the easiest way in the entire system to leak data across institutions.
 */
async function claim(types) {
  const now = new Date();
  const stale = new Date(now.getTime() - STALE_LOCK_MS);

  return runAsPlatform('worker claiming a job across tenants', () =>
    Job.findOneAndUpdate(
      {
        type: { $in: types },
        $or: [
          { status: 'queued', runAfter: { $lte: now } },
          { status: 'running', lockedAt: { $lt: stale } }, // a dead worker's job
        ],
      },
      { status: 'running', lockedAt: now, lockedBy: WORKER_ID, $inc: { attempts: 1 } },
      { new: true, sort: { runAfter: 1 } }
    ).exec()
  );
}

/**
 * Hand a job back.
 *
 * A worker that is shutting down deliberately should not leave its work locked
 * for ten minutes waiting to be declared dead. It knows it is going; it should
 * say so. The attempt is refunded, because being interrupted is not a failure.
 */
async function release(job, reason = 'worker shutting down') {
  if (!job) return;
  await runWithTenant(job.tenantId, null, () =>
    Job.updateOne(
      { _id: job._id, lockedBy: WORKER_ID },
      {
        status: 'queued',
        runAfter: new Date(),
        lockedAt: undefined,
        lockedBy: undefined,
        $inc: { attempts: -1 },
      }
    ).exec()
  );
  logger.info({ jobId: String(job._id), type: job.type, reason }, 'job released');
}

async function run(job, handlers) {
  const handler = handlers[job.type];
  if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);

  try {
    await runWithTenant(job.tenantId, null, async () => {
      await handler(job.payload, job);
      await Job.updateOne(
        { _id: job._id },
        { status: 'done', finishedAt: new Date(), error: undefined }
      ).exec();
    });
    logger.info({ jobId: String(job._id), type: job.type }, 'job done');
  } catch (err) {
    const giveUp = job.attempts >= job.maxAttempts;
    await runWithTenant(job.tenantId, null, () =>
      Job.updateOne(
        { _id: job._id },
        giveUp
          ? { status: 'failed', error: err.message, finishedAt: new Date() }
          : {
              status: 'queued',
              error: err.message,
              runAfter: new Date(Date.now() + 2 ** job.attempts * 5000), // backoff
            }
      ).exec()
    );
    logger.error(
      { jobId: String(job._id), type: job.type, attempt: job.attempts, err: err.message, giveUp },
      'job failed'
    );
  }
}

/**
 * Poll loop. Simple on purpose.
 *
 * Returns a stop function. Await it: it lets the current job finish if it can,
 * and hands it back if it cannot.
 */
function start(handlers, { intervalMs = 2000, drainMs = 15000 } = {}) {
  const types = Object.keys(handlers);
  let stopped = false;
  let current = null;
  let finished = null;

  const loop = (async () => {
    while (!stopped) {
      try {
        const job = await claim(types);
        if (job) {
          current = job;
          finished = run(job, handlers);
          await finished;
          current = null;
          finished = null;
          continue; // drain eagerly while there is work
        }
      } catch (err) {
        logger.error({ err: err.message }, 'queue loop error');
        current = null;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();

  return async function stop() {
    stopped = true;
    if (!current) return loop.catch(() => {});

    logger.info({ jobId: String(current._id) }, 'finishing current job before exit');

    const raced = await Promise.race([
      finished.then(() => 'done').catch(() => 'done'),
      new Promise((r) => setTimeout(() => r('timeout'), drainMs)),
    ]);

    if (raced === 'timeout') await release(current, 'shutdown timed out mid-job');
    return loop.catch(() => {});
  };
}

module.exports = { enqueue, claim, run, release, start, WORKER_ID, STALE_LOCK_MS };
