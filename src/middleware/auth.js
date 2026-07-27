'use strict';

const { User, Membership } = require('../models');
const { NotAuthenticatedError, NotAuthorisedError } = require('../lib/errors');
const { has } = require('../lib/roles');

/** Loads the signed-in user and their membership OF THIS TENANT. */
async function loadSession(req, res, next) {
  if (!req.session?.userId) return next();
  try {
    const user = await User.findById(req.session.userId).exec();
    // Drop the session if the user is gone, suspended, or has been force-logged-out
    // (their sessionEpoch was bumped since this session was issued).
    if (!user || user.status === 'suspended' ||
        (req.session.epoch || 0) !== (user.sessionEpoch || 0)) {
      req.session.destroy(() => {});
      return next();
    }
    const membership = await Membership.findOne({ userId: user._id, status: 'active' }).exec();
    // When there's no ACTIVE membership, find out whether the person is a pending
    // self-registrant (awaiting admission) versus a genuine non-member. Only one
    // extra query, only in the no-active case. requireMember uses this to show a
    // truthful landing rather than a "not a member" 403.
    let membershipStatus = membership ? 'active' : null;
    if (!membership) {
      const any = await Membership.findOne({ userId: user._id }).sort({ createdAt: -1 }).exec();
      membershipStatus = any ? any.status : null;
    }
    req.user = user;
    req.membership = membership;
    req.membershipStatus = membershipStatus;
    res.locals.user = user;
    res.locals.membership = membership;
    res.locals.membershipStatus = membershipStatus;
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
  // A pending self-registrant IS a member of this institution — just not yet
  // admitted. Sending them to a page that says "you are not a member" is both
  // untrue and a dead end. Route browsers to the awaiting-admission landing;
  // API clients still get the hard 401/403 (they can't follow a redirect).
  if (!wantsJson(req) && req.membershipStatus === 'pending') {
    return res.redirect('/pending');
  }
  return next(new NotAuthorisedError('You are not a member of this institution'));
}

const requireRole =
  (...roles) =>
  (req, _res, next) =>
    has(req.membership, ...roles)
      ? next()
      : next(new NotAuthorisedError('You do not have permission to do that'));

module.exports = { loadSession, requireUser, requireMember, requireRole };
