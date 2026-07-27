'use strict';

const { walk, read, rel } = require('./lib');

/**
 * Every POST form in a view must carry a CSRF token. A form that POSTs without
 * `_csrf` will be rejected by the csrf middleware at submit time — a 403 the user
 * sees as a broken form. This catches it at build time instead of in production.
 *
 * (Three public signup forms shipped without the token once; this exists so that
 * never happens silently again.)
 */
module.exports = function checkCsrfForms() {
  const problems = [];
  for (const file of walk('src/views', '.ejs')) {
    const src = read(file);
    // Find each <form ...> opening tag with method post (case-insensitive).
    const formOpen = /<form\b[^>]*method\s*=\s*["']post["'][^>]*>/gi;
    let m;
    while ((m = formOpen.exec(src)) !== null) {
      // Look at the slice from this form tag to the next </form>.
      const start = m.index;
      const end = src.indexOf('</form>', start);
      const block = end === -1 ? src.slice(start) : src.slice(start, end);
      if (!/name\s*=\s*["']_csrf["']/.test(block)) {
        problems.push(`${rel(file)}: a POST <form> has no _csrf token field`);
      }
    }
  }
  return problems;
};
