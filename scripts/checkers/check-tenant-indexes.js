'use strict';
const { walk, read, rel } = require('./lib');

/**
 * Every compound index on a tenant-scoped model must lead with tenantId — UNLESS
 * the index line is explicitly marked `// @global-unique`, for the rare field that
 * is deliberately a cross-tenant namespace (a public directory handle, a global
 * verification code space). The marker is required and greppable: a genuinely
 * global index must SAY so, so the default stays "everything is tenant-first" and
 * every exception is visible in review and justified in a comment.
 */
module.exports = function checkTenantIndexes() {
  const problems = [];
  for (const file of walk('src/models')) {
    const src = read(file);
    if (!src.includes("require('../plugins/tenant-guard')")) continue;

    // Match the whole index(...) statement line so we can see a trailing marker.
    const re = /\.index\(\s*\{([^}]*)\}[^\n]*/g;
    let m;
    while ((m = re.exec(src))) {
      if (m[0].includes('@global-unique')) continue; // deliberate cross-tenant namespace
      const firstKey = m[1].split(',')[0].split(':')[0].trim().replace(/['"]/g, '');
      if (firstKey && firstKey !== 'tenantId') {
        problems.push(
          `${rel(file)}: index { ${m[1].trim()} } does not lead with tenantId. Every index on a tenant-scoped collection must. (If this is a deliberate global namespace, mark the line // @global-unique.)`
        );
      }
    }
  }
  return problems;
};
