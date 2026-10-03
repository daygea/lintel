'use strict';

/**
 * An account created with a temporary (fallback) password must set a real one before
 * doing anything else. This catches an already-signed-in session (the login handler
 * also redirects at sign-in time). Browsers are sent to the change-password page;
 * the page itself, logout, static assets and the JSON API are let through.
 */
module.exports = function enforcePasswordChange(req, res, next) {
  if (!req.user || !req.user.mustChangePassword) return next();
  const p = req.path;
  if (p === '/account/password' || p === '/logout' || p.startsWith('/api/')) return next();
  return res.redirect('/account/password');
};
