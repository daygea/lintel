'use strict';

const curriculumService = require('../../services/curriculum.service');
const courseCopyService = require('../../services/course-copy.service');
const searchService = require('../../services/search.service');

exports.listCourses = async (req, res, next) => {
  try {
    res.json({ courses: await curriculumService.listCourses() });
  } catch (err) {
    next(err);
  }
};

exports.showCourse = async (req, res, next) => {
  try {
    res.json(await curriculumService.getCourseTree(req.params.id));
  } catch (err) {
    next(err);
  }
};

exports.createCourse = async (req, res, next) => {
  try {
    res.status(201).json({ course: await curriculumService.createCourse(req.body) });
  } catch (err) {
    next(err);
  }
};

exports.updateCourse = async (req, res, next) => {
  try {
    res.json({ course: await curriculumService.updateCourse(req.params.id, req.body) });
  } catch (err) {
    next(err);
  }
};

exports.copyCourse = async (req, res, next) => {
  try {
    const copy = await courseCopyService.copyCourse(req.params.id, req.body);
    res.status(201).json({ course: copy });
  } catch (err) {
    next(err);
  }
};

exports.createModule = async (req, res, next) => {
  try {
    res.status(201).json({ module: await curriculumService.createModule(req.body) });
  } catch (err) {
    next(err);
  }
};

exports.createLesson = async (req, res, next) => {
  try {
    res.status(201).json({ lesson: await curriculumService.createLesson(req.body) });
  } catch (err) {
    next(err);
  }
};

exports.createBlock = async (req, res, next) => {
  try {
    res.status(201).json({ block: await curriculumService.createBlock(req.body) });
  } catch (err) {
    next(err);
  }
};

exports.setLessonPolicy = async (req, res, next) => {
  try {
    const lesson = await curriculumService.setLessonPolicy(req.params.lessonId, req.body.eligibilityPolicyId);
    res.json({ lesson });
  } catch (err) { next(err); }
};

exports.showLesson = async (req, res, next) => {
  try {
    const lesson = await curriculumService.getLesson(req.params.lessonId);
    if (!lesson) return res.status(404).json({ error: { message: 'Lesson not found' } });
    const blocks = await curriculumService.listBlocks(req.params.lessonId);
    res.json({ lesson, blocks });
  } catch (err) { next(err); }
};

exports.reorder = async (req, res, next) => {
  try {
    await curriculumService.reorder(req.body.model, req.body.ids);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

exports.listPrograms = async (req, res, next) => {
  try {
    res.json({ programs: await curriculumService.listPrograms() });
  } catch (err) {
    next(err);
  }
};

exports.createProgram = async (req, res, next) => {
  try {
    res.status(201).json({ program: await curriculumService.createProgram(req.body) });
  } catch (err) {
    next(err);
  }
};

exports.search = async (req, res, next) => {
  try {
    res.json(await searchService.search(req.query.q));
  } catch (err) {
    next(err);
  }
};
