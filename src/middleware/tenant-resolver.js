'use strict';

const { Tenant } = require('../models');
const { runWithTenant } = require('../lib/context');
const { TenantNotFoundError } = require('../lib/errors');
const { rootDomain } = require('../config/env');

/**
 * Resolves the tenant from the Host header, then runs the ENTIRE downstream
 * middleware chain inside that tenant's AsyncLocalStorage context.
 *
 *   oiss.lintel.africa     -> slug lookup
 *   learn.oiss.ng          -> custom domain lookup
 *
 * Everything after this point can query freely. Everything before it cannot query
 * tenant data at all — and will throw if it tries. That is deliberate.
 */
function hostToSlug(host) {
  const bare = String(host || '').split(':')[0].toLowerCase();
  if (bare.endsWith(`.${rootDomain}`)) {
    const sub = bare.slice(0, -(rootDomain.length + 1));
    return sub && sub !== 'www' ? sub : null;
  }
  return null;
}

module.exports = async function tenantResolver(req, res, next) {
  const host = req.headers.host;
  const slug = hostToSlug(host);

  let tenant = null;
  try {
    tenant = slug
      ? await Tenant.findOne({ slug, status: { $ne: 'closed' } })
      : await Tenant.findOne({ domains: String(host || '').split(':')[0].toLowerCase(), status: { $ne: 'closed' } });
  } catch (err) {
    return next(err);
  }

  if (!tenant) return next(new TenantNotFoundError(host));

  req.tenant = tenant;
  res.locals.tenant = tenant;

  return runWithTenant(tenant._id, req.session?.userId || null, () => next());
};

module.exports.hostToSlug = hostToSlug;
