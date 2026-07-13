'use strict';
const { walk, read, rel } = require('./lib');

/**
 * Invariant 1. Nothing about a tenant's tradition or profession appears in code.
 * OISS's rules are ROWS in AttestationType and EligibilityPolicy, never branches.
 * If you need to add a word here, you are probably about to make a mistake.
 */
const BANNED = ['ifa', 'orisha', 'orisa', 'itefa', 'babalawo', 'iyanifa', 'yoruba', 'oriki', 'midwif', 'nmcn', 'oxytocin'];

/** Comments may cite examples; CODE may not. Strip comments, then scan. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

module.exports = function checkNoTenantTerms() {
  const problems = [];
  for (const file of walk('src')) {
    if (file.includes('/views/')) continue;
    const src = stripComments(read(file)).toLowerCase();
    for (const term of BANNED) {
      if (src.includes(term)) {
        problems.push(
          `${rel(file)}: contains the tenant-specific term "${term}". Tenant judgment is DATA, not code. See invariant 1.`
        );
      }
    }
  }
  return problems;
};
