'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { ALL: ALL_ROLES, ROLES } = require('../lib/roles');

/** A person's standing WITHIN one institution. Tenant-scoped. */
const MembershipSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    roles: {
      type: [String],
      required: true,
      default: [ROLES.LEARNER],
      validate: {
        validator: (v) => v.length > 0 && v.every((r) => ALL_ROLES.includes(r)),
        message: 'Unknown role',
      },
    },
    status: { type: String, enum: ['invited', 'active', 'suspended', 'left'], default: 'invited' },
    invitedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    invitedAt: Date,
    joinedAt: Date,
  },
  { timestamps: true }
);

MembershipSchema.plugin(tenantGuard);

MembershipSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
MembershipSchema.index({ tenantId: 1, roles: 1 });

module.exports = mongoose.model('Membership', MembershipSchema);
