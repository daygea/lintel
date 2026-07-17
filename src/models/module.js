'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

const ModuleSchema = new Schema(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    title: { ...LocaleMapType, required: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

ModuleSchema.plugin(tenantGuard);
ModuleSchema.plugin(localeMap, { paths: ['title'] });

ModuleSchema.index({ tenantId: 1, courseId: 1, order: 1 });

module.exports = mongoose.model('Module', ModuleSchema);
