'use strict';

const crypto = require('node:crypto');
const { User, OnboardingToken, Tenant } = require('../models');
const { notify } = require('./notification');
const { runAsPlatform } = require('../lib/context');
const { ValidationError } = require('../lib/errors');
const { rootDomain } = require('../config/env');

const TOKEN_TTL_HOURS = 48;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Issue a set-password link for a user, and (optionally) a temporary password as
 * a fallback. Returns the raw link and, if generated, the temp password — the
 * CALLER decides how to deliver them (normally via sendAccountDetails below).
 *
 * We store only the hash of the token. The raw value exists exactly once, in the
 * link we return; it is never persisted in a form that a database leak could use.
 */
async function issueOnboarding({ userId, tenantId, withTempPassword = false, purpose = 'set_password' }) {
  const raw = crypto.randomBytes(32).toString('base64url'); // 256-bit
  const token = await OnboardingToken.create({
    userId,
    tenantId,
    tokenHash: sha256(raw),
    purpose,
    expiresAt: new Date(Date.now() + TOKEN_TTL_HOURS * 3600 * 1000),
  });

  let tempPassword;
  if (withTempPassword) {
    // A readable-but-random temp password: three short groups. Usable over the
    // phone, but the account is flagged mustChangePassword so it can't persist.
    tempPassword = [rand(4), rand(4), rand(4)].join('-');
    await User.updateOne(
      { _id: userId },
      { passwordHash: await User.hashPassword(tempPassword), mustChangePassword: true }
    ).exec();
  }

  const host = await hostFor(tenantId);
  const link = `https://${host}/onboard/${raw}`;
  return { link, tempPassword, tokenId: token._id, expiresInHours: TOKEN_TTL_HOURS };
}

/**
 * Consume a set-password link: validate the token, set the new password, activate
 * the account, and clear any temp-password flag. Single-use — the token is marked
 * consumed and cannot be replayed. Runs as platform (the clicker has no session).
 */
async function consumeOnboarding({ rawToken, newPassword }) {
  if (!newPassword || String(newPassword).length < 8) {
    throw new ValidationError('Choose a password of at least 8 characters.');
  }
  return runAsPlatform('onboarding set-password (no session)', async () => {
    const token = await OnboardingToken.findOne({ tokenHash: sha256(rawToken) }).exec();
    if (!token) throw new ValidationError('This link is invalid.');
    if (token.consumedAt) throw new ValidationError('This link has already been used.');
    if (token.expiresAt < new Date()) throw new ValidationError('This link has expired. Ask for a new one.');

    await User.updateOne(
      { _id: token.userId },
      { passwordHash: await User.hashPassword(newPassword), status: 'active', mustChangePassword: false }
    ).exec();
    await OnboardingToken.updateOne({ _id: token._id }, { consumedAt: new Date() }).exec();

    const user = await User.findById(token.userId).exec();
    return { user, tenantId: token.tenantId };
  });
}

/**
 * Send the account-details email: a welcome, the set-password link, and (if the
 * fallback is used) the temporary password with a clear instruction to change it.
 * The email NEVER contains a permanent password.
 */
async function sendAccountDetails({ userId, tenantId, institutionName, roleLabel, withTempPassword }) {
  const { link, tempPassword, expiresInHours } = await issueOnboarding({ userId, tenantId, withTempPassword });

  await notify({
    userId,
    template: 'account_created',
    channels: ['email'],
    data: {
      institutionName,
      roleLabel: roleLabel || 'member',
      setPasswordUrl: link,
      expiresInHours,
      tempPassword: tempPassword || null, // template shows the fallback block only if present
    },
  });

  return { link, tempPassword };
}

/* ------------------------------------------------------------------ helpers */

function rand(n) {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789'; // no ambiguous chars
  return Array.from({ length: n }, () => a[crypto.randomInt(a.length)]).join('');
}

/**
 * The host a link should point at: the institution's own subdomain, so the person
 * lands in the right place. Looked up as platform because we may have no tenant
 * context here. Falls back to the apex if the tenant is somehow gone.
 */
async function hostFor(tenantId) {
  if (!tenantId) return rootDomain;
  const t = await runAsPlatform('onboarding link host lookup', () => Tenant.findById(tenantId).exec());
  return t ? `${t.slug}.${rootDomain}` : rootDomain;
}

module.exports = { issueOnboarding, consumeOnboarding, sendAccountDetails, TOKEN_TTL_HOURS };
