'use strict';

const auth = require('../../services/auth.service');
const { User, Membership } = require('../../models');
const { has, STAFF } = require('../../lib/roles');

/**
 * Regenerate the session before establishing identity (defeats session fixation),
 * preserving the pre-login returnTo. Then route by standing.
 */
function completeLogin(req, res, next, user) {
  const returnTo = req.session.returnTo;
  req.session.regenerate(async (err) => {
    if (err) return next(err);
    try {
      req.session.userId = user._id.toString();
      req.session.epoch = user.sessionEpoch || 0;
      await User.updateOne({ _id: user._id }, { $set: { lastSeenAt: new Date() } }).exec();

      // A temporary (fallback) password must be changed before anything else.
      if (user.mustChangePassword) return res.redirect('/account/password');

      // Route by standing. A pending self-registrant isn't admitted yet (→ /pending);
      // a pure learner belongs in the learner app; staff get the admin shell / returnTo.
      const membership = await Membership.findOne({ userId: user._id }).sort({ createdAt: -1 }).exec();
      const active = membership && membership.status === 'active';
      if (!active) return res.redirect('/pending');
      if (has(membership, ...STAFF)) return res.redirect(returnTo || '/');
      return res.redirect('/app/');
    } catch (e) {
      return next(e);
    }
  });
}

/**
 * On the apex (no institution on this host) there is no tenant to log in through —
 * a tenant login needs a tenant context, and attempting one here throws. The only
 * legitimate sign-in on the apex is the platform console, so send people there.
 * This also makes the superadmin login discoverable at the obvious /login.
 */
function apexRedirect(req, res) {
  if (req.tenant) return false;
  const dest = req.user && req.user.platformRole === 'superadmin' ? '/console' : '/console/login';
  res.redirect(dest);
  return true;
}

exports.showLogin = (req, res) => {
  if (apexRedirect(req, res)) return undefined;
  if (req.user) return res.redirect('/');
  return res.render('auth/login', { error: null, mfaRequired: false, email: '' });
};

exports.login = async (req, res, next) => {
  if (apexRedirect(req, res)) return undefined;
  try {
    // Step two: a code for a login whose password already verified this request cycle.
    if (req.session.mfaPending) {
      const { userId, at } = req.session.mfaPending;
      if (Date.now() - at > 5 * 60 * 1000) {
        delete req.session.mfaPending;
        return res.status(401).render('auth/login', { error: 'That took too long — sign in again.', mfaRequired: false, email: '' });
      }
      const user = await User.findById(userId).exec();
      if (!user) {
        delete req.session.mfaPending;
        return res.status(401).render('auth/login', { error: 'Sign in again.', mfaRequired: false, email: '' });
      }
      try {
        await auth.verifyTotp({ user, totp: req.body.totp });
      } catch (e) {
        return res.status(401).render('auth/login', { error: 'That code is not right. Try the next one.', mfaRequired: true, email: user.email });
      }
      delete req.session.mfaPending;
      return completeLogin(req, res, next, user);
    }

    // Step one: email + password.
    const { user, mfaRequired } = await auth.authenticatePassword(req.body);
    if (mfaRequired) {
      req.session.mfaPending = { userId: String(user._id), at: Date.now() };
      return res.render('auth/login', { error: null, mfaRequired: true, email: req.body.email || '' });
    }
    return completeLogin(req, res, next, user);
  } catch (err) {
    if (err.status === 401 || err.status === 422) {
      return res.status(err.status).render('auth/login', { error: err.message, mfaRequired: false, email: req.body.email || '' });
    }
    return next(err);
  }
};

/** Awaiting-admission landing for a signed-in but not-yet-active member. */
exports.pending = (req, res) => {
  if (req.membership) return res.redirect(has(req.membership, ...STAFF) ? '/' : '/app/');
  return res.render('auth/pending', {});
};

/** Forced password change (temporary-password accounts). */
exports.showChangePassword = (req, res) => {
  res.render('auth/change-password', { error: null, forced: !!req.user?.mustChangePassword });
};

exports.changePassword = async (req, res, next) => {
  try {
    await auth.changePassword({
      userId: req.user._id,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
    });
    // The epoch was bumped; refresh this session's epoch so it isn't dropped.
    const fresh = await User.findById(req.user._id).exec();
    req.session.epoch = fresh.sessionEpoch || 0;
    return res.redirect('/');
  } catch (err) {
    if (err.status === 401 || err.status === 422) {
      return res.status(err.status).render('auth/change-password', { error: err.message, forced: !!req.user?.mustChangePassword });
    }
    return next(err);
  }
};

exports.logout = (req, res) => req.session.destroy(() => res.redirect('/login'));
