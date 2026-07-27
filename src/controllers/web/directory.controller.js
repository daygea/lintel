'use strict';

const dir = require('../../services/directory.service');
const { rootDomain } = require('../../config/env');
const { pick } = require('../../plugins/locale-map');

const h = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

/** Public institution page. No session, no tenant subdomain — resolved by handle. */
exports.page = h(async (req, res) => {
  const listing = await dir.publicView(req.params.handle);
  if (!listing) return res.status(404).render('directory/not-found', {});
  // Build the institution's base URL from THIS request, so the protocol and port
  // match the environment (http://slug.localhost:3001 in dev, https in prod).
  const proto = req.protocol;
  const hostNoSub = req.get('host'); // e.g. localhost:3001 or lintel.africa
  const port = hostNoSub.includes(':') ? ':' + hostNoSub.split(':')[1] : '';
  const instBase = listing.slug ? `${proto}://${listing.slug}.${rootDomain}${port}` : null;
  res.render('directory/page', { listing, pick, rootDomain, instBase });
});

/** Public directory index. */
exports.index = h(async (req, res) => {
  const listings = await dir.browse({ q: req.query.q });
  res.render('directory/index', { listings, pick, q: req.query.q || '' });
});
