'use strict';

const crypto = require('node:crypto');

/** Double-submit CSRF. Applies to every non-idempotent request. */
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrf(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (SAFE.has(req.method)) return next();

  const sent = req.body?._csrf || req.headers['x-csrf-token'];
  const expected = req.session.csrfToken;

  const ok =
    typeof sent === 'string' &&
    sent.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));

  if (!ok) {
    res.status(403);
    return next(new Error('That form has expired. Reload the page and try again.'));
  }
  return next();
}

module.exports = csrf;
