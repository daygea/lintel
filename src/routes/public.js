'use strict';

const express = require('express');
const webCredential = require('../controllers/web/credential.controller');
const cred = require('../services/credential.service');
const { rootDomain } = require('../config/env');

/** The marketing apex: bare root domain, www, or localhost in dev. */
function isApex(host) {
  const bare = String(host || '').split(':')[0].toLowerCase();
  return bare === rootDomain || bare === `www.${rootDomain}` || bare === 'localhost';
}
const webDirectory = require('../controllers/web/directory.controller');
const webSignup = require('../controllers/web/signup.controller');

/**
 * Routes that run WITHOUT tenant resolution. A credential is verified by its
 * globally-unique code, by a stranger, from any host. The verification service
 * runs as platform and reveals only the award — never marks, standings, or
 * transcript.
 */
const router = express.Router();

// Human-facing verification page (QR points here).
router.get('/verify/:code', webCredential.verify);

// JSON verification, for programmatic checks (e.g. an employer's system).
router.get('/api/v1/verify/:code', async (req, res, next) => {
  try {
    res.json(await cred.verifyPublic(req.params.code));
  } catch (err) {
    next(err);
  }
});

// Public institution directory — no tenant context; resolved by handle.
router.get('/directory', webDirectory.index);
router.get('/directory/:handle', webDirectory.page);

// The apex home page. Only on the marketing host — on a tenant subdomain, `/`
// falls through to the tenant dashboard instead.
router.get('/', (req, res, next) => {
  if (!isApex(req.headers.host)) return next();
  res.render('home');
});

// A bare credential-verify landing, so someone with a serial but no QR can find
// the entry point. The code-specific page is /verify/:code.
router.get('/verify', (req, res) => res.render('credential/verify-landing'));

/* ---- Institution signup (apex) ---- */
router.get('/signup', (req, res, next) => { if (!isApex(req.headers.host)) return next(); webSignup.form(req, res, next); });
router.get('/signup/check', webSignup.check);
router.post('/signup', webSignup.submit);

/* ---- Onboarding: set password from emailed link (works on any host) ---- */
router.get('/onboard/:token', webSignup.onboardForm);
router.post('/onboard/:token', webSignup.onboardSubmit);

module.exports = router;
