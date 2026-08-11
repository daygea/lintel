'use strict';

/**
 * Suspended-tenant lockout. A lapsed trial or unpaid subscription blocks the whole
 * tenant app: owners/admins are redirected to billing to reactivate, the webhook
 * and logout stay open (so payment can land and people can leave), and everyone
 * else sees a suspended notice. Active/trial tenants pass straight through.
 */
module.exports = function enforceActive(req, res, next) {
  const t = req.tenant;
  if (!t || t.status !== 'suspended') return next();

  const p = req.path;
  if (p.startsWith('/settings/billing') || p === '/logout' || p.startsWith('/api/v1/webhooks/')) return next();

  const roles = (req.membership && req.membership.roles) || [];
  if (roles.includes('owner') || roles.includes('admin')) return res.redirect('/settings/billing');
  return res.status(403).render('errors/suspended');
};
