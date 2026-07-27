'use strict';
const { walk, read, rel } = require('./lib');

/** Every model must either register tenant-guard or be an explicit platform model. */
const PLATFORM_SCOPED = [
  'tenant.js',   // the tenant itself
  'user.js',     // a person may belong to many tenants
  'index.js',    // the model registry
  // Sprint 12 — self-service onboarding. These exist OUTSIDE any tenant by design:
  'onboarding-token.js',   // a set-password token; the clicker has no tenant context yet
  'tenant-application.js', // a request to CREATE a tenant — there is none to scope to
  // Sprint 13 — platform console.
  'platform-audit-log.js', // operator actions ABOVE any tenant; belongs to none
  // Sprint 14 — abuse response. Both name a tenant as a FIELD but belong to the
  // platform: a report is filed platform-side, a grant is issued platform-side.
  'abuse-report.js',
  'breakglass-grant.js',
];

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
