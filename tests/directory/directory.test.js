'use strict';

/**
 * Sprint 10 exit criteria. The assertions that matter:
 *   - an UNPUBLISHED listing is invisible (fail closed) — publicView returns null
 *   - publication is an ACT: nothing is public until publish() stamps it
 *   - the public projection carries ONLY safe fields — course TITLES, never
 *     content, never learners, never anything the engine guards
 *   - a featured course that is NOT directory-visible is absent (two gates)
 *   - the handle namespace is global (two tenants cannot share one)
 */

const {
  Tenant, User, Membership, Course, Module, Lesson, DirectoryListing, Enrollment, Cohort,
} = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const dir = require('../../src/services/directory.service');

let tenant, staff, course, hiddenCourse;
const as = (fn) => runWithTenant(tenant._id, staff._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'oiss', name: 'Institute', locales: ['en'] });
  staff = await User.create({ email: 's@x.com', name: 'Admin', passwordHash: 'x', status: 'active' });
  await as(async () => {
    await Membership.create({ userId: staff._id, roles: ['admin'], status: 'active' });
    course = await Course.create({ code: 'C1', title: { en: 'Public Programme' }, visibility: 'directory' });
    hiddenCourse = await Course.create({ code: 'C2', title: { en: 'Private Programme' }, visibility: 'private' });
    // Real content under the public course — must NEVER surface.
    const mod = await Module.create({ courseId: course._id, title: { en: 'Secret Module' } });
    await Lesson.create({ moduleId: mod._id, courseId: course._id, title: { en: 'Secret Lesson' } });
  });
});

describe('fail closed', () => {
  it('an unpublished listing is invisible', async () => {
    await as(() => dir.upsertListing({ handle: 'obatala', displayName: 'Obatala Institute' }));
    const view = await dir.publicView('obatala');
    expect(view).toBeNull(); // not published = not found, indistinguishable from absent
  });

  it('a non-existent handle returns null', async () => {
    expect(await dir.publicView('nobody')).toBeNull();
  });
});

describe('publication is an act', () => {
  it('becomes visible only after publish(), and hides again on unpublish()', async () => {
    await as(() => dir.upsertListing({
      handle: 'obatala', displayName: 'Obatala Institute',
      tagline: { en: 'Sacred studies' }, featuredCourseIds: [course._id],
    }));
    expect(await dir.publicView('obatala')).toBeNull();

    await as(() => dir.publish());
    const view = await dir.publicView('obatala');
    expect(view).not.toBeNull();
    expect(view.displayName).toBe('Obatala Institute');

    await as(() => dir.unpublish());
    expect(await dir.publicView('obatala')).toBeNull();
  });
});

describe('the public projection leaks nothing', () => {
  it('carries course TITLES only — never content, learners, or guarded data', async () => {
    await as(async () => {
      // enrol a learner — must not appear anywhere in the public view
      const learner = await User.create({ email: 'l@x.com', name: 'Learner', passwordHash: 'x', status: 'active' });
      const cohort = await Cohort.create({ courseId: course._id, title: { en: 'R' }, session: '2026/2027' });
      await Enrollment.create({ userId: learner._id, courseId: course._id, cohortId: cohort._id, status: 'active' });

      await dir.upsertListing({
        handle: 'obatala', displayName: 'Obatala Institute',
        featuredCourseIds: [course._id, hiddenCourse._id], // both featured...
      });
      await dir.publish();
    });

    const view = await dir.publicView('obatala');

    // Only the directory-visible course appears — the private one is gated out
    // even though it was featured (two independent gates).
    expect(view.courses).toHaveLength(1);
    expect(view.courses[0].code).toBe('C1');

    // The course object carries a title and code, and NOTHING else.
    expect(Object.keys(view.courses[0]).sort()).toEqual(['code', 'title']);

    // The whole view exposes no learners, no modules, no lessons, no counts.
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain('Secret Module');
    expect(serialised).not.toContain('Secret Lesson');
    expect(serialised).not.toContain('Learner');
    expect(serialised).not.toContain('Private Programme');
    expect(view).not.toHaveProperty('learners');
    expect(view).not.toHaveProperty('enrollments');
  });
});

describe('global handle namespace', () => {
  it('two tenants cannot share a handle', async () => {
    await as(() => dir.upsertListing({ handle: 'shared', displayName: 'First' }));

    const other = await Tenant.create({ slug: 'other', name: 'Other', locales: ['en'] });
    const otherStaff = await User.create({ email: 'o@x.com', name: 'O', passwordHash: 'x', status: 'active' });
    await expect(
      runWithTenant(other._id, otherStaff._id, () => dir.upsertListing({ handle: 'shared', displayName: 'Second' }))
    ).rejects.toThrow();
  });
});
