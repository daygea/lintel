'use strict';

const { authenticator } = require('otplib');
const { User, Membership, AuditLog } = require('../models');
const { ValidationError, NotAuthenticatedError } = require('../lib/errors');
const { ROLES } = require('../lib/roles');

/**
 * ALL business logic lives in services. Controllers (web and api) are thin and
 * call these. check-api-parity enforces that both transports can reach the same
 * methods.
 */

async function register({ email, name, password }) {
  if (!email || !name || !password) throw new ValidationError('Email, name and password are required');
  if (password.length < 10) throw new ValidationError('Use at least 10 characters');

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) throw new ValidationError('An account already exists for that email');

  const user = await User.create({
    email: email.toLowerCase(),
    name,
    passwordHash: await User.hashPassword(password),
    status: 'active',
  });
  return user;
}

async function authenticate({ email, password, totp }) {
  const user = await User.findOne({ email: String(email || '').toLowerCase() }).select('+passwordHash +mfa.secret');
  if (!user) throw new NotAuthenticatedError();

  const ok = await user.verifyPassword(password || '');
  if (!ok) throw new NotAuthenticatedError();

  if (user.mfa?.enabled) {
    if (!totp) throw new ValidationError('Enter the code from your authenticator app');
    if (!authenticator.check(String(totp), user.mfa.secret)) throw new NotAuthenticatedError();
  }

  user.lastSeenAt = new Date();
  await user.save();
  return user;
}

async function beginMfaSetup(user) {
  const secret = authenticator.generateSecret();
  await User.updateOne({ _id: user._id }, { $set: { 'mfa.secret': secret, 'mfa.enabled': false } });
  return { secret, uri: authenticator.keyuri(user.email, 'Lintel', secret) };
}

async function confirmMfa(user, token) {
  const fresh = await User.findById(user._id).select('+mfa.secret');
  if (!authenticator.check(String(token), fresh.mfa.secret)) {
    throw new ValidationError('That code is not right. Try the next one.');
  }
  await User.updateOne({ _id: user._id }, { $set: { 'mfa.enabled': true } });
  return true;
}

/** Tenant-scoped: runs inside a tenant context. */
async function invite({ email, name, roles, invitedByUserId }) {
  let user = await User.findOne({ email: String(email).toLowerCase() });
  if (!user) {
    user = await User.create({
      email: String(email).toLowerCase(),
      name: name || email,
      passwordHash: await User.hashPassword(require('node:crypto').randomBytes(24).toString('hex')),
      status: 'pending',
    });
  }

  const membership = await Membership.findOneAndUpdate(
    { userId: user._id },
    {
      $setOnInsert: { userId: user._id, invitedByUserId, invitedAt: new Date(), status: 'invited' },
      $set: { roles: roles?.length ? roles : [ROLES.LEARNER] },
    },
    { upsert: true, new: true }
  );

  await AuditLog.create({
    actorUserId: invitedByUserId,
    action: 'membership.invited',
    subjectType: 'User',
    subjectId: user._id,
    meta: { roles: membership.roles },
  });

  return { user, membership };
}

module.exports = { register, authenticate, beginMfaSetup, confirmMfa, invite };
