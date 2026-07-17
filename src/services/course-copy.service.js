'use strict';

const { Course, Module, Lesson, ContentBlock, AuditLog } = require('../models');
const { ValidationError } = require('../lib/errors');
const { currentUserId } = require('../lib/context');

/**
 * Clone a course into a new session.
 *
 * An institution re-runs the same programme every year. Without this, the
 * registrar rebuilds a twelve-module course by hand each September, and the two
 * copies silently drift apart. Cheap to build now; genuinely painful to retrofit
 * once real courses exist.
 *
 * Two rules, both deliberate:
 *
 *   1. The copy is PRIVATE, always — even if the original was published. A new
 *      run of a course has not been reviewed by anyone yet. Publication is an
 *      act (ADR-011), and cloning is not that act.
 *
 *   2. archive_ref blocks are copied as REFERENCES, which is all they ever were.
 *      No media is duplicated, because no media was ever held. The clone points
 *      at the same accession number under the same consent terms — and if the
 *      depositor revokes, both the original and the copy go dark together.
 */
async function copyCourse(sourceCourseId, { session, code }) {
  const source = await Course.findById(sourceCourseId).exec();
  if (!source) throw new ValidationError('No such course');
  if (!session) throw new ValidationError('A copy needs a session — that is the point of it');

  const clash = await Course.findOne({ code: code || source.code, session }).exec();
  if (clash) throw new ValidationError(`${code || source.code} already exists for ${session}`);

  const copy = await Course.create({
    programId: source.programId,
    code: code || source.code,
    title: source.title,
    summary: source.summary,
    session,
    order: source.order,
    instructorIds: source.instructorIds,
    status: 'draft',
    visibility: 'private', // Rule 1. Not negotiable.
    eligibilityPolicyId: source.eligibilityPolicyId,
    copiedFromCourseId: source._id,
    version: source.version + 1,
  });

  const modules = await Module.find({ courseId: source._id }).sort({ order: 1 }).exec();

  for (const mod of modules) {
    const modCopy = await Module.create({
      courseId: copy._id,
      title: mod.title,
      order: mod.order,
    });

    const lessons = await Lesson.find({ moduleId: mod._id }).sort({ order: 1 }).exec();

    for (const lesson of lessons) {
      const lessonCopy = await Lesson.create({
        moduleId: modCopy._id,
        courseId: copy._id,
        title: lesson.title,
        order: lesson.order,
        estimatedMinutes: lesson.estimatedMinutes,
        eligibilityPolicyId: lesson.eligibilityPolicyId,
      });

      const blocks = await ContentBlock.find({ lessonId: lesson._id }).sort({ order: 1 }).exec();

      for (const block of blocks) {
        await ContentBlock.create({
          lessonId: lessonCopy._id,
          order: block.order,
          type: block.type,
          body: block.body,
          assetId: block.assetId, // same asset, not a duplicate file
          embedUrl: block.embedUrl,
          archiveRef: block.archiveRef, // Rule 2. A reference, as it always was.
          contentPolicyId: block.contentPolicyId,
          visibility: 'private',
          previewable: false,
        });
      }
    }
  }

  await AuditLog.create({
    actorUserId: currentUserId(),
    action: 'course.copied',
    subjectType: 'Course',
    subjectId: copy._id,
    meta: { from: String(source._id), session, modules: modules.length },
  });

  return copy;
}

module.exports = { copyCourse };
