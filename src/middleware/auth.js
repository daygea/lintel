'use strict';

const { User, Membership } = require('../models');
const { NotAuthenticatedError, NotAuthorisedError } = require('../lib/errors');
const { has } = require('../lib/roles');

/** Loads the signed-in user and their membership OF THIS TENANT. */
async function loadSession(req, res, next) {
  if (!req.session?.userId) return next();
  try {
    const user = await User.findById(req.session.userId);
    if (!user || user.status === 'suspended') {
      req.session.destroy(() => {});
      return next();
    }
    const membership = await Membership.findOne({ userId: user._id, status: 'active' });
    req.user = user;
    req.membership = membership;
    res.locals.user = user;
    res.locals.membership = membership;
    return next();
  } catch (err) {
    return next(err);
  }
}

const requireUser = (req, _res, next) =>
  req.user ? next() : next(new NotAuthenticatedError());

const requireMember = (req, _res, next) =>
  req.membership ? next() : next(new NotAuthorisedError('You are not a member of this institution'));

const requireRole =
  (...roles) =>
  (req, _res, next) =>
    has(req.membership, ...roles)
      ? next()
      : next(new NotAuthorisedError('You do not have permission to do that'));

module.exports = { loadSession, requireUser, requireMember, requireRole };
