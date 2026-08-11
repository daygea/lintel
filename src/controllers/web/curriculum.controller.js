'use strict';

const curriculumService = require('../../services/curriculum.service');
const eligibilityService = require('../../services/eligibility.service');
const mediaService = require('../../services/media.service');
const storage = require('../../lib/storage');
const courseCopyService = require('../../services/course-copy.service');
const searchService = require('../../services/search.service');
const { pick } = require('../../plugins/locale-map');

exports.listCourses = async (req, res, next) => {
  try {
    const courses = await curriculumService.listCourses();
    res.render('curriculum/courses', { courses, pick, locale: req.tenant.defaultLocale });
  } catch (err) {
    next(err);
  }
};

exports.showCourse = async (req, res, next) => {
  try {
    const tree = await curriculumService.getCourseTree(req.params.id);
    const images = await mediaService.listAssets({ kind: 'image', status: 'ready' }).catch(() => []);
    const imageChoices = await Promise.all(
      images.map(async (a) => ({ id: String(a._id), filename: a.filename, url: await storage.signGet(a.storageKey) }))
    );
    let coverUrl = null;
    if (tree.course.coverAssetId) {
      const cover = await mediaService.getAsset(tree.course.coverAssetId).catch(() => null);
      if (cover && cover.storageKey) coverUrl = await storage.signGet(cover.storageKey);
    }
    res.render('curriculum/course', {
      tree, imageChoices, coverUrl,
      coverAssetId: tree.course.coverAssetId ? String(tree.course.coverAssetId) : null,
      saved: req.query.cover || null,
      error: req.query.err || null,
      pick, locale: req.tenant.defaultLocale,
    });
  } catch (err) {
    next(err);
  }
};

exports.setCover = async (req, res, next) => {
  try {
    await curriculumService.updateCourse(req.params.id, { coverAssetId: req.body.assetId || null });
    res.redirect(`/courses/${req.params.id}?cover=1`);
  } catch (err) { next(err); }
};

exports.createCourse = async (req, res, next) => {
  try {
    const { code, session, ...rest } = req.body;
    const course = await curriculumService.createCourse({
      code,
      session,
      title: localeFromForm(rest, 'title', req.tenant.locales),
      summary: localeFromForm(rest, 'summary', req.tenant.locales),
    });
    res.redirect(`/courses/${course._id}`);
  } catch (err) {
    next(err);
  }
};

exports.copyCourse = async (req, res, next) => {
  try {
    const copy = await courseCopyService.copyCourse(req.params.id, {
      session: req.body.session,
      code: req.body.code,
    });
    res.redirect(`/courses/${copy._id}`);
  } catch (err) {
    next(err);
  }
};

exports.createModule = async (req, res, next) => {
  try {
    await curriculumService.createModule({
      courseId: req.params.id,
      title: localeFromForm(req.body, 'title', req.tenant.locales),
    });
    res.redirect(`/courses/${req.params.id}`);
  } catch (err) { next(err); }
};

exports.createLesson = async (req, res, next) => {
  try {
    await curriculumService.createLesson({
      moduleId: req.body.moduleId,
      title: localeFromForm(req.body, 'title', req.tenant.locales),
      estimatedMinutes: req.body.estimatedMinutes ? Number(req.body.estimatedMinutes) : undefined,
    });
    res.redirect(`/courses/${req.params.id}`);
  } catch (err) { next(err); }
};

exports.deleteLesson = async (req, res, next) => {
  try {
    await curriculumService.deleteLesson(req.params.lessonId);
    res.redirect(`/courses/${req.params.id}`);
  } catch (err) { next(err); }
};

exports.deleteModule = async (req, res, next) => {
  try {
    await curriculumService.deleteModule(req.params.moduleId);
    res.redirect(`/courses/${req.params.id}`);
  } catch (err) { next(err); }
};

exports.deleteCourse = async (req, res, next) => {
  try {
    await curriculumService.deleteCourse(req.params.id);
    res.redirect('/courses');
  } catch (err) {
    if (err.status === 422 || err.name === 'ValidationError') {
      return res.redirect(`/courses/${req.params.id}?err=${encodeURIComponent(err.message)}`);
    }
    next(err);
  }
};

// @parity-exempt eligibilityService.listPolicies — this is a web-view concern:
// the lesson page renders a policy <select>, so it reads the policy list to build
// the dropdown. The JSON API returns the lesson as data; an API client fetches the
// policy list from GET /api/v1/policies (which exists) rather than having it inlined.
exports.showLesson = async (req, res, next) => {
  try {
    const lesson = await curriculumService.getLesson(req.params.lessonId);
    if (!lesson) return res.status(404).render('error', { status: 404, message: 'Lesson not found' });
    const blocks = await curriculumService.listBlocks(req.params.lessonId);
    const policies = await eligibilityService.listPolicies();
    const assets = await mediaService.listAssets({ status: 'ready' }).catch(() => []);
    res.render('curriculum/lesson', {
      lesson, blocks, courseId: req.params.id, policies, assets, pick,
      locale: req.tenant.defaultLocale, error: null,
    });
  } catch (err) { next(err); }
};

exports.createBlock = async (req, res, next) => {
  try {
    const type = req.body.type;
    const block = { lessonId: req.params.lessonId, type };
    if (type === 'rich_text') {
      block.body = localeFromForm(req.body, 'body', req.tenant.locales);
    } else if (type === 'embed') {
      block.embedUrl = req.body.embedUrl || undefined;
    } else if (['audio', 'video', 'pdf', 'image'].includes(type)) {
      block.assetId = req.body.assetId || undefined; // a chosen uploaded asset
    }
    await curriculumService.createBlock(block);
    res.redirect(`/courses/${req.params.id}/lessons/${req.params.lessonId}`);
  } catch (err) { next(err); }
};

exports.setLessonPolicy = async (req, res, next) => {
  try {
    await curriculumService.setLessonPolicy(req.params.lessonId, req.body.eligibilityPolicyId);
    res.redirect(`/courses/${req.params.id}/lessons/${req.params.lessonId}`);
  } catch (err) { next(err); }
};

exports.search = async (req, res, next) => {
  try {
    const results = await searchService.search(req.query.q);
    res.render('curriculum/search', {
      q: req.query.q || '',
      results,
      pick,
      locale: req.tenant.defaultLocale,
    });
  } catch (err) {
    next(err);
  }
};

/** Form fields arrive as title_en, title_yo. Rebuild the locale map. */
function localeFromForm(body, field, locales) {
  const map = {};
  for (const loc of locales) {
    const value = body[`${field}_${loc}`];
    if (value) map[loc] = value;
  }
  return Object.keys(map).length ? map : undefined;
}
