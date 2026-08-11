'use strict';

const {
  Program, Course, Module, Lesson, ContentBlock, AuditLog,
  Cohort, Session, Application, FeeSchedule, Group, Enrollment,
  Quiz, QuizAttempt, LineItem, Score,
} = require('../models');
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
const getLesson = (id) => Lesson.findById(id).exec();

async function setLessonPolicy(lessonId, eligibilityPolicyId) {
  const lesson = await Lesson.findById(lessonId).exec();
  if (!lesson) throw new ValidationError('No such lesson');
  // Empty string clears the policy (the lesson becomes open teaching again).
  lesson.eligibilityPolicyId = eligibilityPolicyId || undefined;
  await lesson.save();
  return lesson;
}
const listBlocks = (lessonId) => ContentBlock.find({ lessonId }).sort({ order: 1 }).exec();

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

/**
 * Delete a lesson and its content blocks. The blocks are the lesson's own content
 * (references, not the underlying media assets — those live in the media library
 * and are managed there). Access logs are append-only and left untouched.
 */
async function deleteLesson(lessonId) {
  const lesson = await Lesson.findById(lessonId).exec();
  if (!lesson) throw new ValidationError('No such lesson');
  await ContentBlock.deleteMany({ lessonId }).exec();
  await Lesson.deleteOne({ _id: lessonId }).exec();
  await AuditLog.create({
    actorUserId: currentUserId(), action: 'lesson.deleted',
    subjectType: 'Lesson', subjectId: lessonId, meta: { courseId: lesson.courseId },
  });
  return { deleted: true, courseId: lesson.courseId };
}

/** Delete a module and the lessons (with their blocks) under it. */
async function deleteModule(moduleId) {
  const mod = await Module.findById(moduleId).exec();
  if (!mod) throw new ValidationError('No such module');
  const lessonIds = (await Lesson.find({ moduleId }).select('_id').exec()).map((l) => l._id);
  if (lessonIds.length) await ContentBlock.deleteMany({ lessonId: { $in: lessonIds } }).exec();
  await Lesson.deleteMany({ moduleId }).exec();
  await Module.deleteOne({ _id: moduleId }).exec();
  await AuditLog.create({
    actorUserId: currentUserId(), action: 'module.deleted',
    subjectType: 'Module', subjectId: moduleId, meta: { courseId: mod.courseId, lessons: lessonIds.length },
  });
  return { deleted: true, courseId: mod.courseId };
}

/**
 * Delete a course and everything it owns: modules, lessons and their blocks,
 * quizzes and their attempts, the quiz gradebook line items and scores, and its
 * (empty) cohorts with their config. Refuses while any learner is enrolled — you
 * delete the cohorts first (which is itself guarded), so no enrolment is ever
 * orphaned. Media assets stay in the library; append-only records are untouched.
 */
async function deleteCourse(courseId) {
  const course = await Course.findById(courseId).exec();
  if (!course) throw new ValidationError('No such course');

  const enrolled = await Enrollment.countDocuments({ courseId }).exec();
  if (enrolled > 0) {
    throw new ValidationError(
      `${enrolled} learner${enrolled === 1 ? ' is' : 's are'} enrolled in this course. Delete its cohorts (which unenrols learners) before deleting the course.`
    );
  }

  const lessonIds = (await Lesson.find({ courseId }).select('_id').exec()).map((l) => l._id);
  if (lessonIds.length) await ContentBlock.deleteMany({ lessonId: { $in: lessonIds } }).exec();
  await Lesson.deleteMany({ courseId }).exec();
  await Module.deleteMany({ courseId }).exec();

  const quizIds = (await Quiz.find({ courseId }).select('_id').exec()).map((q) => q._id);
  if (quizIds.length) await QuizAttempt.deleteMany({ quizId: { $in: quizIds } }).exec();
  await Quiz.deleteMany({ courseId }).exec();

  const liIds = (await LineItem.find({ courseId }).select('_id').exec()).map((li) => li._id);
  if (liIds.length) await Score.deleteMany({ lineItemId: { $in: liIds } }).exec();
  await LineItem.deleteMany({ courseId }).exec();

  const cohortIds = (await Cohort.find({ courseId }).select('_id').exec()).map((c) => c._id);
  if (cohortIds.length) {
    await Promise.all([
      Session.deleteMany({ cohortId: { $in: cohortIds } }).exec(),
      Application.deleteMany({ cohortId: { $in: cohortIds } }).exec(),
      FeeSchedule.deleteMany({ cohortId: { $in: cohortIds } }).exec(),
      Group.deleteMany({ cohortId: { $in: cohortIds } }).exec(),
    ]);
    await Cohort.deleteMany({ courseId }).exec();
  }

  await Course.deleteOne({ _id: courseId }).exec();
  await AuditLog.create({
    actorUserId: currentUserId(), action: 'course.deleted', subjectType: 'Course', subjectId: courseId,
    meta: { code: course.code, lessons: lessonIds.length, quizzes: quizIds.length, cohorts: cohortIds.length },
  });
  return { deleted: true };
}

module.exports = {
  listPrograms,
  createProgram,
  listCourses,
  getLesson,
  listBlocks,
  setLessonPolicy,
  deleteLesson,
  deleteModule,
  deleteCourse,
  getCourse,
  getCourseTree,
  createCourse,
  updateCourse,
  createModule,
  createLesson,
  createBlock,
  reorder,
};
