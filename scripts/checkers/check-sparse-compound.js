'use strict';
const { walk, read, rel } = require('./lib');

/**
 * A COMPOUND index must not use `sparse: true`.
 *
 * MongoDB includes a document in a compound index when ANY of the indexed keys is
 * present — and on a tenant-scoped model tenantId is always present. So `sparse`
 * never excludes the ref-less rows it looks like it should: a "unique + sparse"
 * compound index silently lets rows missing the OTHER key collide on {tenant, null}.
 * This has bitten twice (Cohort.code, Payment.providerRef). Use a partial index
 * (partialFilterExpression) keyed on the optional field actually existing.
 *
 * Escape hatch: mark a genuinely intended compound-sparse index // @sparse-ok on
 * the same statement, so any exception is visible and justified in review.
 */
module.exports = function checkSparseCompound() {
  const problems = [];
  for (const file of walk('src/models')) {
    const src = read(file);
    // Capture the key object and the remainder of the .index(...) statement, up to
    // its closing paren or newline — enough to see the options and any marker.
    const re = /\.index\(\s*\{([^}]*)\}([^;]*?)\)/g;
    let m;
    while ((m = re.exec(src))) {
      const whole = m[0];
      if (whole.includes('@sparse-ok')) continue;
      const keyCount = (m[1].match(/:/g) || []).length; // one ':' per key
      const compound = keyCount > 1;
      const sparse = /sparse\s*:\s*true/.test(m[2]);
      if (compound && sparse) {
        problems.push(
          `${rel(file)}: compound index { ${m[1].trim()} } uses sparse:true. A compound sparse index doesn't exclude rows missing one key (tenantId is always present), so ref-less rows collide on {tenant, null}. Use partialFilterExpression instead. (If truly intended, mark the statement // @sparse-ok.)`
        );
      }
    }
  }
  return problems;
};
