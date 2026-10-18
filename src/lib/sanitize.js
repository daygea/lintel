'use strict';

const sanitizeHtml = require('sanitize-html');

/**
 * Strict allowlist for institution-authored rich text.
 *
 * Lesson rich_text bodies are injected into the learner's DOM as raw HTML
 * (`el.innerHTML = pickRaw(block.body)`), so whatever an author stores runs in
 * every learner's browser. This permits only the formatting a basic editor
 * produces — paragraphs, emphasis, lists, links, small headings, quotes, inline
 * code — and strips EVERYTHING else: no <script>/<style>, no event handlers
 * (onerror, onclick…), no <iframe>/<img>, no inline styles or classes. Links are
 * limited to safe schemes and hardened with rel="noopener noreferrer".
 *
 * Headings are capped at h3/h4 so authored content can't impersonate the page's
 * own h1/h2. Images and embeds are deliberately excluded — those are their own
 * ContentBlock types, each with its own handling, not free-form HTML.
 */
const RICH = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
    'ul', 'ol', 'li', 'blockquote', 'h3', 'h4', 'pre', 'code', 'a',
  ],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  // A disallowed tag's TEXT is dropped too for these (so "<script>alert(1)</script>"
  // leaves nothing behind, not the bare "alert(1)").
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
};

/** Sanitise one HTML string against the strict allowlist. */
function sanitizeRich(html) {
  if (html == null) return html;
  return sanitizeHtml(String(html), RICH);
}

/**
 * Sanitise a LocaleMap value ({ en: '<p>…', yo: '…' }) value-by-value. Accepts a
 * plain object or a Mongoose Map and returns a plain object ready to store (which
 * the localeMap plugin then casts back to a Map on save).
 */
function sanitizeRichMap(map) {
  if (!map) return map;
  if (typeof map === 'string') return sanitizeRich(map);
  const entries = map instanceof Map ? [...map.entries()] : Object.entries(map);
  return Object.fromEntries(entries.map(([loc, html]) => [loc, sanitizeRich(html)]));
}

module.exports = { sanitizeRich, sanitizeRichMap, RICH_OPTIONS: RICH };
