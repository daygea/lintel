'use strict';

/**
 * createBlock sanitises a rich_text body before storing it (Oct-2026). The body is
 * later injected into the learner DOM as raw HTML, so the stored value must already
 * be clean — this is the single choke point, since blocks are created or deleted,
 * never edited.
 */

const { Tenant, User, Course, Module, Lesson, ContentBlock } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const { pick } = require('../../src/plugins/locale-map');
const curriculum = require('../../src/services/curriculum.service');

let tenant, author, lesson;
const as = (fn) => runWithTenant(tenant._id, author._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'sanitize-blk', name: 'Alpha', locales: ['en'], defaultLocale: 'en', status: 'active' });
  author = await User.create({ email: 'a@x.io', name: 'A', passwordHash: 'x', status: 'active' });
  await as(async () => {
    const course = await curriculum.createCourse({ code: 'C1', title: { en: 'C' } });
    const mod = await curriculum.createModule({ courseId: course._id, title: { en: 'M' } });
    lesson = await curriculum.createLesson({ moduleId: mod._id, title: { en: 'L' } });
  });
});

it('strips script and event handlers from a stored rich_text body, keeps formatting', async () => {
  const block = await as(() => curriculum.createBlock({
    lessonId: lesson._id,
    type: 'rich_text',
    body: { en: '<p><strong>Welcome</strong></p><script>steal()</script><p onclick="x()">hi</p>' },
  }));
  const stored = await as(() => ContentBlock.findById(block._id).exec());
  const html = pick(stored.body, 'en');
  expect(html).toContain('<strong>Welcome</strong>');
  expect(html).not.toContain('script');
  expect(html).not.toContain('steal');
  expect(html).not.toMatch(/onclick/i);
});

it('leaves a non-rich_text block body untouched', async () => {
  // A quiz/embed-style body is not HTML-rendered; sanitisation must not touch it.
  const block = await as(() => curriculum.createBlock({
    lessonId: lesson._id,
    type: 'embed',
    embedUrl: 'https://youtube.com/watch?v=abc',
  }));
  const stored = await as(() => ContentBlock.findById(block._id).exec());
  expect(stored.embedUrl).toBe('https://youtube.com/watch?v=abc');
});
