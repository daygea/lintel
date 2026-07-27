'use strict';

require('dotenv').config();

const REQUIRED = ['MONGODB_URI', 'SESSION_SECRET', 'ROOT_DOMAIN'];

/** Media is optional in development; the app boots without it, uploads just fail. */
const MEDIA_KEYS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];

const isTest = process.env.NODE_ENV === 'test';

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length && !isTest) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill it in.');
  process.exit(1);
}

if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters.');
  process.exit(1);
}

const mediaMissing = MEDIA_KEYS.filter((k) => !process.env[k]);

module.exports = {
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  isTest,
  port: Number(process.env.PORT || 3000),
  rootDomain: process.env.ROOT_DOMAIN || 'localhost',
  mongoUri: process.env.MONGODB_URI || '',
  sessionSecret: process.env.SESSION_SECRET || 'test-secret-test-secret-test-secret',
  logLevel: process.env.LOG_LEVEL || 'info',


  media: {
    configured: mediaMissing.length === 0,
    missing: mediaMissing,
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
    endpoint:
      process.env.R2_ENDPOINT ||
      (process.env.R2_ACCOUNT_ID
        ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
        : undefined),
    /** Signed URLs are short-lived on purpose. A leaked link should die quickly. */
    uploadUrlTtlSeconds: Number(process.env.R2_UPLOAD_TTL || 3600),
    playbackUrlTtlSeconds: Number(process.env.R2_PLAYBACK_TTL || 300),
  },

  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
};

// Self-service onboarding flags (Sprint 12) are read from process.env at ACCESS
// time, not frozen at import — so they can be toggled at runtime (and in tests)
// without cache-busting. AUTO_PROVISION_TENANTS: institution signups go live
// instantly (default false = review first). ALLOW_SELF_REGISTRATION: learners may
// register from an institution page (default true).
Object.defineProperties(module.exports, {
  autoProvisionTenants: {
    enumerable: true,
    get() { return String(process.env.AUTO_PROVISION_TENANTS || 'false') === 'true'; },
  },
  allowSelfRegistration: {
    enumerable: true,
    get() { return String(process.env.ALLOW_SELF_REGISTRATION || 'true') === 'true'; },
  },
});
