'use strict';

const auth = require('../../services/auth.service');
const { Membership } = require('../../models');
const { has, STAFF } = require('../../lib/roles');

/** Thin. No logic. If you are tempted to add an `if` here, it belongs in the service. */
exports.showLogin = (req, res) => {
  if (req.user) return res.redirect('/');
  return res.render('auth/login', { error: null });
};

exports.login = async (req, res, next) => {
  try {
    const user = await auth.authenticate(req.body);
    req.session.userId = user._id.toString();
    req.session.epoch = user.sessionEpoch || 0;

    const returnTo = req.session.returnTo;
    delete req.session.returnTo;

    // Route by standing. A pending self-registrant can't reach any tenant surface
    // yet — send them to the awaiting-admission page, not the staff dashboard
    // (which would 403). A pure learner belongs in the learner app, not the admin
    // shell. Staff keep today's behaviour, honouring returnTo.
    const membership = await Membership.findOne({ userId: user._id }).sort({ createdAt: -1 }).exec();
    const active = membership && membership.status === 'active';
    let destination;
    if (!active) {
      destination = '/pending';
    } else if (has(membership, ...STAFF)) {
      destination = returnTo || '/';
    } else {
      destination = '/app/'; // active learner
    }
    return res.redirect(destination);
  } catch (err) {
    if (err.status === 401 || err.status === 422) {
      return res.status(err.status).render('auth/login', { error: err.message });
    }
    return next(err);
  }
};

/** Awaiting-admission landing for a signed-in but not-yet-active member. */
exports.pending = (req, res) => {
  // If they've since been admitted, don't strand them here.
  if (req.membership) return res.redirect(has(req.membership, ...STAFF) ? '/' : '/app/');
  return res.render('auth/pending', {});
};

exports.logout = (req, res) => req.session.destroy(() => res.redirect('/login'));
