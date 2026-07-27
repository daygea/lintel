'use strict';

const models = require('../models');
const { currentTenantId } = require('../lib/context');

/**
 * Tenant data export. "Can we leave with our material?" is, for this product, an
 * ethical requirement, not a sales objection — say yes before they ask.
 *
 * Exports the tenant's own records as JSON. Archive material is exported as
 * REFERENCES (accession numbers + terms), never bytes — because we never held the
 * bytes (ADR-004). Media assets are exported as their metadata plus storage keys;
 * a full media export is a separate, heavier operation (signed-URL manifest).
 *
 * Runs inside the tenant context, so every collection is already scoped.
 */
const EXPORTABLE = [
  'Program', 'Course', 'Module', 'Lesson', 'ContentBlock', 'Asset',
  'Cohort', 'Application', 'Enrollment', 'LessonProgress', 'Group', 'Session', 'Attendance',
  'AttestationType', 'Attestation', 'EligibilityPolicy', 'ContentPolicy',
  'Rubric', 'Assessment', 'Submission', 'Grade',
  'GradeScheme', 'LineItem', 'Score', 'Quiz', 'QuizAttempt',
  'FeeSchedule', 'Invoice', 'Payment',
  'CredentialTemplate', 'Credential',
  'Membership',
];

async function exportTenant() {
  const tenantId = currentTenantId();
  const out = {
    exportedAt: new Date().toISOString(),
    tenantId: String(tenantId),
    format: 'lintel-export-v1',
    collections: {},
  };

  for (const name of EXPORTABLE) {
    const Model = models[name];
    if (!Model) continue;
    const docs = await Model.find({}).lean().exec();
    out.collections[name] = docs;
  }

  out.summary = Object.fromEntries(
    Object.entries(out.collections).map(([k, v]) => [k, v.length])
  );
  return out;
}

module.exports = { exportTenant, EXPORTABLE };
