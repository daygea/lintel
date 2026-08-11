'use strict';

/**
 * Deleting a lesson removes it and its content blocks (the lesson's own content),
 * while leaving the underlying media assets in the library.
 */

const { Tenant, User, Course, Module, Lesson, ContentBlock } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const curriculum = require('../../src/services/curriculum.service');

let tenant, actor;
const as = (fn) => runWithTenant(tenant._id, actor._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-dl', name: 'Alpha', locales: ['en'], status: 'active' });
  actor = await User.create({ email: 'a@x.io', name: 'A', passwordHash: await User.hashPassword('x'.repeat(12)) });
});

it('deletes a lesson and cascades its content blocks', async () => {
  const { lessonId } = await as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'C' }, status: 'active' });
    const mod = await Module.create({ courseId: course._id, title: { en: 'M' }, order: 0 });
    const lesson = await Lesson.create({ moduleId: mod._id, courseId: course._id, title: { en: 'L' }, order: 0 });
    await ContentBlock.create({ lessonId: lesson._id, type: 'rich_text', body: { en: 'hi' }, order: 0 });
    await ContentBlock.create({ lessonId: lesson._id, type: 'rich_text', body: { en: 'bye' }, order: 1 });
    return { lessonId: lesson._id };
  });

  const result = await as(() => curriculum.deleteLesson(lessonId));
  expect(result.deleted).toBe(true);
  expect(await as(() => Lesson.findById(lessonId).exec())).toBeNull();
  expect(await as(() => ContentBlock.countDocuments({ lessonId }).exec())).toBe(0);
});
