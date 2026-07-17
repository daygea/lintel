'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

/** One rung of the bitrate ladder. */
const DerivativeSchema = new Schema(
  {
    rung: { type: String, required: true }, // 'audio-64k', 'video-360p', 'hls'
    key: { type: String, required: true },
    bytes: Number,
    width: Number,
    height: Number,
    bitrateKbps: Number,
  },
  { _id: false }
);

const CaptionSchema = new Schema(
  {
    locale: { type: String, required: true },
    key: { type: String, required: true }, // WebVTT in R2
    source: { type: String, enum: ['human', 'machine'], default: 'human' },
  },
  { _id: false }
);

const AssetSchema = new Schema(
  {
    kind: { type: String, enum: ['audio', 'video', 'image', 'pdf', 'other'], required: true },
    filename: { type: String, required: true },
    mime: { type: String, required: true },
    bytes: Number,
    checksum: String,

    /** Where the original lives. Tenant-scoped, private, never public. */
    storageKey: { type: String, required: true },

    durationMs: Number,
    derivatives: [DerivativeSchema],

    /**
     * Transcripts are not a nice-to-have here. Oral-tradition material is
     * unsearchable without them, and a learner on a metered connection reads the
     * transcript instead of streaming 40 minutes of video.
     */
    transcript: LocaleMapType,
    captions: [CaptionSchema],

    status: {
      type: String,
      enum: ['uploading', 'uploaded', 'processing', 'ready', 'failed'],
      default: 'uploading',
    },
    error: String,

    uploadId: String, // in-flight multipart
    uploadedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

AssetSchema.plugin(tenantGuard);
AssetSchema.plugin(localeMap, { paths: ['transcript'] });

AssetSchema.index({ tenantId: 1, status: 1 });
AssetSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('Asset', AssetSchema);
