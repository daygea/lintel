'use strict';

const auth = require('../../services/auth.service');

exports.show = (req, res) => {
  res.render('security/index', {
    mfaEnabled: !!(req.user.mfa && req.user.mfa.enabled),
    done: req.query.done || null,
    err: req.query.err || null,
  });
};

exports.beginMfa = async (req, res, next) => {
  try {
    const { secret, uri } = await auth.beginMfaSetup(req.user);
    res.render('security/mfa-setup', { secret, uri, error: null });
  } catch (err) {
    next(err);
  }
};

exports.confirmMfa = async (req, res, next) => {
  try {
    await auth.confirmMfa(req.user, req.body.token);
    res.redirect('/security?done=on');
  } catch (err) {
    if (err.status === 422 || err.name === 'ValidationError') {
      // Re-render with the same secret (carried in hidden fields) so the user can
      // retry without a fresh secret. Verification still uses the stored secret.
      return res.status(422).render('security/mfa-setup', {
        secret: req.body.secret, uri: req.body.uri, error: err.message,
      });
    }
    next(err);
  }
};

exports.disableMfa = async (req, res, next) => {
  try {
    await auth.disableMfa(req.user);
    res.redirect('/security?done=off');
  } catch (err) {
    next(err);
  }
};
