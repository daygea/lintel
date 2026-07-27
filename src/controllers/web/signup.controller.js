'use strict';

const signup = require('../../services/signup.service');
const onboarding = require('../../services/onboarding.service');
const auth = require('../../services/auth.service');
const { rootDomain } = require('../../config/env');
const { ValidationError } = require('../../lib/errors');

const h = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

/* ---- Institution signup (apex) ---- */
exports.form = h(async (req, res) => res.render('signup/institution', { rootDomain, error: null, values: {} }));

exports.check = h(async (req, res) => {
  try {
    const available = await signup.slugAvailable(req.query.slug);
    res.json({ available });
  } catch (err) {
    res.json({ available: false, reason: err.message });
  }
});

exports.submit = h(async (req, res) => {
  try {
    const result = await signup.apply({
      institutionName: req.body.institutionName,
      requestedSlug: req.body.slug,
      contactName: req.body.contactName,
      contactEmail: req.body.contactEmail,
      country: req.body.country,
      about: req.body.about,
    });
    res.render('signup/received', { instant: result.instant, slug: req.body.slug, rootDomain, email: req.body.contactEmail });
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(400).render('signup/institution', { rootDomain, error: err.message, values: req.body });
    }
    throw err; // a real bug — let the error handler log the stack, don't mask it as a 400
  }
});

/* ---- Onboarding: set password from the emailed link ---- */
exports.onboardForm = h(async (req, res) => res.render('signup/set-password', { token: req.params.token, error: null }));

exports.onboardSubmit = h(async (req, res) => {
  try {
    const { user, tenantId } = await onboarding.consumeOnboarding({ rawToken: req.params.token, newPassword: req.body.password });
    // Log them in and send to their institution (or apex).
    req.session.userId = String(user._id);
    req.session.epoch = user.sessionEpoch || 0;
    res.render('signup/onboarded', { name: user.name });
  } catch (err) {
    res.status(400).render('signup/set-password', { token: req.params.token, error: err.message });
  }
});

/* ---- Learner self-registration (tenant page) ---- */
exports.registerForm = h(async (req, res) => res.render('signup/learner', { tenant: req.tenant, error: null, values: {} }));

exports.registerSubmit = h(async (req, res) => {
  try {
    await auth.selfRegister({ email: req.body.email, name: req.body.name });
    res.render('signup/learner-received', { tenant: req.tenant });
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(400).render('signup/learner', { tenant: req.tenant, error: err.message, values: req.body });
    }
    throw err;
  }
});
