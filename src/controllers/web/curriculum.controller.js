'use strict';

const curriculumService = require('../../services/curriculum.service');
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
    res.render('curriculum/course', { tree, pick, locale: req.tenant.defaultLocale });
  } catch (err) {
    next(err);
  }
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
