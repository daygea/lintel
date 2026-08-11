'use strict';

const crypto = require('node:crypto');
const { Asset, AuditLog, ContentBlock } = require('../models');
const storage = require('../lib/storage');
const logger = require('../lib/logger');
const { enqueue } = require('../lib/queue');
const { currentTenantId, currentUserId } = require('../lib/context');
const { ValidationError } = require('../lib/errors');

const KIND_BY_MIME = [
  [/^audio\//, 'audio'],
  [/^video\//, 'video'],
  [/^image\//, 'image'],
  [/^application\/pdf$/, 'pdf'],
];

const kindOf = (mime) => (KIND_BY_MIME.find(([rx]) => rx.test(mime)) || [null, 'other'])[1];

const PART_SIZE = 8 * 1024 * 1024; // 8 MB — small enough to retry cheaply on 3G

/**
 * Step 1 — the browser asks for somewhere to put a file.
 *
 * The media never touches the app server. The browser uploads straight to R2
 * with signed URLs, one per part. This is not an optimisation: streaming a
 * 90-minute lecture through a small Render instance would fall over, and a
 * dropped connection would lose the whole thing.
 */
async function beginUpload({ filename, mime, bytes }) {
  if (!filename || !mime) throw new ValidationError('A file needs a name and a type');

  const asset = await Asset.create({
    kind: kindOf(mime),
    filename,
    mime,
    bytes,
    storageKey: 'pending',
    status: 'uploading',
    uploadedByUserId: currentUserId(),
  });

  const key = storage.keyFor(currentTenantId(), asset._id, `original-${sanitise(filename)}`);
  const uploadId = await storage.beginMultipart(key, mime);

  asset.storageKey = key;
  asset.uploadId = uploadId;
  await asset.save();

  const partCount = Math.max(1, Math.ceil((bytes || PART_SIZE) / PART_SIZE));
  const parts = [];
  for (let i = 1; i <= partCount; i += 1) {
    parts.push({ partNumber: i, url: await storage.signPart(key, uploadId, i) });
  }

  return { assetId: asset._id, partSize: PART_SIZE, parts };
}

/** Step 2 — the browser reports which parts landed, and with what ETags. */
async function completeUpload(assetId, { parts, checksum }) {
  const asset = await Asset.findById(assetId).exec();
  if (!asset) throw new ValidationError('No such asset');
  if (asset.status !== 'uploading') throw new ValidationError('That upload is already finished');
  if (!parts?.length) throw new ValidationError('No parts were uploaded');

  await storage.completeMultipart(asset.storageKey, asset.uploadId, parts);

  const meta = await storage.head(asset.storageKey);

  asset.status = 'uploaded';
  asset.bytes = meta.ContentLength;
  asset.checksum = checksum;
  asset.uploadId = undefined;
  await asset.save();

  await AuditLog.create({
    actorUserId: currentUserId(),
    action: 'asset.uploaded',
    subjectType: 'Asset',
    subjectId: asset._id,
    meta: { filename: asset.filename, bytes: asset.bytes, kind: asset.kind },
  });

  if (asset.kind === 'audio' || asset.kind === 'video') {
    await enqueue('media.transcode', { assetId: String(asset._id) });
    asset.status = 'processing';
    await asset.save();
  } else {
    asset.status = 'ready';
    await asset.save();
  }

  return asset;
}

/** A learner abandoned the upload. Do not leave paid-for orphans in the bucket. */
async function abandonUpload(assetId) {
  const asset = await Asset.findById(assetId).exec();
  if (!asset || asset.status !== 'uploading') return null;
  await storage.abortMultipart(asset.storageKey, asset.uploadId).catch(() => {});
  await Asset.deleteOne({ _id: asset._id }).exec();
  return true;
}

/**
 * Step 3 — playback.
 *
 * Every URL is signed and short-lived. Sprint 3 will require the eligibility
 * engine to have said yes before this is ever called, and will write an
 * AccessLog entry each time. The signature is what makes that enforceable: there
 * is no other way to reach the bytes.
 */
async function playbackUrl(assetId, { rung } = {}) {
  const asset = await Asset.findById(assetId).exec();
  if (!asset) throw new ValidationError('No such asset');
  if (asset.status !== 'ready') throw new ValidationError('That media is still being prepared');

  const derivative = rung
    ? asset.derivatives.find((d) => d.rung === rung)
    : asset.derivatives.find((d) => d.rung === 'hls') || asset.derivatives[0];

  const key = derivative ? derivative.key : asset.storageKey;
  return { url: await storage.signGet(key), expiresInSeconds: 300, rung: derivative?.rung };
}

const listAssets = (filter = {}) => Asset.find(filter).sort({ createdAt: -1 }).limit(100).exec();
const getAsset = (id) => Asset.findById(id).exec();

async function setTranscript(assetId, transcript) {
  const asset = await Asset.findByIdAndUpdate(assetId, { transcript }, { new: true }).exec();
  if (!asset) throw new ValidationError('No such asset');
  return asset;
}

const sanitise = (name) =>
  String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-80);

/** Rename a file (its display name). */
async function renameAsset(assetId, filename) {
  const name = String(filename || '').trim();
  if (!name) throw new ValidationError('A file needs a name.');
  const asset = await Asset.findByIdAndUpdate(assetId, { filename: name }, { new: true }).exec();
  if (!asset) throw new ValidationError('No such file.');
  return asset;
}

/**
 * Delete a file and every object it owns (original, derivatives, captions). Refuses
 * if any lesson block still points at it — a file in use must be removed from those
 * lessons first, so we never leave a lesson with a dangling reference. Object
 * deletes are best-effort: a storage hiccup on one key doesn't strand the record.
 */
async function deleteAsset(assetId) {
  const asset = await Asset.findById(assetId).exec();
  if (!asset) throw new ValidationError('No such file.');

  const uses = await ContentBlock.countDocuments({ assetId }).exec();
  if (uses > 0) {
    throw new ValidationError(
      `This file is used in ${uses} lesson block${uses === 1 ? '' : 's'}. Remove it from those lessons before deleting.`
    );
  }

  const keys = [
    asset.storageKey,
    ...(asset.derivatives || []).map((d) => d.key),
    ...(asset.captions || []).map((c) => c.key),
  ].filter(Boolean);
  for (const key of keys) {
    try {
      await storage.del(key);
    } catch (err) {
      logger.warn({ key, err: err.message }, 'asset object delete failed (continuing)');
    }
  }

  await Asset.deleteOne({ _id: asset._id }).exec();
  await AuditLog.create({
    actorUserId: currentUserId(), action: 'asset.deleted',
    subjectType: 'Asset', subjectId: asset._id,
    meta: { filename: asset.filename, keysRemoved: keys.length },
  });
  return { deleted: true, keysRemoved: keys.length };
}

module.exports = {
  beginUpload,
  completeUpload,
  abandonUpload,
  playbackUrl,
  listAssets,
  getAsset,
  setTranscript,
  renameAsset,
  deleteAsset,
  PART_SIZE,
};
