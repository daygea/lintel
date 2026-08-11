'use strict';

const { Lesson, ContentBlock, ContentPolicy, Asset } = require('../models');
const { Course, Module, Enrollment, Cohort, LessonProgress } = require('../models');
const { Quiz, QuizAttempt } = require('../models');
const { canAccessLesson, previewAccess } = require('./eligibility.service');
const storage = require('../lib/storage');
const { accessUrl } = require('./archive.service');
const { pick } = require('../plugins/locale-map');
const { AccessLog } = require('../models');
const { currentUserId } = require('../lib/context');
const { NotAuthorisedError, ValidationError } = require('../lib/errors');

/**
 * The learner's home: every course they're actively enrolled in, its lessons
 * grouped by module, each lesson marked open or held — the door state, legible
 * at a glance. This is a PREVIEW: it runs the engine to decide open/held but
 * writes NO access log (browsing is not accessing). The moment a learner opens a
 * lesson, lessonFor() runs the engine again and logs that real access.
 */
async function myLearning({ userId, locale = 'en' }) {
  const uid = userId || currentUserId();

  const enrollments = await Enrollment.find({ userId: uid, status: 'active' }).exec();
  const courses = [];

  for (const enr of enrollments) {
    if (!enr.courseId) continue; // a cohort with no course carries nothing to learn yet
    const course = await Course.findById(enr.courseId).exec();
    if (!course || course.status === 'archived') continue;

    const cohort = enr.cohortId ? await Cohort.findById(enr.cohortId).exec() : null;
    const modules = await Module.find({ courseId: course._id }).sort({ order: 1 }).exec();
    const lessons = await Lesson.find({ courseId: course._id }).sort({ order: 1 }).exec();

    const progressRows = await LessonProgress.find({ enrollmentId: enr._id }).exec();
    const progressByLesson = new Map(progressRows.map((p) => [String(p.lessonId), p.state]));

    const buckets = new Map(
      modules.map((m) => [String(m._id), { id: m._id, title: m.title, lessons: [] }])
    );
    const ungrouped = { id: null, title: { en: 'Lessons' }, lessons: [] };
    let openCount = 0;

    for (const lesson of lessons) {
      const { verdict } = await previewAccess({ lesson, userId: uid, locale });
      if (verdict.allowed) openCount += 1;
      const item = {
        id: lesson._id,
        title: lesson.title,
        estimatedMinutes: lesson.estimatedMinutes || null,
        held: !verdict.allowed,
        message: verdict.allowed ? null : verdict.message,
        progress: progressByLesson.get(String(lesson._id)) || 'not_started',
      };
      const bucket = buckets.get(String(lesson.moduleId)) || ungrouped;
      bucket.lessons.push(item);
    }

    const moduleList = [...buckets.values()].filter((m) => m.lessons.length);
    if (ungrouped.lessons.length) moduleList.push(ungrouped);

    // Open quizzes for this course, with how many attempts the learner has left.
    // Discovery only — presentFor still strips answers, submit still marks.
    const quizDocs = await Quiz.find({ courseId: course._id, status: 'open' }).sort({ createdAt: 1 }).exec();
    const quizzes = [];
    for (const qz of quizDocs) {
      const attemptsUsed = await QuizAttempt.countDocuments({ quizId: qz._id, userId: uid }).exec();
      quizzes.push({
        id: qz._id,
        title: qz.title,
        questionCount: qz.questions.length,
        attemptsAllowed: qz.attemptsAllowed,
        attemptsUsed,
        passPercent: qz.passPercent,
      });
    }

    let coverUrl = null;
    if (course.coverAssetId) {
      const cover = await Asset.findById(course.coverAssetId).exec();
      if (cover && cover.storageKey) coverUrl = await storage.signGet(cover.storageKey);
    }

    courses.push({
      id: course._id,
      enrollmentId: enr._id,
      code: course.code,
      title: course.title,
      cohortTitle: cohort ? cohort.title : null,
      coverUrl,
      lessonCount: lessons.length,
      openCount,
      modules: moduleList,
      quizzes,
    });
  }

  return { courses };
}

/**
 * Assemble a lesson for a learner — but ONLY after the eligibility engine has
 * said yes, and only in a form the content policy permits.
 *
 * This is where Sprint 3's policies become bytes-on-a-screen. Every path here
 * runs the engine first; there is no way to reach lesson media that skips it.
 */
async function lessonFor({ lessonId, userId, locale = 'en', request = {} }) {
  const uid = userId || currentUserId();

  // 1. The engine decides. This writes an AccessLog entry, granted or withheld.
  const verdict = await canAccessLesson({ lessonId, userId: uid, locale, request });
  if (!verdict.allowed) {
    // Return the institution's own words, not an error. A held teaching is a door.
    return { held: true, message: verdict.message };
  }

  const lesson = await Lesson.findById(lessonId).exec();
  const enrollment = await Enrollment.findOne({
    userId: uid,
    courseId: lesson.courseId,
    status: 'active',
  }).exec();
  const blocks = await ContentBlock.find({ lessonId }).sort({ order: 1 }).exec();

  const rendered = [];
  for (const block of blocks) {
    rendered.push(await renderBlock(block, uid, locale, request));
  }

  return {
    held: false,
    lesson: { id: lesson._id, title: lesson.title },
    enrollmentId: enrollment ? enrollment._id : null,
    blocks: rendered,
  };
}

/**
 * External lecture links — a YouTube/Vimeo video, or a direct audio/video URL on
 * another platform. Known providers are normalised to their embeddable player URL;
 * direct media is detected by extension and played natively. Anything else is
 * offered as a plain link, because arbitrary sites can't be safely iframed (many
 * send X-Frame-Options: DENY, so an iframe would just render blank).
 */
function classifyEmbed(rawUrl) {
  const url = String(rawUrl || '').trim();
  let m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  if (m) return { kind: 'youtube', src: `https://www.youtube.com/embed/${m[1]}`, url };
  m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return { kind: 'vimeo', src: `https://player.vimeo.com/video/${m[1]}`, url };
  if (/\.(mp4|webm|ogv|mov|m4v)(?:[?#]|$)/i.test(url)) return { kind: 'video', src: url, url };
  if (/\.(mp3|m4a|aac|ogg|oga|wav|flac)(?:[?#]|$)/i.test(url)) return { kind: 'audio', src: url, url };
  return { kind: 'link', src: url, url };
}

async function renderBlock(block, uid, locale, request) {
  const policy = block.contentPolicyId
    ? await ContentPolicy.findById(block.contentPolicyId).exec()
    : null;

  const base = { id: block._id, type: block.type, order: block.order };

  if (block.type === 'rich_text') {
    return { ...base, body: block.body };
  }

  if (block.type === 'archive_ref') {
    if (block.archiveRef?.available === false) {
      return { ...base, unavailable: true, reason: 'The depositor withdrew consent.' };
    }
    // Archive resolves its own signed URL under its own consent check.
    const { url } = await accessUrl({ block, purpose: 'lesson_render' });
    await logView(block, uid, request, block.archiveRef?.accessionNumber);
    return {
      ...base,
      streamUrl: url,
      accessionNumber: block.archiveRef?.accessionNumber,
      tkLabels: block.archiveRef?.tkLabels || [],
      watermark: watermarkFor(uid, request),
      streamOnly: true,
    };
  }

  if (block.type === 'embed') {
    if (!block.embedUrl) return { ...base, unavailable: true, reason: 'This external resource has no link.' };
    await logView(block, uid, request);
    return { ...base, embed: classifyEmbed(block.embedUrl) };
  }

  // audio / video / pdf / image → signed URL from our own storage
  if (block.assetId) {
    const asset = await Asset.findById(block.assetId).exec();
    if (!asset || asset.status === 'failed') {
      return { ...base, unavailable: true, reason: 'This media could not be prepared.' };
    }
    if (asset.status !== 'ready') {
      // uploading / uploaded / processing — the transcode worker hasn't finished.
      // This is transient: tell the learner it's coming, not that it's gone.
      return { ...base, preparing: true, reason: 'This lesson is still being prepared — check back shortly.' };
    }

    const streamOnly = policy?.streamOnly ?? false;
    const key = streamOnly
      ? asset.derivatives.find((d) => d.rung === 'hls')?.key || asset.storageKey
      : asset.storageKey;

    await logView(block, uid, request);
    return {
      ...base,
      streamUrl: await storage.signGet(key),
      streamOnly,
      downloadable: policy?.downloadable ?? false,
      watermark: policy?.watermark ? watermarkFor(uid, request) : null,
    };
  }

  return base;
}

/**
 * The offline pack. Refuses, at the server, to hand over a lesson whose content
 * policy does not permit caching. The client refuses too (belt and braces), but
 * the authoritative "no" is here.
 */
async function packFor({ lessonId, userId, locale = 'en', request = {} }) {
  const uid = userId || currentUserId();

  const verdict = await canAccessLesson({ lessonId, userId: uid, locale, request });
  if (!verdict.allowed) throw new NotAuthorisedError(verdict.message || 'This lesson is held.');

  const blocks = await ContentBlock.find({ lessonId }).sort({ order: 1 }).exec();

  // A lesson is packable only if EVERY block permits offline caching. One
  // stream-only block makes the whole lesson stream-only — you cannot half-cache
  // a teaching.
  for (const block of blocks) {
    if (block.type === 'archive_ref') {
      throw new ValidationError('Lessons with archive material are stream-only and cannot be saved offline.');
    }
    if (block.type === 'embed') {
      throw new ValidationError('Lessons with an external link (e.g. a YouTube video) are online-only and cannot be saved offline.');
    }
    const policy = block.contentPolicyId ? await ContentPolicy.findById(block.contentPolicyId).exec() : null;
    if (policy && (policy.streamOnly || !policy.offlineCacheable)) {
      throw new ValidationError('This lesson is stream-only and cannot be saved offline.');
    }
  }

  const lesson = await Lesson.findById(lessonId).exec();
  const packed = [];
  for (const block of blocks) {
    if (block.type === 'rich_text') {
      packed.push({ id: block._id, type: 'rich_text', body: block.body });
    } else if (block.assetId) {
      const asset = await Asset.findById(block.assetId).exec();
      if (asset?.status === 'ready') {
        // A long-TTL signed URL, because the download happens now and may replay
        // offline later. Downloadable content is not secret; that is the policy's
        // whole meaning.
        packed.push({
          id: block._id,
          type: block.type,
          downloadUrl: await storage.signGet(asset.storageKey, 24 * 3600),
          transcript: asset.transcript,
        });
      }
    }
  }

  return {
    lessonId,
    title: lesson.title,
    offlineCacheable: true,
    blocks: packed,
    packedAt: new Date(),
  };
}

/* ------------------------------------------------------------------ helpers */

const watermarkFor = (uid, request) =>
  `${request.userName || uid} · ${new Date().toISOString().slice(0, 10)}`;

const logView = (block, uid, request, accessionNumber) =>
  AccessLog.create({
    userId: uid,
    action: 'view',
    subjectType: 'ContentBlock',
    subjectId: block._id,
    accessionNumber,
    ip: request.ip,
    userAgent: request.userAgent,
    sessionId: request.sessionId,
  });

module.exports = { myLearning, lessonFor, packFor, classifyEmbed };
