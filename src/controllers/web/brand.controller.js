'use strict';

const { Tenant } = require('../../models');
const { runAsPlatform } = require('../../lib/context');
const storage = require('../../lib/storage');
const brand = require('../../lib/brand');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/**
 * Public logo/banner. Brand images are public by design (they appear on the
 * cross-host directory page and to signed-out visitors), but the media bucket is
 * private — so we stream the bytes through here with a short cache rather than
 * exposing bucket URLs. Runs without tenant context, keyed by tenant id.
 */
exports.serve = async (req, res, next) => {
  try {
    const { tenantId, kind } = req.params;
    if (!brand.KINDS.includes(kind) || !OBJECT_ID.test(tenantId)) return res.status(404).end();

    const t = await runAsPlatform('public brand image', () => Tenant.findById(tenantId).exec());
    if (!t || t.status === 'deleted') return res.status(404).end();

    const b = t.branding || {};
    const key = b[`${kind}Key`];
    if (!key) return res.status(404).end();

    // Let a conditional request short-circuit before we fetch the bytes.
    const v = t.updatedAt ? new Date(t.updatedAt).getTime() : '';
    if (v) res.set('ETag', `"${kind}-${v}"`);
    res.set('Cache-Control', 'public, max-age=300');
    if (req.fresh) return res.status(304).end();

    let buf;
    try {
      buf = await storage.getBuffer(key);
    } catch (e) {
      // Missing object or storage not configured — treat as "no image".
      return res.status(404).end();
    }
    res.set('Content-Type', b[`${kind}Mime`] || 'image/png');
    return res.end(buf);
  } catch (err) {
    return next(err);
  }
};
