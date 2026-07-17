'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

/**
 * How a piece of content may be delivered. Attached to a ContentBlock.
 *
 * Watermarking is honest — it does not stop a camera pointed at a screen, it
 * makes the person doing it identifiable. streamOnly + no download is enforced by
 * only ever issuing HLS segment URLs, never a whole-file URL. logAccess writes to
 * AccessLog on every view.
 */
const ContentPolicySchema = new Schema(
  {
    slug: { type: String, required: true, trim: true, lowercase: true },
    label: { ...LocaleMapType, required: true },

    downloadable: { type: Boolean, default: false },
    offlineCacheable: { type: Boolean, default: false }, // honoured only if downloadable
    watermark: { type: Boolean, default: false },
    streamOnly: { type: Boolean, default: false },
    sessionBound: { type: Boolean, default: false },
    maxConcurrentSessions: { type: Number, min: 1 },
    logAccess: { type: Boolean, default: true },
  },
  { timestamps: true }
);

ContentPolicySchema.plugin(tenantGuard);
ContentPolicySchema.plugin(localeMap, { paths: ['label'] });

ContentPolicySchema.index({ tenantId: 1, slug: 1 }, { unique: true });

/**
 * The offline/restricted conflict, resolved in code rather than discovered as a
 * bug: a lesson may only be cached offline if it is also downloadable. Restricted
 * material streams or it does not arrive.
 */
ContentPolicySchema.pre('validate', function reconcile(next) {
  if (this.offlineCacheable && !this.downloadable) {
    this.offlineCacheable = false;
  }
  if (this.streamOnly) {
    this.downloadable = false;
    this.offlineCacheable = false;
  }
  next();
});

module.exports = mongoose.model('ContentPolicy', ContentPolicySchema);
