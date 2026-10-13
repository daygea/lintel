'use strict';

const catalog = require('../../services/catalog.service');

const h = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

// The catalogue as JSON — so the learner PWA (or an institution's own site) can
// render discovery natively. Same tenant/visibility rules as the web page.
exports.list = h(async (req, res) =>
  res.json(await catalog.catalogue({ userId: req.user._id, locale: req.tenant.defaultLocale }))
);
