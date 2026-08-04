'use strict';

const tenant = require('../../services/tenant.service');

const h = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

exports.showBranding = (req, res) => {
  res.render('tenant/branding', { t: req.tenant, saved: req.query.saved || null, error: null });
};

exports.saveBranding = h(async (req, res) => {
  const locales = String(req.body.locales || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  await tenant.updateBranding({
    name: (req.body.name || '').trim() || req.tenant.name,
    branding: {
      logoUrl: (req.body.logoUrl || '').trim() || undefined,
      primaryColor: (req.body.primaryColor || '').trim() || '#26314F',
      wordmark: (req.body.wordmark || '').trim() || undefined,
    },
    locales: locales.length ? locales : req.tenant.locales,
  });
  res.redirect('/settings/branding?saved=1');
});
