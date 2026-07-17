'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

/** A tutorial group or study circle within a cohort. */
const GroupSchema = new Schema(
  {
    cohortId: { type: Schema.Types.ObjectId, ref: 'Cohort', required: true, index: true },
    title: { ...LocaleMapType, required: true },
    facilitatorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    memberUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

GroupSchema.plugin(tenantGuard);
GroupSchema.plugin(localeMap, { paths: ['title'] });

GroupSchema.index({ tenantId: 1, cohortId: 1 });

module.exports = mongoose.model('Group', GroupSchema);
