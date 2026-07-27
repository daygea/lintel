'use strict';

/**
 * Demo media lesson — SYNTHETIC content only (Invariant 10).
 *
 * ADDITIVE and idempotent. Unlike seed/synthetic.js this destroys nothing global:
 * it seeds one demo course (code DEMO101) with two lessons into an EXISTING tenant
 * and enrols one learner, so you can watch the learner path end to end:
 *
 *     learner home → open lesson → rich text + a watermarked audio player + an image
 *
 * The audio is a half-second tone and the image a small banner, both generated
 * here and uploaded straight to R2 as READY assets — so they show without ffmpeg
 * and without the transcode worker. If R2 isn't configured, the media blocks are
 * skipped and the text lessons still work.
 *
 * Nothing here is tenant-specific or OISS-specific — it's a generic sample.
 *
 * Usage:
 *   node seed/demo-media-lesson.js                       # first tenant, default learner
 *   node seed/demo-media-lesson.js --tenant=alpha        # a specific tenant slug
 *   node seed/demo-media-lesson.js --learner=ada@example.com
 */

const mongoose = require('mongoose');
const zlib = require('node:zlib');
const {
  Tenant, User, Membership, Course, Module, Lesson, ContentBlock, ContentPolicy,
  Asset, Cohort, Enrollment,
} = require('../src/models');
const storage = require('../src/lib/storage');
const { runWithTenant } = require('../src/lib/context');
const { mongoUri, media } = require('../src/config/env');
const { ROLES } = require('../src/lib/roles');

const COURSE_CODE = 'DEMO101';
const POLICY_SLUG = 'demo-watermarked';
const ASSET_FILENAME = 'demo-tone.wav';
const IMAGE_FILENAME = 'demo-banner.png';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
}

// A short, valid PCM WAV (mono, 8 kHz, 16-bit) — a soft 440 Hz tone. Enough for a
// browser <audio> element to play; no external tools needed to produce it.
function makeToneWav({ seconds = 0.6, freq = 440, rate = 8000, amp = 0.2 } = {}) {
  const samples = Math.floor(seconds * rate);
  const dataLen = samples * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); // byteRate
  buf.writeUInt16LE(2, 32); // blockAlign
  buf.writeUInt16LE(16, 34); // bitsPerSample
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples; i += 1) {
    const fade = Math.min(1, i / 400, (samples - i) / 400); // avoid clicks
    const v = Math.sin((2 * Math.PI * freq * i) / rate) * amp * fade;
    buf.writeInt16LE(Math.max(-1, Math.min(1, v)) * 0x7fff, 44 + i * 2);
  }
  return buf;
}

// A small, valid PNG (truecolor, 8-bit) — a teal banner with a diagonal band.
// Built from scratch with zlib + a CRC32, so no image tooling is needed. Enough
// for a browser <img> to render.
const PNG_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = PNG_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makeBannerPng({ width = 480, height = 270 } = {}) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    raw[p] = 0; // filter: none
    p += 1;
    for (let x = 0; x < width; x += 1) {
      const band = (x + y) % 90 < 45;
      raw[p] = band ? 0x0e : 0x14;
      raw[p + 1] = band ? 0x5c : 0x7a;
      raw[p + 2] = band ? 0x5c : 0x83;
      p += 3;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  await mongoose.connect(mongoUri);

  const tenantSlug = arg('tenant');
  const tenant = tenantSlug
    ? await Tenant.findOne({ slug: tenantSlug }).exec()
    : await Tenant.findOne().sort({ createdAt: 1 }).exec();

  if (!tenant) {
    throw new Error(
      tenantSlug
        ? `No tenant with slug "${tenantSlug}". Run your normal tenant setup first, or omit --tenant.`
        : 'No tenants exist yet. Provision one (or run seed/synthetic.js) before seeding a demo lesson.'
    );
  }

  const learnerEmail = arg('learner', 'demo.learner@example.com');
  const tempPassword = 'demo-learner-passphrase';

  const summary = await runWithTenant(tenant._id, null, async () => {
    // 1. Learner (find or create), guaranteed an active learner membership.
    let learner = await User.findOne({ email: learnerEmail }).exec();
    let createdLearner = false;
    if (!learner) {
      learner = await User.create({
        email: learnerEmail,
        name: 'Demo Learner',
        passwordHash: await User.hashPassword(tempPassword),
        status: 'active',
      });
      createdLearner = true;
    }
    let membership = await Membership.findOne({ userId: learner._id }).exec();
    if (!membership) {
      membership = await Membership.create({ userId: learner._id, roles: [ROLES.LEARNER], status: 'active' });
    } else if (membership.status !== 'active') {
      membership.status = 'active';
      await membership.save();
    }

    // 2. Course (find or create), then wipe & rebuild ONLY this demo course's tree
    //    so re-runs stay clean and idempotent.
    let course = await Course.findOne({ code: COURSE_CODE }).exec();
    if (!course) {
      course = await Course.create({ code: COURSE_CODE, title: { en: 'Demo: Getting Started' }, status: 'active' });
    }
    const oldLessons = await Lesson.find({ courseId: course._id }).select('_id').exec();
    await ContentBlock.deleteMany({ lessonId: { $in: oldLessons.map((l) => l._id) } });
    await Lesson.deleteMany({ courseId: course._id });
    await Module.deleteMany({ courseId: course._id });
    await Asset.deleteMany({ filename: { $in: [ASSET_FILENAME, IMAGE_FILENAME] } });

    const mod = await Module.create({ courseId: course._id, title: { en: 'Orientation' }, order: 0 });

    // Lesson 1 — pure text, always renders (no media infra needed).
    const l1 = await Lesson.create({ moduleId: mod._id, courseId: course._id, title: { en: 'Welcome' }, order: 0, estimatedMinutes: 3 });
    await ContentBlock.create({
      lessonId: l1._id, type: 'rich_text', order: 0,
      body: { en: '<h2>Welcome to the demo</h2><p>This lesson is open to you. If you can read this, the learner path — home → open lesson → content — is working end to end.</p>' },
    });

    // Lesson 2 — text + a watermarked audio player (only if R2 is configured).
    const l2 = await Lesson.create({ moduleId: mod._id, courseId: course._id, title: { en: 'Listening sample' }, order: 1, estimatedMinutes: 5 });
    await ContentBlock.create({
      lessonId: l2._id, type: 'rich_text', order: 0,
      body: { en: '<p>Below are short synthetic media samples — an audio clip and an image — each streamed with your personal watermark, the same path real recordings take.</p>' },
    });

    let mediaSeeded = false;
    if (media.configured) {
      let policy = await ContentPolicy.findOne({ slug: POLICY_SLUG }).exec();
      if (!policy) {
        policy = await ContentPolicy.create({
          slug: POLICY_SLUG, label: { en: 'Demo (watermarked)' },
          watermark: true, streamOnly: false, downloadable: false, logAccess: true,
        });
      }

      // Audio — a generated tone, written straight to R2 as READY (no ffmpeg/worker).
      const audio = await Asset.create({
        kind: 'audio', filename: ASSET_FILENAME, mime: 'audio/wav',
        storageKey: 'pending', status: 'processing', derivatives: [],
      });
      const audioKey = storage.keyFor(tenant._id, audio._id, 'source.wav');
      await storage.put(audioKey, makeToneWav(), 'audio/wav');
      audio.storageKey = audioKey;
      audio.status = 'ready';
      await audio.save();
      await ContentBlock.create({
        lessonId: l2._id, type: 'audio', order: 1, assetId: audio._id, contentPolicyId: policy._id,
      });

      // Image — a generated PNG banner. Images are READY on upload (no transcode),
      // so this also proves the R2 + rendering path without touching the worker.
      const image = await Asset.create({
        kind: 'image', filename: IMAGE_FILENAME, mime: 'image/png',
        storageKey: 'pending', status: 'ready', derivatives: [],
      });
      const imageKey = storage.keyFor(tenant._id, image._id, 'source.png');
      await storage.put(imageKey, makeBannerPng(), 'image/png');
      image.storageKey = imageKey;
      await image.save();
      await ContentBlock.create({
        lessonId: l2._id, type: 'image', order: 2, assetId: image._id, contentPolicyId: policy._id,
      });

      mediaSeeded = true;
    }

    // 3. Cohort for the course + enrol the learner (idempotent).
    let cohort = await Cohort.findOne({ courseId: course._id, session: 'DEMO' }).exec();
    if (!cohort) {
      cohort = await Cohort.create({ courseId: course._id, title: { en: 'Demo cohort' }, code: 'DEMO', session: 'DEMO', status: 'open' });
    }
    let enrollment = await Enrollment.findOne({ userId: learner._id, cohortId: cohort._id }).exec();
    if (!enrollment) {
      enrollment = await Enrollment.create({
        userId: learner._id, courseId: course._id, cohortId: cohort._id,
        status: 'active', paymentState: 'waived',
      });
    }

    return { createdLearner, mediaSeeded };
  });

  console.log('\nDemo media lesson seeded (synthetic content).\n');
  console.log(`  Tenant:   ${tenant.name}  (slug: ${tenant.slug})`);
  console.log(`  Course:   ${COURSE_CODE} — two lessons under "Orientation"`);
  console.log(`  Learner:  ${learnerEmail}${summary.createdLearner ? `  (created — password: ${tempPassword})` : '  (existing)'}`);
  console.log(summary.mediaSeeded
    ? '  Media:    seeded a watermarked audio tone + an image banner (R2 configured) — lesson 2 shows both.'
    : '  Media:    SKIPPED — R2 not configured. Text lessons still work; set R2_* in .env to seed audio + image.');
  console.log('\nNext: sign in as the learner, open the institution — the Demo course appears.');
  console.log('      Open "Welcome" (text) and "Listening sample" (audio + image) to see the path.\n');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
