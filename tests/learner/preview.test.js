'use strict';

/**
 * Author "preview as a learner" (Oct-2026, P2). previewLessonFor returns a lesson's
 * blocks the way a learner sees them — but WITHOUT the eligibility gate (an author
 * isn't enrolled) and WITHOUT writing an access log (previewing is not accessing).
 */

const { Tenant, User, Course, Module, Lesson, ContentBlock, AccessLog } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const curriculum = require('../../src/services/curriculum.service');
const learner = require('../../src/services/learner.service');

let tenant, author, lesson;
const as = (fn) => runWithTenant(tenant._id, author._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'preview', name: 'P', locales: ['en'], defaultLocale: 'en', status: 'active' });
  author = await User.create({ email: 'a@x.io', name: 'A', passwordHash: 'x', status: 'active' });
  await as(async () => {
    const course = await curriculum.createCourse({ code: 'C1', title: { en: 'Course' } });
    const mod = await curriculum.createModule({ courseId: course._id, title: { en: 'M' } });
    lesson = await curriculum.createLesson({ moduleId: mod._id, title: { en: 'Lesson one' } });
    await ContentBlock.create({ lessonId: lesson._id, type: 'rich_text', body: { en: 'Hello learners' }, order: 0 });
  });
});

it('returns the lesson blocks without an eligibility gate', async () => {
  const data = await as(() => learner.previewLessonFor({ lessonId: lesson._id, userId: author._id }));
  expect(data.preview).toBe(true);
  expect(data.held).toBe(false);
  expect(data.blocks).toHaveLength(1);
  expect(data.blocks[0].type).toBe('rich_text');
});

it('writes no access log', async () => {
  await as(() => learner.previewLessonFor({ lessonId: lesson._id, userId: author._id }));
  const logs = await as(() => AccessLog.find({}).exec());
  expect(logs).toHaveLength(0);
});
