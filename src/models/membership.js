'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { ALL: ALL_ROLES, ROLES } = require('../lib/roles');

/** A person's standing WITHIN one institution. Tenant-scoped. */
const MembershipSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // The person's name AS THIS INSTITUTION knows them. `User` is one global,
    // email-keyed record, so its `name` is shared across every tenant that email
    // touches — a person enrolled at two institutions (or a reused owner email)
    // shows one global name everywhere. This per-tenant name overrides it for
    // display within this institution; empty falls back to the global User.name.
    displayName: { type: String, trim: true }, // @admin-string — a person's name within this institution
    roles: {
      type: [String],
      required: true,
      default: [ROLES.LEARNER],
      validate: {
        validator: (v) => v.length > 0 && v.every((r) => ALL_ROLES.includes(r)),
        message: 'Unknown role',
      },
    },
    /* 'pending' = self-registered, awaiting a registrar's admission (Sprint 12).
       Only 'active' members can access anything — see requireMember — so a pending
       or invited member is locked out by default until explicitly admitted. */
    status: { type: String, enum: ['pending', 'invited', 'active', 'suspended', 'left'], default: 'invited' },
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
