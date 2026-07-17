'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { Asset } = require('../models');
const storage = require('../lib/storage');
const { currentTenantId } = require('../lib/context');
const { ffmpegPath, ffprobePath } = require('../config/env');
const logger = require('../lib/logger');

/**
 * Bitrate ladders.
 *
 * Deliberately modest. The learner is on a phone on 3G in Kaduna, not a
 * workstation in Lagos. 1080p costs storage, egress and battery, and nobody in
 * the intended audience will ever see the difference. Add a higher rung when a
 * tenant asks and can say why.
 *
 * Audio gets the most care, because in an oral tradition the audio IS the
 * lesson.
 */
const AUDIO_LADDER = [
  { rung: 'audio-48k', bitrateKbps: 48 }, // spoken word on a bad line
  { rung: 'audio-96k', bitrateKbps: 96 }, // chant, drumming, music
];

const VIDEO_LADDER = [
  { rung: 'video-360p', height: 360, bitrateKbps: 500 },
  { rung: 'video-540p', height: 540, bitrateKbps: 1000 },
  { rung: 'video-720p', height: 720, bitrateKbps: 2000 },
];

async function transcode({ assetId }) {
  const asset = await Asset.findById(assetId).exec();
  if (!asset) throw new Error(`Asset ${assetId} vanished before transcoding`);

  const tenantId = currentTenantId();
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'lintel-'));

  try {
    const source = path.join(work, 'source');
    await fs.writeFile(source, await storage.getBuffer(asset.storageKey));

    const durationMs = await probeDurationMs(source);
    const derivatives = [];

    const ladder = asset.kind === 'audio' ? AUDIO_LADDER : VIDEO_LADDER;

    for (const rung of ladder) {
      const out = path.join(work, `${rung.rung}.m4a`);
      const isAudio = asset.kind === 'audio';
      const target = isAudio ? out : path.join(work, `${rung.rung}.mp4`);

      await ffmpeg(
        isAudio
          ? ['-i', source, '-vn', '-c:a', 'aac', '-b:a', `${rung.bitrateKbps}k`, '-y', target]
          : [
              '-i', source,
              '-vf', `scale=-2:${rung.height}`,
              '-c:v', 'libx264', '-preset', 'medium',
              '-b:v', `${rung.bitrateKbps}k`,
              '-c:a', 'aac', '-b:a', '96k',
              '-movflags', '+faststart',
              '-y', target,
            ]
      );

      const key = storage.keyFor(tenantId, asset._id, `${rung.rung}${isAudio ? '.m4a' : '.mp4'}`);
      const body = await fs.readFile(target);
      await storage.put(key, body, isAudio ? 'audio/mp4' : 'video/mp4');

      derivatives.push({
        rung: rung.rung,
        key,
        bytes: body.length,
        height: rung.height,
        bitrateKbps: rung.bitrateKbps,
      });

      logger.info({ assetId, rung: rung.rung, bytes: body.length }, 'rung encoded');
    }

    /**
     * HLS. This is what makes streamOnly enforceable in Sprint 3: the media is
     * delivered in short segments behind signed URLs, so there is no single file
     * a learner can right-click and save. It does not stop a camera pointed at a
     * screen — nothing does — but it means we are not pretending.
     */
    if (asset.kind === 'video' || asset.kind === 'audio') {
      const hlsDir = path.join(work, 'hls');
      await fs.mkdir(hlsDir);
      await ffmpeg([
        '-i', source,
        ...(asset.kind === 'audio' ? ['-vn', '-c:a', 'aac', '-b:a', '96k'] : ['-c:v', 'libx264', '-c:a', 'aac', '-b:a', '96k', '-vf', 'scale=-2:540']),
        '-hls_time', '6',
        '-hls_playlist_type', 'vod',
        '-hls_segment_filename', path.join(hlsDir, 'seg%03d.ts'),
        '-y', path.join(hlsDir, 'index.m3u8'),
      ]);

      for (const file of await fs.readdir(hlsDir)) {
        const key = storage.keyFor(tenantId, asset._id, `hls/${file}`);
        await storage.put(
          key,
          await fs.readFile(path.join(hlsDir, file)),
          file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t'
        );
      }

      derivatives.push({
        rung: 'hls',
        key: storage.keyFor(tenantId, asset._id, 'hls/index.m3u8'),
      });
    }

    asset.durationMs = durationMs;
    asset.derivatives = derivatives;
    asset.status = 'ready';
    asset.error = undefined;
    await asset.save();

    logger.info({ assetId, rungs: derivatives.length, durationMs }, 'transcode complete');
  } catch (err) {
    await Asset.updateOne({ _id: assetId }, { status: 'failed', error: err.message }).exec();
    throw err;
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

/* --------------------------------------------------------------------- shell */

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    proc.on('error', (err) =>
      reject(new Error(`ffmpeg could not be started (${err.message}). Is it installed and on PATH?`))
    );
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`))
    );
  });
}

function probeDurationMs(file) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      file,
    ]);
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.on('error', reject);
    proc.on('close', () => {
      const seconds = parseFloat(out.trim());
      resolve(Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined);
    });
  });
}

module.exports = { transcode, AUDIO_LADDER, VIDEO_LADDER };
