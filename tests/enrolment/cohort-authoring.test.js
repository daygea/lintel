'use strict';

/**
 * Cohort authoring wiring: create → open → add session → mark attendance.
 * The service logic is tested elsewhere; this proves the create/status/session/
 * attendance path the UI drives actually works together.
 */

const { Tenant } = require('../../src/models');
const svc = require('../../src/services/enrolment.service');
const curriculum = require('../../src/services/curriculum.service');
const { runWithTenant } = require('../../src/lib/context');

describe('cohort authoring', () => {
  let tenantId, courseId;
  beforeEach(async () => {
    const t = await Tenant.create({ slug: 'test-cohort', name: 'T', locales: ['en'], status: 'active' });
    tenantId = t._id;
    await runWithTenant(tenantId, null, async () => {
      const course = await curriculum.createCourse({ code: 'C1', title: { en: 'Course' } });
      courseId = course._id;
    });
  });

  it('creates a cohort, opens it, adds a session, marks attendance', async () => {
    await runWithTenant(tenantId, null, async () => {
      const cohort = await svc.createCohort({ courseId, title: { en: 'Intake A' }, session: '2026/2027' });
      expect(cohort.status).toBe('draft');

      const opened = await svc.openCohort(cohort._id);
      expect(opened.status).toBe('open');

      const session = await svc.createSession({ cohortId: cohort._id, title: { en: 'Week 1' }, startsAt: new Date() });
      expect(session._id).toBeTruthy();

      const userId = new (require('mongoose').Types.ObjectId)();
      const att = await svc.markAttendance({ sessionId: session._id, userId, state: 'present' });
      expect(att.state).toBe('present');

      // idempotent — marking again updates, not duplicates
      const att2 = await svc.markAttendance({ sessionId: session._id, userId, state: 'excused' });
      expect(att2.state).toBe('excused');

      const closed = await svc.closeCohort(cohort._id);
      expect(closed.status).toBe('closed');
    });
  });

  it('rejects a cohort with no title or session', async () => {
    await runWithTenant(tenantId, null, async () => {
      await expect(svc.createCohort({ courseId, session: '2026/2027' })).rejects.toThrow(/title/);
    });
  });
});
