'use strict';

/**
 * The rich-text sanitiser (Oct-2026). Authored lesson HTML is rendered to learners
 * as raw markup, so the allowlist must strip anything executable while keeping the
 * formatting a basic editor produces. Pure (no DB) — runs under NO_DB.
 */

const { sanitizeRich, sanitizeRichMap } = require('../../src/lib/sanitize');

describe('sanitizeRich', () => {
  it('removes <script> and its contents entirely', () => {
    const out = sanitizeRich('<p>Hello</p><script>alert(1)</script>');
    expect(out).toBe('<p>Hello</p>');
    expect(out).not.toContain('alert');
  });

  it('strips event-handler attributes', () => {
    const out = sanitizeRich('<p onclick="steal()">hi</p><img src=x onerror="hack()">');
    expect(out).not.toMatch(/onclick|onerror/i);
    expect(out).not.toContain('<img'); // images are not allowed in rich text
  });

  it('drops javascript: links but keeps safe ones', () => {
    expect(sanitizeRich('<a href="javascript:evil()">x</a>')).not.toContain('javascript:');
    const safe = sanitizeRich('<a href="https://example.org">site</a>');
    expect(safe).toContain('href="https://example.org"');
    expect(safe).toMatch(/rel="noopener noreferrer"/); // hardened
  });

  it('keeps the allowed formatting tags', () => {
    const html = '<p><strong>bold</strong> <em>em</em></p><ul><li>one</li><li>two</li></ul><blockquote>q</blockquote>';
    expect(sanitizeRich(html)).toBe(html.replace(/<blockquote>q<\/blockquote>/, '<blockquote>q</blockquote>'));
  });

  it('removes inline styles and classes', () => {
    const out = sanitizeRich('<p style="position:fixed" class="x">hi</p>');
    expect(out).toBe('<p>hi</p>');
  });
});

describe('sanitizeRichMap', () => {
  it('sanitises every locale value of a map', () => {
    const out = sanitizeRichMap({ en: '<p>ok</p><script>x</script>', yo: '<b>e se</b><iframe src=x></iframe>' });
    expect(out.en).toBe('<p>ok</p>');
    expect(out.yo).toBe('<b>e se</b>');
  });

  it('passes a bare string through', () => {
    expect(sanitizeRichMap('<p>hi</p><script>x</script>')).toBe('<p>hi</p>');
  });

  it('leaves null/undefined untouched', () => {
    expect(sanitizeRichMap(null)).toBe(null);
    expect(sanitizeRichMap(undefined)).toBe(undefined);
  });
});
