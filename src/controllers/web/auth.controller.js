'use strict';

const auth = require('../../services/auth.service');

/** Thin. No logic. If you are tempted to add an `if` here, it belongs in the service. */
exports.showLogin = (req, res) => res.render('auth/login', { error: null });

exports.login = async (req, res, next) => {
  try {
    const user = await auth.authenticate(req.body);
    req.session.userId = user._id.toString();
    res.redirect('/');
  } catch (err) {
    if (err.status === 401 || err.status === 422) {
      return res.status(err.status).render('auth/login', { error: err.message });
    }
    return next(err);
  }
};

exports.logout = (req, res) => req.session.destroy(() => res.redirect('/login'));
