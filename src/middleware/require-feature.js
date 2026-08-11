'use strict';

const { FEATURES } = require('../config/features');

const labelFor = (key) => {
  const f = Object.values(FEATURES).find((x) => x.key === key);
  return f ? f.label : key;
};

/**
 * Gate a route on the tenant's plan. A tenant may only use a feature its plan
 * grants (config/plans.js → tenant.features, checked via tenant.hasFeature).
 * This is the enforcement that makes the plan tiers real — the method existed
 * but nothing called it.
 *
 * On a miss: JSON 403 for API callers, a clear "not on your plan" page otherwise.
 */
const requireFeature = (featureKey) => (req, res, next) => {
  const tenant = req.tenant;
  if (tenant && typeof tenant.hasFeature === 'function' && tenant.hasFeature(featureKey)) {
    return next();
  }

  const wantsJson = req.path.startsWith('/api/') || (req.get('accept') || '').includes('application/json');
  if (wantsJson) {
    return res.status(403).json({ error: 'feature_not_in_plan', feature: featureKey });
  }
  return res.status(403).render('errors/feature-locked', {
    featureLabel: labelFor(featureKey),
    plan: tenant ? tenant.plan : null,
  });
};

module.exports = { requireFeature };
