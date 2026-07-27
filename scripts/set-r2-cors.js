'use strict';

/**
 * Configure CORS on the R2 bucket so browsers can PUT upload parts directly.
 *
 * WHY THIS EXISTS: media upload sends file bytes straight from the browser to
 * R2 using presigned URLs (see src/views/media/upload.ejs). Without a CORS
 * policy on the bucket, the browser blocks that cross-origin PUT before it is
 * sent — surfacing in the page as "Failed to fetch", stuck at "uploading".
 * The policy MUST also expose the ETag response header, because the completion
 * step reads each part's ETag to finalise the multipart upload.
 *
 * Run once per bucket (and again whenever the allowed origins change):
 *   node scripts/set-r2-cors.js
 *
 * It reads R2_* from the environment (same vars the app uses) and, optionally,
 * MEDIA_CORS_ORIGINS (comma-separated) to override the allowed origins.
 */

const { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } = require('@aws-sdk/client-s3');
const { media, rootDomain, port } = require('../src/config/env');

if (!media.configured) {
  console.error(`R2 is not configured. Missing: ${media.missing.join(', ')}`);
  console.error('Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET in your environment.');
  process.exit(1);
}

// Which browser origins may upload. Tenant admin runs on tenant subdomains, so
// we allow the apex and its subdomains for both dev (http, with port) and prod.
function defaultOrigins() {
  if (rootDomain === 'localhost') {
    // Browsers send the Origin with the port in dev. Wildcard subdomain + port.
    return [
      `http://localhost:${port}`,
      `http://*.localhost:${port}`,
    ];
  }
  return [
    `https://${rootDomain}`,
    `https://*.${rootDomain}`,
  ];
}

const origins = process.env.MEDIA_CORS_ORIGINS
  ? process.env.MEDIA_CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
  : defaultOrigins();

const client = new S3Client({
  region: 'auto',
  endpoint: media.endpoint,
  credentials: { accessKeyId: media.accessKeyId, secretAccessKey: media.secretAccessKey },
});

const corsConfig = {
  CORSRules: [
    {
      AllowedOrigins: origins,
      AllowedMethods: ['PUT', 'GET', 'HEAD'],
      AllowedHeaders: ['*'],
      // The browser can only read ETag off the PUT response if it is exposed.
      // Without this, completion has no ETag and the multipart upload fails.
      ExposeHeaders: ['ETag'],
      MaxAgeSeconds: 3600,
    },
  ],
};

(async () => {
  try {
    await client.send(new PutBucketCorsCommand({ Bucket: media.bucket, CORSConfiguration: corsConfig }));
    console.log(`✓ CORS set on bucket "${media.bucket}"`);
    console.log('  Allowed origins:');
    origins.forEach((o) => console.log(`    - ${o}`));
    console.log('  Exposed header: ETag');

    // Read it back so the operator sees what actually landed.
    const check = await client.send(new GetBucketCorsCommand({ Bucket: media.bucket }));
    console.log('\nBucket now reports:');
    console.log(JSON.stringify(check.CORSRules, null, 2));
  } catch (err) {
    console.error('✗ Failed to set CORS:', err.message);
    if (err.name === 'AccessDenied') {
      console.error('  The R2 API token needs bucket-configuration (admin) permission, not just object read/write.');
    }
    process.exit(1);
  }
})();
