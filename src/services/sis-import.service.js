'use strict';

const { User, Membership, ExternalIdentity, Cohort, Enrollment, AuditLog } = require('../models');
const { ValidationError } = require('../lib/errors');
const { currentUserId } = require('../lib/context');

/**
 * Bulk roster import from a Student Information System.
 *
 * IDEMPOTENT by external student id: re-importing the same roster updates rather
 * than duplicates. This matters because a registrar WILL run the import twice —
 * once to test, once for real, and again after a correction — and a system that
 * mints duplicate learners on each run is worse than no import at all.
 *
 * Input is an array of plain rows (the CSV/Excel parsing happens at the edge, so
 * this core is testable with objects). Each row:
 *   { studentId, email, name, role?, cohortCode? }
 *
 * Returns a report: created / updated / enrolled / skipped / errors — so a
 * registrar sees exactly what happened and can trust it before the real run.
 */
async function importRoster({ rows, source = 'sis' }) {
  if (!Array.isArray(rows)) throw new ValidationError('Roster must be an array of rows');

  const report = { created: 0, updated: 0, enrolled: 0, skipped: 0, errors: [] };

  for (const [i, row] of rows.entries()) {
    try {
      if (!row.studentId) throw new Error('missing studentId');
      if (!row.email && !row.name) throw new Error('row needs at least an email or a name');

      // 1. Resolve the person by their external student id (stable), then email.
      let identity = await ExternalIdentity.findOne({ source, subject: String(row.studentId) }).exec();
      let user;

      if (identity) {
        user = await User.findById(identity.userId).exec();
        if (row.name && user.name !== row.name) {
          await User.updateOne({ _id: user._id }, { name: row.name }).exec();
          report.updated += 1;
        } else {
          report.skipped += 1;
        }
      } else {
        user = row.email ? await User.findOne({ email: row.email }).exec() : null;
        if (!user) {
          user = await User.create({ email: row.email, name: row.name, status: 'active', passwordHash: null, ssoOnly: true });
          report.created += 1;
        } else {
          report.updated += 1;
        }
        await ExternalIdentity.create({ userId: user._id, source, subject: String(row.studentId) });
      }

      // 2. Ensure membership with the given (or default) role.
      const role = row.role || 'learner';
      const membership = await Membership.findOne({ userId: user._id }).exec();
      if (!membership) {
        await Membership.create({ userId: user._id, roles: [role], status: 'active' });
      } else if (!membership.roles.includes(role)) {
        await Membership.updateOne({ _id: membership._id }, { $addToSet: { roles: role } }).exec();
      }

      // 3. Optionally enrol into a cohort by code — idempotent.
      if (row.cohortCode) {
        const cohort = await Cohort.findOne({ code: row.cohortCode }).exec();
        if (!cohort) throw new Error(`no cohort with code ${row.cohortCode}`);
        const already = await Enrollment.findOne({ userId: user._id, cohortId: cohort._id }).exec();
        if (!already) {
          await Enrollment.create({ userId: user._id, courseId: cohort.courseId, cohortId: cohort._id, status: 'active' });
          report.enrolled += 1;
        }
      }
    } catch (err) {
      report.errors.push({ row: i + 1, studentId: row.studentId, message: err.message });
    }
  }

  await AuditLog.create({
    actorUserId: currentUserId(),
    action: 'sis.import',
    subjectType: 'Tenant',
    subjectId: null,
    meta: { created: report.created, updated: report.updated, enrolled: report.enrolled, errors: report.errors.length },
  });

  return report;
}

module.exports = { importRoster };
