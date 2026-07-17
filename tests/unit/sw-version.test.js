'use strict';

const fs = require('node:fs');

/**
 * The one Orírùn scar we refuse to reopen: a service worker whose version was not
 * bumped serves stale code. This test does not prevent forgetting to bump it, but
 * it asserts the version string EXISTS and is the cache name — so the mechanism
 * that makes bumping work is intact.
 */
describe('service worker versioning', () => {
  const sw = fs.readFileSync('public/sw.js', 'utf8');

  it('declares a BUILD version', () => {
    expect(sw).toMatch(/const BUILD = 'lintel-v[\d.]+'/);
  });

  it('derives the cache name from BUILD, so a bump orphans old caches', () => {
    expect(sw).toMatch(/SHELL_CACHE = `\$\{BUILD\}/);
  });

  it('deletes caches that do not match the current BUILD on activate', () => {
    expect(sw).toMatch(/filter\(\(k\) => !k\.startsWith\(BUILD\)\)/);
  });

  it('never caches playback or storage URLs', () => {
    expect(sw).toMatch(/includes\('\/playback'\)/);
    expect(sw).toMatch(/r2\.cloudflarestorage\.com/);
  });
});
