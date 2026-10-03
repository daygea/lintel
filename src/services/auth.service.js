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
  // Neutral message — do not confirm to an anonymous caller whether an email is registered.
  if (existing) throw new ValidationError('That email can’t be registered. If it’s yours, sign in instead.');

  const user = await User.create({
    email: email.toLowerCase(),
    name,
    passwordHash: await User.hashPassword(password),
    status: 'active',
  });
  return user;
}

/**
 * Step one of sign-in: verify the password only. Returns the user and whether a
 * second factor is still required. Never reveals whether the email exists — an
 * unknown email spends the same bcrypt time (dummyVerify) and yields the same
 * generic error as a wrong password, closing the enumeration + timing oracle.
 */
async function authenticatePassword({ email, password }) {
  const user = await User.findOne({ email: String(email || '').toLowerCase() }).select('+passwordHash +mfa.secret');
  if (!user) {
    await User.dummyVerify(); // equalise timing for a non-existent account
    throw new NotAuthenticatedError();
  }
  const ok = await user.verifyPassword(password || '');
  if (!ok) throw new NotAuthenticatedError();
  return { user, mfaRequired: !!user.mfa?.enabled };
}

/**
 * Step two: verify a TOTP code for an already password-verified user, and burn it.
 * Single-use within its 30s step, so an observed code can't be replayed.
 */
async function verifyTotp({ user, totp }) {
  // Always load the secret AND the last-used step, so single-use is enforced on
  // every path (the one-shot authenticate() has the secret but not the step).
  const fresh = await User.findById(user._id).select('+mfa.secret +mfa.lastTotpStep');
  if (!fresh || !fresh.mfa?.secret) throw new NotAuthenticatedError();
  if (!totp || !authenticator.check(String(totp), fresh.mfa.secret)) throw new NotAuthenticatedError();

  const step = Math.floor(Date.now() / 30000);
  if (fresh.mfa.lastTotpStep === step) {
    throw new NotAuthenticatedError('That code was just used. Wait for the next one.');
  }
  await User.updateOne({ _id: fresh._id }, { $set: { 'mfa.lastTotpStep': step } }).exec();
  return true;
}

/**
 * One-shot authenticate (JSON API / tests): password + optional TOTP together.
 * The web flow uses authenticatePassword + verifyTotp as two steps instead.
 */
async function authenticate({ email, password, totp }) {
  const { user, mfaRequired } = await authenticatePassword({ email, password });
  if (mfaRequired) {
    if (!totp) throw new ValidationError('Enter the code from your authenticator app');
    await verifyTotp({ user, totp });
  }
  await User.updateOne({ _id: user._id }, { $set: { lastSeenAt: new Date() } }).exec();
  return user;
}

/**
 * Change a password for a signed-in user. Verifies the current password, applies
 * the new one, clears the force-change flag, and bumps sessionEpoch so every OTHER
 * session for this account is invalidated.
 */
async function changePassword({ userId, currentPassword, newPassword }) {
  if (!newPassword || String(newPassword).length < 10) {
    throw new ValidationError('Use at least 10 characters');
  }
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw new NotAuthenticatedError();
  const ok = await user.verifyPassword(currentPassword || '');
  if (!ok) throw new ValidationError('Your current password is not right');
  await User.updateOne(
    { _id: user._id },
    { passwordHash: await User.hashPassword(newPassword), mustChangePassword: false, $inc: { sessionEpoch: 1 } }
  ).exec();
  return { ok: true, sessionEpoch: (user.sessionEpoch || 0) + 1 };
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

/** Turn two-factor off and forget the secret. */
async function disableMfa(user) {
  await User.updateOne({ _id: user._id }, { $set: { 'mfa.enabled': false }, $unset: { 'mfa.secret': '' } });
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

/**
 * Self-registration: a person signs up into an institution FROM its own page.
 *
 * SECURITY: this can only ever create a LEARNER membership in status 'pending'.
 * A self-registrant cannot choose a role — allowing that would let a stranger
 * self-grant 'elder' or 'admin' and walk straight through the eligibility engine.
 * The institution's registrar admits them; until then they hold no standing and
 * see only open material. Runs inside the institution's tenant context.
 */
async function selfRegister({ email, name }) {
  const { currentTenantId } = require('../lib/context');
  const { sendAccountDetails } = require('./onboarding.service');
  const clean = String(email || '').toLowerCase().trim();
  if (!clean || !name) throw new ValidationError('We need your name and email to register.');

  let user = await User.findOne({ email: clean });
  let created = false;
  if (!user) {
    user = await User.create({
      email: clean,
      name,
      passwordHash: await User.hashPassword(require('node:crypto').randomBytes(24).toString('hex')),
      status: 'pending',
    });
    created = true;
  }

  // Refuse if they already hold ANY membership here — they should sign in, not
  // re-register (and we must never re-scope an existing member to learner).
  const existing = await Membership.findOne({ userId: user._id }).exec();
  if (existing) throw new ValidationError('An account with this email already exists here. Please sign in.');

  await Membership.create({
    userId: user._id,
    roles: [ROLES.LEARNER],          // LOCKED — never anything else
    status: 'pending',               // awaits registrar admission
    joinedAt: null,
  });

  await AuditLog.create({
    actorUserId: user._id,
    action: 'membership.self_registered',
    subjectType: 'User',
    subjectId: user._id,
    meta: { role: ROLES.LEARNER },
  });

  // Tell the people who can admit — best-effort, never blocks the registration.
  try {
    const { notify } = require('./notification');
    const admitters = await Membership.find({
      roles: { $in: [ROLES.OWNER, ROLES.ADMIN, ROLES.REGISTRAR] },
      status: 'active',
    }).exec();
    for (const m of admitters) {
      await notify({
        userId: m.userId,
        template: 'member.awaiting_admission',
        channels: ['email'],
        data: { learnerName: name, learnerEmail: clean },
      });
    }
  } catch (err) {
    // notification is best-effort; a failure must not fail the registration
  }

  // New accounts get a set-password link so they can sign in once admitted.
  if (created) {
    await sendAccountDetails({
      userId: user._id,
      tenantId: currentTenantId(),
      institutionName: undefined,
      roleLabel: 'learner',
      withTempPassword: false, // link only for self-serve; no phone fallback needed
    });
  }

  return { user, pending: true };
}

module.exports = {
  register, authenticate, authenticatePassword, verifyTotp, changePassword,
  beginMfaSetup, confirmMfa, disableMfa, invite, selfRegister,
};
