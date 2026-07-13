'use strict';
const { walk, read, rel } = require('./lib');

/** Every model must either register tenant-guard or be an explicit platform model. */
const PLATFORM_SCOPED = ['tenant.js', 'user.js', 'index.js'];

module.exports = function checkTenantGuard() {
  const problems = [];
  for (const file of walk('src/models')) {
    const base = file.split('/').pop();
    if (PLATFORM_SCOPED.includes(base)) continue;
    const src = read(file);
    if (!src.includes("require('../plugins/tenant-guard')")) {
      problems.push(
        `${rel(file)} does not register tenant-guard. Add the plugin, or add it to PLATFORM_SCOPED and justify it in the PR.`
      );
    }
  }
  return problems;
};
