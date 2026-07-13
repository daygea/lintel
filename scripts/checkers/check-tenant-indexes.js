'use strict';
const { walk, read, rel } = require('./lib');

/** Every compound index on a tenant-scoped model must lead with tenantId. */
module.exports = function checkTenantIndexes() {
  const problems = [];
  for (const file of walk('src/models')) {
    const src = read(file);
    if (!src.includes("require('../plugins/tenant-guard')")) continue;

    const re = /\.index\(\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(src))) {
      const firstKey = m[1].split(',')[0].split(':')[0].trim().replace(/['"]/g, '');
      if (firstKey && firstKey !== 'tenantId') {
        problems.push(
          `${rel(file)}: index { ${m[1].trim()} } does not lead with tenantId. Every index on a tenant-scoped collection must.`
        );
      }
    }
  }
  return problems;
};
