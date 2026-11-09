'use strict';

// describe/it/expect are globals (vitest config: globals: true) — do not import them.
const brand = require('../../src/lib/brand');

describe('brand helpers', () => {
  describe('normalizeColor', () => {
    it('accepts 3- and 6-digit hex', () => {
      expect(brand.normalizeColor('#abc')).toBe('#abc');
      expect(brand.normalizeColor('#A1B2C3')).toBe('#A1B2C3');
      expect(brand.normalizeColor('  #26314F ')).toBe('#26314F');
    });
    it('rejects anything else (no CSS injection)', () => {
      expect(brand.normalizeColor('red')).toBeNull();
      expect(brand.normalizeColor('#12')).toBeNull();
      expect(brand.normalizeColor('#1234')).toBeNull();
      expect(brand.normalizeColor('#abc; background:url(x)')).toBeNull();
      expect(brand.normalizeColor('')).toBeNull();
      expect(brand.normalizeColor(null)).toBeNull();
    });
  });

  describe('brandColor', () => {
    it('falls back to the default when unset or invalid', () => {
      expect(brand.brandColor(null)).toBe(brand.DEFAULT_COLOR);
      expect(brand.brandColor({})).toBe(brand.DEFAULT_COLOR);
      expect(brand.brandColor({ branding: { primaryColor: 'nope' } })).toBe(brand.DEFAULT_COLOR);
    });
    it('uses a valid stored colour', () => {
      expect(brand.brandColor({ branding: { primaryColor: '#0A7' } })).toBe('#0A7');
    });
  });

  describe('brandImageSrc', () => {
    const id = '6ad367682a0f8b7c4ae60460';
    it('returns the streaming route for an uploaded image, with a cache-busting version', () => {
      const t = { _id: id, updatedAt: new Date(1700000000000), branding: { logoKey: 't/x/brand/logo' } };
      expect(brand.brandImageSrc(t, 'logo')).toBe(`/brand/${id}/logo?v=1700000000000`);
    });
    it('prefers an uploaded image over an external URL', () => {
      const t = { _id: id, branding: { logoKey: 't/x/brand/logo', logoUrl: 'https://ext/logo.png' } };
      expect(brand.brandImageSrc(t, 'logo')).toMatch(new RegExp(`^/brand/${id}/logo`));
    });
    it('falls back to an external URL when nothing is uploaded', () => {
      const t = { _id: id, branding: { bannerUrl: 'https://ext/b.jpg' } };
      expect(brand.brandImageSrc(t, 'banner')).toBe('https://ext/b.jpg');
    });
    it('returns null when there is no image and for unknown kinds', () => {
      expect(brand.brandImageSrc({ _id: id, branding: {} }, 'logo')).toBeNull();
      expect(brand.brandImageSrc({ _id: id, branding: { logoKey: 'k' } }, 'favicon')).toBeNull();
      expect(brand.brandImageSrc(null, 'logo')).toBeNull();
    });
  });

  describe('brandName', () => {
    it('prefers the wordmark, else the institution name', () => {
      expect(brand.brandName({ name: 'Osun Inst', branding: { wordmark: 'OISS' } })).toBe('OISS');
      expect(brand.brandName({ name: 'Osun Inst', branding: {} })).toBe('Osun Inst');
      expect(brand.brandName({ name: 'Osun Inst' })).toBe('Osun Inst');
    });
  });

  describe('brandKey', () => {
    it('is stable and tenant-scoped', () => {
      expect(brand.brandKey('abc', 'logo')).toBe('t/abc/brand/logo');
      expect(brand.brandKey('abc', 'banner')).toBe('t/abc/brand/banner');
    });
  });

  describe('validateUpload', () => {
    it('accepts allowed types within the size cap', () => {
      expect(brand.validateUpload({ kind: 'logo', mime: 'image/png', bytes: 1000 })).toEqual({ ok: true, mime: 'image/png', ext: 'png' });
      expect(brand.validateUpload({ kind: 'banner', mime: 'image/jpeg; charset=binary', bytes: 2000 }).ext).toBe('jpg');
    });
    it('rejects SVG and other non-image types', () => {
      expect(() => brand.validateUpload({ kind: 'logo', mime: 'image/svg+xml', bytes: 100 })).toThrow();
      expect(() => brand.validateUpload({ kind: 'logo', mime: 'text/html', bytes: 100 })).toThrow();
    });
    it('rejects an unknown slot', () => {
      expect(() => brand.validateUpload({ kind: 'favicon', mime: 'image/png', bytes: 100 })).toThrow();
    });
    it('rejects empty and oversize files', () => {
      expect(() => brand.validateUpload({ kind: 'logo', mime: 'image/png', bytes: 0 })).toThrow();
      expect(() => brand.validateUpload({ kind: 'logo', mime: 'image/png', bytes: brand.MAX_BYTES.logo + 1 })).toThrow(/too large/);
      // a banner may be larger than a logo
      expect(brand.validateUpload({ kind: 'banner', mime: 'image/png', bytes: brand.MAX_BYTES.logo + 1 }).ok).toBe(true);
    });
  });
});
