'use strict';

const {
  S3Client,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  UploadPartCommand,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { media } = require('../config/env');
const { AppError } = require('./errors');

/**
 * Cloudflare R2, S3-compatible.
 *
 * Two rules, both load-bearing:
 *
 *   1. The bucket is PRIVATE. Nothing is ever served by a public URL. Every read
 *      is a signed, short-TTL URL issued after the eligibility engine has said
 *      yes. A publicly readable bucket makes streamOnly and watermarking
 *      decorative — if media can be fetched without passing the engine, the
 *      engine is theatre.
 *
 *   2. Object keys are TENANT-SCOPED: t/<tenantId>/assets/<assetId>/...
 *      Even if a signed URL leaks, it cannot be edited into a path that walks
 *      another institution's material.
 */

let client;
function s3() {
  if (!media.configured) {
    throw new AppError(`Media storage is not configured. Missing: ${media.missing.join(', ')}`, {
      status: 503,
      code: 'media_not_configured',
      expose: true,
    });
  }
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: media.endpoint,
      credentials: {
        accessKeyId: media.accessKeyId,
        secretAccessKey: media.secretAccessKey,
      },
    });
  }
  return client;
}

const keyFor = (tenantId, assetId, name) => `t/${tenantId}/assets/${assetId}/${name}`;

/* ------------------------------------------------------- resumable multipart */

/**
 * The learner is on 3G and their phone will drop the connection. That is not an
 * edge case; it is the expected case. Multipart upload lets a single failed part
 * be retried rather than a 40-minute recording being lost.
 */
async function beginMultipart(key, contentType) {
  const out = await s3().send(
    new CreateMultipartUploadCommand({ Bucket: media.bucket, Key: key, ContentType: contentType })
  );
  return out.UploadId;
}

const signPart = (key, uploadId, partNumber) =>
  getSignedUrl(
    s3(),
    new UploadPartCommand({
      Bucket: media.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    }),
    { expiresIn: media.uploadUrlTtlSeconds }
  );

const completeMultipart = (key, uploadId, parts) =>
  s3().send(
    new CompleteMultipartUploadCommand({
      Bucket: media.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts
          .slice()
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((p) => ({ ETag: p.etag, PartNumber: p.partNumber })),
      },
    })
  );

const abortMultipart = (key, uploadId) =>
  s3().send(
    new AbortMultipartUploadCommand({ Bucket: media.bucket, Key: key, UploadId: uploadId })
  );

/* ---------------------------------------------------------------- read/write */

const signGet = (key, ttl = media.playbackUrlTtlSeconds) =>
  getSignedUrl(s3(), new GetObjectCommand({ Bucket: media.bucket, Key: key }), {
    expiresIn: ttl,
  });

const put = (key, body, contentType) =>
  s3().send(
    new PutObjectCommand({ Bucket: media.bucket, Key: key, Body: body, ContentType: contentType })
  );

const head = (key) => s3().send(new HeadObjectCommand({ Bucket: media.bucket, Key: key }));

const del = (key) => s3().send(new DeleteObjectCommand({ Bucket: media.bucket, Key: key }));

async function getBuffer(key) {
  const out = await s3().send(new GetObjectCommand({ Bucket: media.bucket, Key: key }));
  const chunks = [];
  for await (const chunk of out.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

module.exports = {
  keyFor,
  beginMultipart,
  signPart,
  completeMultipart,
  abortMultipart,
  signGet,
  put,
  head,
  del,
  getBuffer,
  isConfigured: () => media.configured,
};
