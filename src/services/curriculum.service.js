'use strict';

const { Program, Course, Module, Lesson, ContentBlock, AuditLog } = require('../models');
const { ValidationError } = require('../lib/errors');
const { currentUserId } = require('../lib/context');

/* ------------------------------------------------------------------ programs */

const listPrograms = () => Program.find({}).sort({ code: 1 }).exec();

async function createProgram({ code, title, description }) {
  if (!code || !title) throw new ValidationError('A programme needs a code and a title');
  const program = await Program.create({ code, title, description });
  await audit('program.created', 'Program', program._id, { code });
  return program;
}

/* ------------------------------------------------------------------- courses */

const listCourses = (filter = {}) =>
  Course.find(filter).sort({ order: 1, code: 1 }).exec();

const getCourse = (id) => Course.findById(id).exec();

async function createCourse({ programId, code, title, summary, session }) {
  if (!code || !title) throw new ValidationError('A course needs a code and a title');
  const course = await Course.create({ programId, code, title, summary, session });
  await audit('course.created', 'Course', course._id, { code, session });
  return course;
}

async function updateCourse(id, patch) {
  const course = await Course.findByIdAndUpdate(id, patch, { new: true, runValidators: true }).exec();
  if (!course) throw new ValidationError('No such course');
  await audit('course.updated', 'Course', course._id, { fields: Object.keys(patch) });
  return course;
}

/**
 * The full tree of a course, ordered. One query per level rather than N+1 —
 * a course with 12 modules and 90 lessons is 4 queries, not 103.
 */
async function getCourseTree(courseId) {
  const course = await Course.findById(courseId).exec();
  if (!course) throw new ValidationError('No such course');

  const modules = await Module.find({ courseId }).sort({ order: 1 }).exec();
  const lessons = await Lesson.find({ courseId }).sort({ order: 1 }).exec();
  const blocks = await ContentBlock.find({
    lessonId: { $in: lessons.map((l) => l._id) },
  })
    .sort({ order: 1 })
    .exec();

  const blocksByLesson = groupBy(blocks, 'lessonId');
  const lessonsByModule = groupBy(lessons, 'moduleId');

  return {
    course,
    modules: modules.map((m) => ({
      module: m,
      lessons: (lessonsByModule[String(m._id)] || []).map((l) => ({
        lesson: l,
        blocks: blocksByLesson[String(l._id)] || [],
      })),
    })),
  };
}

/* ------------------------------------------------- modules, lessons, blocks */

async function createModule({ courseId, title, order }) {
  if (!courseId || !title) throw new ValidationError('A module needs a course and a title');
  return Module.create({ courseId, title, order: order ?? (await nextOrder(Module, { courseId })) });
}

async function createLesson({ moduleId, title, order, estimatedMinutes }) {
  const mod = await Module.findById(moduleId).exec();
  if (!mod) throw new ValidationError('No such module');
  return Lesson.create({
    moduleId,
    courseId: mod.courseId,
    title,
    estimatedMinutes,
    order: order ?? (await nextOrder(Lesson, { moduleId })),
  });
}

async function createBlock({ lessonId, type, body, assetId, embedUrl, archiveRef, order }) {
  const lesson = await Lesson.findById(lessonId).exec();
  if (!lesson) throw new ValidationError('No such lesson');
  return ContentBlock.create({
    lessonId,
    type,
    body,
    assetId,
    embedUrl,
    archiveRef,
    order: order ?? (await nextOrder(ContentBlock, { lessonId })),
  });
}

async function reorder(model, ids) {
  const models = { Module, Lesson, ContentBlock };
  const M = models[model];
  if (!M) throw new ValidationError(`Cannot reorder ${model}`);
  await Promise.all(ids.map((id, i) => M.updateOne({ _id: id }, { order: i }).exec()));
  return true;
}

/* ------------------------------------------------------------------- helpers */

async function nextOrder(Model, filter) {
  const last = await Model.findOne(filter).sort({ order: -1 }).exec();
  return last ? last.order + 1 : 0;
}

function groupBy(docs, key) {
  return docs.reduce((acc, d) => {
    const k = String(d[key]);
    (acc[k] = acc[k] || []).push(d);
    return acc;
  }, {});
}

const audit = (action, subjectType, subjectId, meta) =>
  AuditLog.create({ actorUserId: currentUserId(), action, subjectType, subjectId, meta });

module.exports = {
  listPrograms,
  createProgram,
  listCourses,
  getCourse,
  getCourseTree,
  createCourse,
  updateCourse,
  createModule,
  createLesson,
  createBlock,
  reorder,
};
