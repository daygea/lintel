'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');

/**
 * A record of one LTI launch. Written when we send a learner out to a tool, so an
 * AGS callback can be tied back to the right learner, course, and line item —
 * the callback arrives later, asynchronously, bearing only the identifiers we put
 * in the launch. This is the join table between "we launched X into tool Y" and
 * "tool Y says X scored Z".
 *
 * nonce is single-use: a replayed launch is rejected. state ties the async OIDC
 * round trip together.
 */
const LtiLaunchSchema = new Schema(
  {
    toolId: { type: Schema.Types.ObjectId, ref: 'LtiTool', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course' },
    lineItemId: { type: Schema.Types.ObjectId, ref: 'LineItem' },

    nonce: { type: String, required: true },
    state: { type: String, required: true },
    resourceLinkId: String,

    consumed: { type: Boolean, default: false }, // nonce single-use
    launchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

LtiLaunchSchema.plugin(tenantGuard);
LtiLaunchSchema.index({ tenantId: 1, nonce: 1 }, { unique: true });
LtiLaunchSchema.index({ tenantId: 1, state: 1 });

module.exports = mongoose.model('LtiLaunch', LtiLaunchSchema);
