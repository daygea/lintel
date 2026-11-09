'use strict';

const tenant = require('../../services/tenant.service');
const storage = require('../../lib/storage');
const { currentTenantId } = require('../../lib/context');
const brand = require('../../lib/brand');

const h = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

exports.showBranding = (req, res) => {
  res.render('tenant/branding', {
    t: req.tenant,
    brand: brand.brandFor(req.tenant),
    saved: req.query.saved || null,
    error: null,
  });
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
  const color = brand.normalizeColor(req.body.primaryColor) || brand.DEFAULT_COLOR;
  await tenant.updateBranding({
    name: (req.body.name || '').trim() || req.tenant.name,
    branding: {
      // Image KEYS are not touched here (managed by the upload endpoint); these
      // are the external-URL fallbacks and the text fields. Empty = clear.
      logoUrl: (req.body.logoUrl || '').trim(),
      bannerUrl: (req.body.bannerUrl || '').trim(),
      primaryColor: color,
      wordmark: (req.body.wordmark || '').trim(),
    },
    locales: locales.length ? locales : req.tenant.locales,
  });
  res.redirect('/settings/branding?saved=1');
});

/**
 * Receive an uploaded logo/banner. The browser POSTs the raw image bytes (see
 * the branding page's small uploader) with the image's own Content-Type and the
 * CSRF token in a header. We validate, store in the private media bucket under a
 * stable per-institution key, and record the reference on the tenant.
 */
exports.uploadBrandImage = h(async (req, res) => {
  const kind = req.params.kind;
  const buf = Buffer.isBuffer(req.body) ? req.body : null;
  let checked;
  try {
    checked = brand.validateUpload({
      kind,
      mime: req.headers['content-type'],
      bytes: buf ? buf.length : 0,
    });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }
  const tenantId = currentTenantId();
  try {
    await storage.put(brand.brandKey(tenantId, kind), buf, checked.mime);
    await tenant.setBrandImage({ kind, mime: checked.mime });
  } catch (e) {
    // Return JSON (not an HTML error page) so the uploader shows the real reason
    // — e.g. "Media storage is not configured. Missing: …" when R2 env vars are
    // unset — instead of a generic failure.
    const status = e.status || 502;
    const msg = e.expose ? e.message : 'Could not store the image right now. Please try again.';
    return res.status(status).json({ ok: false, error: msg });
  }
  return res.json({ ok: true, kind, src: `/brand/${tenantId}/${kind}?v=${Date.now()}` });
});

/** Remove an uploaded logo/banner (reverts to the external URL, if any, or none). */
exports.removeBrandImage = h(async (req, res) => {
  const kind = req.params.kind;
  if (!brand.KINDS.includes(kind)) return res.status(400).json({ ok: false, error: 'Unknown image slot.' });
  await tenant.clearBrandImage({ kind });
  return res.json({ ok: true, kind });
});
