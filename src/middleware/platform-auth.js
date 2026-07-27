'use strict';

const { User } = require('../models');

/**
 * Session loading for the PLATFORM console — deliberately separate from the
 * tenant loadSession. It loads only the User (the platform has no tenant, so
 * there is no Membership to load, and querying one here would have no tenant
 * context). Safe to run on the apex before the tenant resolver.
 */
async function loadPlatformSession(req, res, next) {
  if (!req.session?.userId) return next();
  try {
    const user = await User.findById(req.session.userId).exec();
    if (!user || user.status === 'suspended' ||
        (req.session.epoch || 0) !== (user.sessionEpoch || 0)) {
      req.session.destroy(() => {});
      return next();
    }
    req.user = user;
    res.locals.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * The gate. A real authenticated session whose user carries platformRole
 * 'superadmin'. No secret in a URL, no shared key — a normal login, MFA-eligible,
 * fully auditable. Anyone else gets a 404 (not a 403): the console does not
 * announce its own existence to people who cannot use it.
 */
function requireSuperadmin(req, res, next) {
  if (req.user && req.user.platformRole === 'superadmin') return next();
  return res.status(404).render('error', { status: 404, message: 'Not found' });
}

module.exports = { loadPlatformSession, requireSuperadmin };
