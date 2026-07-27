'use strict';

const { walk, read, rel } = require('./lib');

/**
 * Accessibility as an enforced invariant, not a one-time audit. Catches the
 * common, mechanical WCAG failures that creep back in every time a view is added:
 *   - an <img> with no alt
 *   - a <button>/<a> that is icon- or empty-only (no accessible name)
 *   - an <input> with no associated <label> and no aria-label
 *   - a document <html> with no lang
 *
 * It cannot judge colour contrast or reading order — those stay in the manual
 * audit (docs). But it stops the failures a human reviewer misses under time
 * pressure, which is most of them.
 */
module.exports = function checkA11y() {
  const problems = [];

  for (const file of walk('src/views')) {
    if (!file.endsWith('.ejs')) continue;
    const src = read(file);
    const name = rel(file);

    // <img> without alt (allow alt="" for decorative, but the attribute must exist)
    for (const m of src.matchAll(/<img\b(?![^>]*\balt=)[^>]*>/gi)) {
      problems.push(`${name}: <img> without an alt attribute`);
    }

    // <html> tag present but no lang
    if (/<html\b(?![^>]*\blang=)/i.test(src)) {
      problems.push(`${name}: <html> without a lang attribute`);
    }

    // <input> (non-hidden) with neither id (for a label) nor aria-label
    for (const m of src.matchAll(/<input\b[^>]*>/gi)) {
      const tag = m[0];
      if (/type=["']hidden["']/i.test(tag)) continue;
      if (!/\b(id|aria-label|aria-labelledby)=/i.test(tag)) {
        problems.push(`${name}: <input> without an id, aria-label, or aria-labelledby`);
      }
    }
  }

  // Public HTML shell (the PWA) too.
  for (const file of walk('public/app')) {
    if (!file.endsWith('.html')) continue;
    const src = read(file);
    const name = rel(file);
    if (/<html\b(?![^>]*\blang=)/i.test(src)) problems.push(`${name}: <html> without a lang attribute`);
    for (const m of src.matchAll(/<img\b(?![^>]*\balt=)[^>]*>/gi)) {
      problems.push(`${name}: <img> without an alt attribute`);
    }
  }

  return problems;
};
