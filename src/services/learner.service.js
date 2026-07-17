'use strict';

const { Lesson, ContentBlock, ContentPolicy, Asset } = require('../models');
const { canAccessLesson } = require('./eligibility.service');
const storage = require('../lib/storage');
const { accessUrl } = require('./archive.service');
const { pick } = require('../plugins/locale-map');
const { AccessLog } = require('../models');
const { currentUserId } = require('../lib/context');
const { NotAuthorisedError, ValidationError } = require('../lib/errors');

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
  const blocks = await ContentBlock.find({ lessonId }).sort({ order: 1 }).exec();

  const rendered = [];
  for (const block of blocks) {
    rendered.push(await renderBlock(block, uid, locale, request));
  }

  return { held: false, lesson: { id: lesson._id, title: lesson.title }, blocks: rendered };
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

  // audio / video / pdf / image → signed URL from our own storage
  if (block.assetId) {
    const asset = await Asset.findById(block.assetId).exec();
    if (!asset || asset.status !== 'ready') return { ...base, unavailable: true };

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

module.exports = { lessonFor, packFor };
