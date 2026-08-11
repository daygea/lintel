'use strict';

/**
 * Deleting a course refuses while learners are enrolled, and otherwise removes the
 * whole tree: modules, lessons, blocks, quizzes, and its empty cohorts. Deleting a
 * module cascades its lessons and blocks.
 */

const {
  Tenant, User, Course, Module, Lesson, ContentBlock, Quiz, Cohort, Enrollment,
} = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const curriculum = require('../../src/services/curriculum.service');

let tenant, learner;
const as = (fn) => runWithTenant(tenant._id, learner._id, fn);

async function seedCourse() {
  return as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'C' }, status: 'active' });
    const mod = await Module.create({ courseId: course._id, title: { en: 'M' }, order: 0 });
    const lesson = await Lesson.create({ moduleId: mod._id, courseId: course._id, title: { en: 'L' }, order: 0 });
    await ContentBlock.create({ lessonId: lesson._id, type: 'rich_text', body: { en: 'x' }, order: 0 });
    await Quiz.create({ courseId: course._id, title: { en: 'Q' }, status: 'draft' });
    const cohort = await Cohort.create({ courseId: course._id, title: { en: 'Autumn' }, session: '2026/2027', status: 'draft' });
    return { course, mod, lesson, cohort };
  });
}

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-dcourse', name: 'Alpha', locales: ['en'], status: 'active' });
  learner = await User.create({ email: 'l@x.io', name: 'L', passwordHash: await User.hashPassword('x'.repeat(12)) });
});

it('refuses to delete a course with an enrolled learner', async () => {
  const { course, cohort } = await seedCourse();
  await as(() => Enrollment.create({ userId: learner._id, courseId: course._id, cohortId: cohort._id, status: 'active' }));
  await expect(as(() => curriculum.deleteCourse(course._id))).rejects.toThrow(/enrolled/i);
  expect(await as(() => Course.findById(course._id).exec())).toBeTruthy();
});

it('deletes an empty course and its whole tree', async () => {
  const { course } = await seedCourse();
  const result = await as(() => curriculum.deleteCourse(course._id));
  expect(result.deleted).toBe(true);
  expect(await as(() => Course.findById(course._id).exec())).toBeNull();
  expect(await as(() => Module.countDocuments({ courseId: course._id }).exec())).toBe(0);
  expect(await as(() => Lesson.countDocuments({ courseId: course._id }).exec())).toBe(0);
  expect(await as(() => Quiz.countDocuments({ courseId: course._id }).exec())).toBe(0);
  expect(await as(() => Cohort.countDocuments({ courseId: course._id }).exec())).toBe(0);
});

it('deletes a module and its lessons + blocks', async () => {
  const { mod, lesson } = await seedCourse();
  await as(() => curriculum.deleteModule(mod._id));
  expect(await as(() => Module.findById(mod._id).exec())).toBeNull();
  expect(await as(() => Lesson.findById(lesson._id).exec())).toBeNull();
  expect(await as(() => ContentBlock.countDocuments({ lessonId: lesson._id }).exec())).toBe(0);
});
