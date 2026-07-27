'use strict';

const { User, Membership, ExternalIdentity, SsoConnection, AuditLog } = require('../models');
const { ValidationError } = require('../lib/errors');
const { currentTenantId } = require('../lib/context');
const logger = require('../lib/logger');

/**
 * The identity-linking core — protocol-agnostic and fully testable.
 *
 * A verified assertion (from EITHER a SAML adapter or an OIDC adapter, after that
 * adapter has checked the signature) arrives here as a plain
 * { subject, attributes } object. This function turns it into a logged-in User +
 * Membership, respecting tenant isolation and never minting duplicates.
 *
 * It does NOT verify signatures — that is the adapter's job, and it must have
 * happened before we are called. Passing an unverified assertion here is a bug in
 * the caller; this function assumes authenticity has already been established.
 */
async function resolveFromAssertion({ connectionId, subject, attributes }) {
  if (!subject) throw new ValidationError('Assertion carried no stable subject');

  const connection = await SsoConnection.findById(connectionId).exec();
  if (!connection || !connection.enabled) throw new ValidationError('SSO connection not enabled');

  const map = connection.attributeMap || {};
  const email = attributes[map.email || 'email'];
  const name = attributes[map.name || 'name'] || email;

  // 1. Have we seen this exact external subject before? Then it's a known person.
  let identity = await ExternalIdentity.findOne({ source: 'sso', connectionId, subject }).exec();
  let user;

  if (identity) {
    user = await User.findById(identity.userId).exec();
    await ExternalIdentity.updateOne({ _id: identity._id }, { lastSeenAt: new Date() }).exec();
  } else {
    // 2. New subject. Link to an existing User by email if one exists, else
    //    provision — but only if the connection permits it.
    user = email ? await User.findOne({ email }).exec() : null;

    if (!user) {
      if (!connection.autoProvision) {
        throw new ValidationError('No account for this identity, and auto-provisioning is off');
      }
      user = await User.create({ email, name, status: 'active', passwordHash: null, ssoOnly: true });
    }

    identity = await ExternalIdentity.create({
      userId: user._id,
      source: 'sso',
      connectionId,
      subject,
      lastSeenAt: new Date(),
    });
    await audit('sso.identity_linked', user._id, { subject, connectionId: String(connectionId) });
  }

  // 3. Ensure a Membership with the mapped role.
  await ensureMembership(user._id, mappedRole(connection, attributes));

  await audit('sso.login', user._id, { connectionId: String(connectionId) });
  return user;
}

/** Translate an incoming role claim to one of our roles, via the tenant's roleMap. */
function mappedRole(connection, attributes) {
  const claimName = connection.attributeMap?.role;
  const raw = claimName ? attributes[claimName] : null;
  if (raw && connection.roleMap && connection.roleMap.get(String(raw))) {
    return connection.roleMap.get(String(raw));
  }
  return connection.defaultRole || 'learner';
}

async function ensureMembership(userId, role) {
  const existing = await Membership.findOne({ userId }).exec();
  if (!existing) {
    await Membership.create({ userId, roles: [role], status: 'active' });
    return;
  }
  if (!existing.roles.includes(role)) {
    // Add the role; never silently downgrade an existing higher role.
    await Membership.updateOne({ _id: existing._id }, { $addToSet: { roles: role } }).exec();
  }
}

const audit = (action, subjectId, meta) =>
  AuditLog.create({ actorUserId: subjectId, action, subjectType: 'User', subjectId, meta });

module.exports = { resolveFromAssertion, ensureMembership, mappedRole };
