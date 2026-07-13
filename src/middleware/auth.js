'use strict';

const { User, Membership } = require('../models');
const { NotAuthenticatedError, NotAuthorisedError } = require('../lib/errors');
const { has } = require('../lib/roles');

/** Loads the signed-in user and their membership OF THIS TENANT. */
async function loadSession(req, res, next) {
  if (!req.session?.userId) return next();
  try {
    const user = await User.findById(req.session.userId).exec();
    if (!user || user.status === 'suspended') {
      req.session.destroy(() => {});
      return next();
    }
    const membership = await Membership.findOne({ userId: user._id, status: 'active' }).exec();
    req.user = user;
    req.membership = membership;
    res.locals.user = user;
    res.locals.membership = membership;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Two transports, two right answers.
 *
 * A browser that is not signed in should be shown the door to the sign-in form,
 * not a 401 error page. An API client should be told 401 and nothing else — it
 * cannot follow a redirect to an HTML form and should not try.
 */
const wantsJson = (req) =>
  req.path.startsWith('/api/') ||
  req.xhr ||
  (req.get('accept') || '').includes('application/json');

function requireUser(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) return next(new NotAuthenticatedError());

  // Remember where they were headed, so sign-in returns them to it.
  req.session.returnTo = req.originalUrl;
  return res.redirect('/login');
}

function requireMember(req, res, next) {
  if (req.membership) return next();
  return next(new NotAuthorisedError('You are not a member of this institution'));
}

const requireRole =
  (...roles) =>
  (req, _res, next) =>
    has(req.membership, ...roles)
      ? next()
      : next(new NotAuthorisedError('You do not have permission to do that'));

module.exports = { loadSession, requireUser, requireMember, requireRole };
