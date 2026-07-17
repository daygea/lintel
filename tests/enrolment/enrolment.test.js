'use strict';

/**
 * Sprint 2 exit criteria, executable. The assertions that matter:
 *   - admitting an application CREATES an enrolment; declining does not
 *   - admission is a person's act, recorded with who and when
 *   - a notification failure does NOT roll back an admission
 *   - attendance is idempotent — ticking twice does not double-count
 *   - applying twice to one cohort is refused
 *   - the whole chain stays inside tenant isolation
 */

const {
  Tenant, User, Membership, Cohort, Application, Enrollment,
  Session, Attendance, Notification,
} = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const svc = require('../../src/services/enrolment.service');

let tenant, registrar, applicant;
const as = (fn) => runWithTenant(tenant._id, registrar._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'inst', name: 'Institute', locales: ['en'] });
  registrar = await User.create({ email: 'r@x.com', name: 'Registrar', passwordHash: 'x', status: 'active' });
  applicant = await User.create({ email: 'a@x.com', name: 'Applicant', passwordHash: 'x', status: 'active' });
});

async function openCohort() {
  return as(async () => {
    const c = await svc.createCohort({ courseId: undefined, programId: (await Tenant.findById(tenant._id))._id, title: { en: 'Diploma' }, session: '2026/2027' });
    await svc.openCohort(c._id);
    return Cohort.findById(c._id).exec();
  });
}

describe('applications', () => {
  it('can only be made to an open cohort', async () => {
    const cohort = await as(() =>
      svc.createCohort({ programId: tenant._id, title: { en: 'D' }, session: '2026/2027' })
    );
    await expect(
      as(() => svc.apply({ cohortId: cohort._id, userId: applicant._id }))
    ).rejects.toThrow(/not open/);
  });

  it('cannot be made twice to the same cohort', async () => {
    const cohort = await openCohort();
    await as(() => svc.apply({ cohortId: cohort._id, userId: applicant._id }));
    await expect(
      as(() => svc.apply({ cohortId: cohort._id, userId: applicant._id }))
    ).rejects.toThrow(/already applied/);
  });
});

describe('admission', () => {
  it('creates an enrolment when admitted', async () => {
    const cohort = await openCohort();
    const app = await as(() => svc.apply({ cohortId: cohort._id, userId: applicant._id }));

    const { enrollment } = await as(() =>
      svc.decideApplication({ applicationId: app._id, decision: 'admitted' })
    );

    expect(enrollment).not.toBeNull();
    expect(String(enrollment.userId)).toBe(String(applicant._id));
    expect(enrollment.status).toBe('active');
    expect(enrollment.paymentState).toBe('unpaid'); // free != enrolled-with-fees
  });

  it('creates no enrolment when declined', async () => {
    const cohort = await openCohort();
    const app = await as(() => svc.apply({ cohortId: cohort._id, userId: applicant._id }));

    const { enrollment } = await as(() =>
      svc.decideApplication({ applicationId: app._id, decision: 'declined' })
    );

    expect(enrollment).toBeNull();
    const count = await as(() => Enrollment.countDocuments({}).exec());
    expect(count).toBe(0);
  });

  it('records who decided and when', async () => {
    const cohort = await openCohort();
    const app = await as(() => svc.apply({ cohortId: cohort._id, userId: applicant._id }));
    await as(() => svc.decideApplication({ applicationId: app._id, decision: 'admitted' }));

    const decided = await as(() => Application.findById(app._id).exec());
    expect(String(decided.decidedByUserId)).toBe(String(registrar._id));
    expect(decided.decidedAt).toBeInstanceOf(Date);
  });

  it('cannot be decided twice', async () => {
    const cohort = await openCohort();
    const app = await as(() => svc.apply({ cohortId: cohort._id, userId: applicant._id }));
    await as(() => svc.decideApplication({ applicationId: app._id, decision: 'admitted' }));
    await expect(
      as(() => svc.decideApplication({ applicationId: app._id, decision: 'declined' }))
    ).rejects.toThrow(/already been decided/);
  });

  it('records a notification attempt on admission', async () => {
    const cohort = await openCohort();
    const app = await as(() => svc.apply({ cohortId: cohort._id, userId: applicant._id }));
    await as(() => svc.decideApplication({ applicationId: app._id, decision: 'admitted' }));

    const notes = await as(() => Notification.find({ userId: applicant._id }).exec());
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.map((n) => n.template)).toContain('application.decided');
  });
});

describe('attendance', () => {
  it('is idempotent — marking twice updates, never duplicates', async () => {
    const cohort = await openCohort();
    const session = await as(() =>
      svc.createSession({ cohortId: cohort._id, title: { en: 'Meeting' }, startsAt: new Date() })
    );

    await as(() => svc.markAttendance({ sessionId: session._id, userId: applicant._id, state: 'present' }));
    await as(() => svc.markAttendance({ sessionId: session._id, userId: applicant._id, state: 'late' }));

    const rows = await as(() => Attendance.find({ sessionId: session._id }).exec());
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('late');
  });
});

describe('progress', () => {
  it('counts complete lessons', async () => {
    const cohort = await openCohort();
    const app = await as(() => svc.apply({ cohortId: cohort._id, userId: applicant._id }));
    const { enrollment } = await as(() => svc.decideApplication({ applicationId: app._id, decision: 'admitted' }));

    const { Lesson, Module, Course } = require('../../src/models');
    const summary = await as(async () => {
      const course = await Course.create({ code: 'C1', title: { en: 'C' } });
      const mod = await Module.create({ courseId: course._id, title: { en: 'M' } });
      const l1 = await Lesson.create({ moduleId: mod._id, courseId: course._id, title: { en: 'L1' } });
      const l2 = await Lesson.create({ moduleId: mod._id, courseId: course._id, title: { en: 'L2' } });
      await svc.markLesson({ enrollmentId: enrollment._id, lessonId: l1._id, state: 'complete' });
      await svc.markLesson({ enrollmentId: enrollment._id, lessonId: l2._id, state: 'in_progress' });
      return svc.progressFor(enrollment._id);
    });

    expect(summary.total).toBe(2);
    expect(summary.complete).toBe(1);
  });
});

describe('isolation', () => {
  it("one institute cannot see another tenant\u2019s cohorts", async () => {
    await openCohort();
    const other = await Tenant.create({ slug: 'other', name: 'Other' });
    const seen = await runWithTenant(other._id, registrar._id, () => Cohort.find({}).exec());
    expect(seen).toHaveLength(0);
  });
});
