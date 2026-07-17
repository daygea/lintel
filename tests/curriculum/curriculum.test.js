'use strict';

/**
 * Sprint 1 exit criteria, executable.
 *
 * The interesting assertions are not "CRUD works". They are:
 *   - a new block is private WITHOUT anyone setting it (fail closed)
 *   - searching without tone marks finds text that has them
 *   - a copied course is private even when its source was published
 *   - an archive reference above consent tier 1 CANNOT be made previewable,
 *     even by a tenant admin who insists
 */

const { Tenant, User, Course, Module, Lesson, ContentBlock } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const curriculum = require('../../src/services/curriculum.service');
const { copyCourse } = require('../../src/services/course-copy.service');
const { search } = require('../../src/services/search.service');

let tenant, user;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({
    slug: 'inst',
    name: 'An Institute',
    locales: ['en', 'yo'],
    defaultLocale: 'en',
  });
  user = await User.create({
    email: 'a@example.com',
    name: 'A',
    passwordHash: 'x',
    status: 'active',
  });
});

describe('fail closed', () => {
  it('a new course is private without anyone setting it', async () => {
    const course = await as(() =>
      curriculum.createCourse({ code: 'C101', title: { en: 'A course' }, session: '2026/2027' })
    );
    expect(course.visibility).toBe('private');
  });

  it('a new content block is private without anyone setting it', async () => {
    const block = await as(async () => {
      const c = await curriculum.createCourse({ code: 'C101', title: { en: 'C' } });
      const m = await curriculum.createModule({ courseId: c._id, title: { en: 'M' } });
      const l = await curriculum.createLesson({ moduleId: m._id, title: { en: 'L' } });
      return curriculum.createBlock({ lessonId: l._id, type: 'rich_text', body: { en: 'text' } });
    });
    expect(block.visibility).toBe('private');
    expect(block.previewable).toBe(false);
  });
});

describe('archive references', () => {
  it('refuse to be made previewable above consent tier 1', async () => {
    await expect(
      as(async () => {
        const c = await curriculum.createCourse({ code: 'C101', title: { en: 'C' } });
        const m = await curriculum.createModule({ courseId: c._id, title: { en: 'M' } });
        const l = await curriculum.createLesson({ moduleId: m._id, title: { en: 'L' } });
        const block = await curriculum.createBlock({
          lessonId: l._id,
          type: 'archive_ref',
          archiveRef: {
            archiveId: 'arc',
            accessionNumber: 'ARC/2026/00417',
            consentTier: 3,
            tkLabels: ['TK Attribution'],
          },
        });
        block.previewable = true;
        return block.save();
      })
    ).rejects.toThrow(/did not agree to publication/);
  });

  it('allow preview at tier 1', async () => {
    const block = await as(async () => {
      const c = await curriculum.createCourse({ code: 'C101', title: { en: 'C' } });
      const m = await curriculum.createModule({ courseId: c._id, title: { en: 'M' } });
      const l = await curriculum.createLesson({ moduleId: m._id, title: { en: 'L' } });
      const b = await curriculum.createBlock({
        lessonId: l._id,
        type: 'archive_ref',
        archiveRef: { archiveId: 'arc', accessionNumber: 'ARC/2026/00001', consentTier: 1 },
      });
      b.previewable = true;
      return b.save();
    });
    expect(block.previewable).toBe(true);
  });
});

describe('search', () => {
  it('finds diacritics without diacritics', async () => {
    await as(async () => {
      const c = await curriculum.createCourse({ code: 'YLO112', title: { en: 'Oral tradition' } });
      const m = await curriculum.createModule({ courseId: c._id, title: { en: 'M1' } });
      await curriculum.createLesson({
        moduleId: m._id,
        title: { en: 'Recitation of Oríkì', yo: 'Ìkíni Oríkì' },
      });
    });

    const plain = await as(() => search('oriki'));
    expect(plain.lessons).toHaveLength(1);

    const marked = await as(() => search('Oríkì'));
    expect(marked.lessons).toHaveLength(1);
  });

  it('displays diacritics correctly even though it searched without them', async () => {
    await as(async () => {
      const c = await curriculum.createCourse({ code: 'YLO112', title: { en: 'C' } });
      const m = await curriculum.createModule({ courseId: c._id, title: { en: 'M' } });
      await curriculum.createLesson({ moduleId: m._id, title: { en: 'Àyànmọ́ and destiny' } });
    });
    const results = await as(() => search('ayanmo'));
    expect(results.lessons[0].title.get('en')).toBe('Àyànmọ́ and destiny');
  });
});

describe('course copy', () => {
  it('clones the whole tree into a new session', async () => {
    const copy = await as(async () => {
      const c = await curriculum.createCourse({
        code: 'C214',
        title: { en: 'Ceremonial ethics' },
        session: '2026/2027',
      });
      const m = await curriculum.createModule({ courseId: c._id, title: { en: 'Module 1' } });
      const l = await curriculum.createLesson({ moduleId: m._id, title: { en: 'Lesson 1' } });
      await curriculum.createBlock({ lessonId: l._id, type: 'rich_text', body: { en: 'Body' } });
      return copyCourse(c._id, { session: '2027/2028' });
    });

    expect(copy.session).toBe('2027/2028');
    expect(copy.version).toBe(2);

    const tree = await as(() => curriculum.getCourseTree(copy._id));
    expect(tree.modules).toHaveLength(1);
    expect(tree.modules[0].lessons).toHaveLength(1);
    expect(tree.modules[0].lessons[0].blocks).toHaveLength(1);
  });

  it('makes the copy private even when the source was published', async () => {
    const copy = await as(async () => {
      const c = await curriculum.createCourse({
        code: 'C101',
        title: { en: 'C' },
        session: '2026/2027',
      });
      await curriculum.updateCourse(c._id, { visibility: 'catalog', status: 'active' });
      return copyCourse(c._id, { session: '2027/2028' });
    });

    expect(copy.visibility).toBe('private');
    expect(copy.status).toBe('draft');
  });

  it('copies an archive reference as a reference, never as media', async () => {
    const blocks = await as(async () => {
      const c = await curriculum.createCourse({ code: 'C1', title: { en: 'C' }, session: '2026/2027' });
      const m = await curriculum.createModule({ courseId: c._id, title: { en: 'M' } });
      const l = await curriculum.createLesson({ moduleId: m._id, title: { en: 'L' } });
      await curriculum.createBlock({
        lessonId: l._id,
        type: 'archive_ref',
        archiveRef: {
          archiveId: 'oiss',
          accessionNumber: 'ARC/2026/00417',
          consentTier: 3,
          tkLabels: ['TK Community Use Only'],
        },
      });
      const copy = await copyCourse(c._id, { session: '2027/2028' });
      const lessons = await Lesson.find({ courseId: copy._id }).exec();
      return ContentBlock.find({ lessonId: lessons[0]._id }).exec();
    });

    expect(blocks[0].archiveRef.accessionNumber).toBe('ARC/2026/00417');
    expect(blocks[0].archiveRef.consentTier).toBe(3);
    expect(blocks[0].archiveRef.tkLabels).toContain('TK Community Use Only');
    expect(blocks[0].previewable).toBe(false);
  });

  it('refuses to copy without a session', async () => {
    await expect(
      as(async () => {
        const c = await curriculum.createCourse({ code: 'C1', title: { en: 'C' } });
        return copyCourse(c._id, {});
      })
    ).rejects.toThrow(/needs a session/);
  });
});

describe('tenant isolation still holds', () => {
  it('a course created by one institute is invisible to another', async () => {
    await as(() => curriculum.createCourse({ code: 'C1', title: { en: 'Ours' } }));

    const other = await Tenant.create({ slug: 'other', name: 'Other Institute' });
    const found = await runWithTenant(other._id, user._id, () => Course.find({}).exec());
    expect(found).toHaveLength(0);
  });
});
