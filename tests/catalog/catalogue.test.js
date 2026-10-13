'use strict';

/**
 * Learner catalogue (Oct-2026, P1 discovery). Lists only catalog-visible courses
 * in the current tenant, joins each with its open cohorts, and marks the learner's
 * own applied/enrolled state — the data behind browse + search + filter.
 */

const mongoose = require('mongoose');
const { Tenant, User, Course, Cohort, Application, Enrollment } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const catalog = require('../../src/services/catalog.service');

let tenant, other, user;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'cat', name: 'Cat', locales: ['en'], defaultLocale: 'en' });
  other = await Tenant.create({ slug: 'oth', name: 'Oth', locales: ['en'] });
  user = await User.create({ email: 'l@x.io', name: 'L', passwordHash: 'x', status: 'active' });
});

async function course(data) {
  return as(() => Course.create(data));
}

it('lists only catalog-visible courses, never private ones', async () => {
  await course({ code: 'PUB', title: { en: 'Public course' }, visibility: 'catalog' });
  await course({ code: 'PRIV', title: { en: 'Private course' }, visibility: 'private' });

  const { courses } = await as(() => catalog.catalogue({ userId: user._id }));
  expect(courses.map((c) => c.code)).toEqual(['PUB']);
  expect(courses[0].title).toBe('Public course');
});

it('never leaks another tenant’s catalogue', async () => {
  await runWithTenant(other._id, user._id, () =>
    Course.create({ code: 'X', title: { en: 'Theirs' }, visibility: 'catalog' }));
  const { courses } = await as(() => catalog.catalogue({ userId: user._id }));
  expect(courses).toHaveLength(0);
});

it('attaches open cohorts and the learner’s applied/enrolled state', async () => {
  const c = await course({ code: 'C1', title: { en: 'Course one' }, visibility: 'catalog' });
  const openCohort = await as(() => Cohort.create({ courseId: c._id, title: { en: 'Jan intake' }, session: '2026/2027', status: 'open' }));
  await as(() => Cohort.create({ courseId: c._id, title: { en: 'Draft intake' }, session: '2026/2027', status: 'draft' }));
  await as(() => Application.create({ cohortId: openCohort._id, userId: user._id, status: 'submitted' }));

  const { courses } = await as(() => catalog.catalogue({ userId: user._id }));
  expect(courses).toHaveLength(1);
  expect(courses[0].hasOpen).toBe(true);
  expect(courses[0].openCohorts).toHaveLength(1);       // draft not listed
  expect(courses[0].openCohorts[0].title).toBe('Jan intake');
  expect(courses[0].openCohorts[0].applied).toBe(true);
});

it('marks a course the learner is already enrolled in', async () => {
  const c = await course({ code: 'C2', title: { en: 'Course two' }, visibility: 'catalog' });
  await as(() => Enrollment.create({ userId: user._id, cohortId: new mongoose.Types.ObjectId(), courseId: c._id, status: 'active' }));
  const { courses } = await as(() => catalog.catalogue({ userId: user._id }));
  expect(courses[0].enrolled).toBe(true);
});

it('builds a lowercased search string and the programme list', async () => {
  await course({ code: 'FIQH101', title: { en: 'Introduction to Fiqh' }, summary: { en: 'Foundations' }, visibility: 'catalog' });
  const { courses } = await as(() => catalog.catalogue({ userId: user._id }));
  expect(courses[0].search).toContain('introduction to fiqh');
  expect(courses[0].search).toContain('foundations');
});
