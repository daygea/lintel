'use strict';

/**
 * Per-institution branding: resolution + upload validation, in one place so the
 * views, the upload endpoint, and the public image route all agree.
 *
 * Two ways an institution supplies a logo or banner:
 *   1. Upload a file  → stored in the PRIVATE media bucket under a stable key,
 *      served back through GET /brand/:tenantId/:kind (which streams from the
 *      bucket). This is the key path.
 *   2. Point at an external URL → used as-is.
 * An uploaded image always wins over an external URL for the same slot.
 *
 * SVG is deliberately NOT an accepted upload type: an SVG can carry script, and
 * these images are served from our own origin. Institutions that need a vector
 * mark can still use an external URL they host themselves.
 */

const DEFAULT_COLOR = '#26314F';
const KINDS = ['logo', 'banner'];

// Accepted upload types and their canonical extensions.
const MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const ALLOWED_MIME = Object.keys(MIME);

// Size caps. A logo is a small mark; a banner is a wide hero, so a little larger.
const MAX_BYTES = { logo: 2 * 1024 * 1024, banner: 5 * 1024 * 1024 };

/** The stable bucket key for an institution's brand image (overwritten on re-upload). */
const brandKey = (tenantId, kind) => `t/${tenantId}/brand/${kind}`;

/** A hex colour like #26314F or #abc, else null. */
function normalizeColor(raw) {
  const s = String(raw || '').trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) ? s : null;
}

/** The accent colour to theme this institution with (never empty). */
function brandColor(tenant) {
  return normalizeColor(tenant && tenant.branding && tenant.branding.primaryColor) || DEFAULT_COLOR;
}

/**
 * The URL a page should load for an institution's logo/banner, or null if it has
 * none. An uploaded image resolves to the streaming route with a cache-busting
 * version (the tenant's updatedAt), so a re-upload is seen promptly; an external
 * URL is returned verbatim.
 */
function brandImageSrc(tenant, kind) {
  if (!tenant || !KINDS.includes(kind)) return null;
  const b = tenant.branding || {};
  if (b[`${kind}Key`]) {
    const id = tenant._id || tenant.id;
    const v = tenant.updatedAt ? new Date(tenant.updatedAt).getTime() : '';
    return `/brand/${id}/${kind}${v ? `?v=${v}` : ''}`;
  }
  if (b[`${kind}Url`]) return b[`${kind}Url`];
  return null;
}

/** What to show as the institution's name mark: its wordmark, else its name. */
function brandName(tenant) {
  const b = (tenant && tenant.branding) || {};
  return (b.wordmark && b.wordmark.trim()) || (tenant && tenant.name) || '';
}

/**
 * A compact bundle for passing into a view/layout. Safe to JSON-serialise.
 */
function brandFor(tenant) {
  return {
    name: brandName(tenant),
    color: brandColor(tenant),
    logo: brandImageSrc(tenant, 'logo'),
    banner: brandImageSrc(tenant, 'banner'),
  };
}

/**
 * Validate an upload before it touches storage. Returns { ok, ext } or throws a
 * plain Error with a user-facing message (callers map to a 4xx).
 */
function validateUpload({ kind, mime, bytes }) {
  if (!KINDS.includes(kind)) throw new Error('Unknown image slot.');
  const m = String(mime || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_MIME.includes(m)) {
    throw new Error('Use a PNG, JPEG, WebP, or GIF image.');
  }
  if (!bytes || bytes <= 0) throw new Error('That file was empty.');
  if (bytes > MAX_BYTES[kind]) {
    const mb = Math.round(MAX_BYTES[kind] / (1024 * 1024));
    throw new Error(`That ${kind} is too large — keep it under ${mb}MB.`);
  }
  return { ok: true, mime: m, ext: MIME[m] };
}

module.exports = {
  DEFAULT_COLOR,
  KINDS,
  ALLOWED_MIME,
  MAX_BYTES,
  brandKey,
  normalizeColor,
  brandColor,
  brandImageSrc,
  brandName,
  brandFor,
  validateUpload,
};
