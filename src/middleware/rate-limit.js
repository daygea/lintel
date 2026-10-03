'use strict';

const { RateHit } = require('../models');
const logger = require('../lib/logger');

/**
 * Fixed-window rate limiter, backed by Mongo so the limit holds across multiple
 * app instances (Render can run more than one). Each window is its own counter doc,
 * dropped by a TTL index — no cron, no in-memory state to lose on restart.
 *
 * Fails OPEN: if the limiter store errors, a login should still be possible. A
 * limiter outage must not lock every user out. The event is logged.
 */
function rateLimit({ windowMs, max, keyFn, message } = {}) {
  const limit = max || 20;
  const win = windowMs || 10 * 60 * 1000;
  return async function rateLimiter(req, res, next) {
    try {
      const base = keyFn ? keyFn(req) : req.ip;
      const windowStart = Math.floor(Date.now() / win) * win;
      const key = `${req.method}:${req.path}:${base}:${windowStart}`;
      const doc = await RateHit.findOneAndUpdate(
        { key },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(windowStart + win) } },
        { upsert: true, new: true }
      ).exec();
      if (doc.count > limit) {
        res.set('Retry-After', String(Math.ceil((windowStart + win - Date.now()) / 1000)));
        const err = new Error(message || 'Too many attempts. Please wait a few minutes and try again.');
        err.status = 429;
        err.expose = true;
        return next(err);
      }
      return next();
    } catch (e) {
      logger.warn({ err: e.message, path: req.path }, 'rate limiter error — failing open');
      return next();
    }
  };
}

// Keyed by IP + the email being tried, so one IP probing many accounts and many
// IPs probing one account are both constrained, without locking out a shared NAT
// for an unrelated user's typo.
const byIpAndEmail = (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase()}`;

module.exports = { rateLimit, byIpAndEmail };
