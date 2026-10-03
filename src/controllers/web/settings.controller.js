'use strict';

const tenant = require('../../services/tenant.service');

const h = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

exports.showBranding = (req, res) => {
  res.render('tenant/branding', { t: req.tenant, saved: req.query.saved || null, error: null });
};

exports.showAccess = (req, res) => {
  res.render('tenant/access', { t: req.tenant, saved: req.query.saved || null });
};

exports.saveAccess = h(async (req, res) => {
  // An unchecked checkbox sends no field; presence of the value means "on".
  await tenant.updateAccess({ openLessonsForMembers: req.body.openLessonsForMembers === 'on' });
  res.redirect('/settings/access?saved=1');
});

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
