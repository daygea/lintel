'use strict';

const { AttestationType, Attestation, Membership, AuditLog } = require('../models');
const { ValidationError, NotAuthorisedError } = require('../lib/errors');
const { currentUserId } = require('../lib/context');

/* ------------------------------------------------------------------- types */

const listTypes = () => AttestationType.find({}).sort({ slug: 1 }).exec();

async function createType(data) {
  if (!data.slug || !data.label) throw new ValidationError('A standing needs a slug and a label');
  return AttestationType.create(data);
}

/* ------------------------------------------------------------- attestations */

/**
 * Issue an attestation. Only a person holding the role the type requires may do
 * it — never the software, never a payment. The issuer is recorded.
 */
async function issue({ subjectUserId, typeSlug, value, note, evidenceAssetId, expiresAt }) {
  const type = await AttestationType.findOne({ slug: typeSlug }).exec();
  if (!type) throw new ValidationError(`No such standing: ${typeSlug}`);

  const issuer = await Membership.findOne({ userId: currentUserId(), status: 'active' }).exec();
  if (!issuer || !issuer.roles.includes(type.requiresIssuerRole)) {
    throw new NotAuthorisedError(
      `Only a ${type.requiresIssuerRole} may grant "${typeSlug}"`
    );
  }

  const expires =
    expiresAt ||
    (type.defaultValidityDays
      ? new Date(Date.now() + type.defaultValidityDays * 86400000)
      : undefined);

  const attestation = await Attestation.create({
    subjectUserId,
    typeSlug,
    status: 'active',
    value,
    note,
    evidenceAssetId,
    expiresAt: expires,
    issuedByUserId: currentUserId(),
  });

  await AuditLog.create({
    actorUserId: currentUserId(),
    action: 'attestation.issued',
    subjectType: 'Attestation',
    subjectId: attestation._id,
    meta: { typeSlug, subjectUserId: String(subjectUserId) },
  });

  return attestation;
}

/**
 * Revoke. This WRITES a new record — it does not touch the original grant. The
 * institution's history stays intact: the grant and the withdrawal both survive,
 * each with its author and reason.
 */
async function revoke({ attestationId, reason }) {
  const grant = await Attestation.findById(attestationId).exec();
  if (!grant) throw new ValidationError('No such attestation');
  if (grant.status !== 'active') throw new ValidationError('That attestation is not active');

  const issuer = await Membership.findOne({ userId: currentUserId(), status: 'active' }).exec();
  const type = await AttestationType.findOne({ slug: grant.typeSlug }).exec();
  if (!issuer || !type || !issuer.roles.includes(type.requiresIssuerRole)) {
    throw new NotAuthorisedError('You may not revoke this standing');
  }

  const revocation = await Attestation.create({
    subjectUserId: grant.subjectUserId,
    typeSlug: grant.typeSlug,
    status: 'revoked',
    issuedByUserId: currentUserId(),
    revokesAttestationId: grant._id,
    revocationReason: reason,
  });

  await AuditLog.create({
    actorUserId: currentUserId(),
    action: 'attestation.revoked',
    subjectType: 'Attestation',
    subjectId: revocation._id,
    meta: { revokes: String(grant._id), reason },
  });

  return revocation;
}

/**
 * The register view: for each (subject, type), the latest record and whether it
 * is currently in force. Computed, never stored.
 */
async function currentFor(subjectUserId) {
  const all = await Attestation.find({ subjectUserId }).sort({ createdAt: -1 }).exec();
  const seen = new Set();
  const current = [];
  for (const a of all) {
    if (seen.has(a.typeSlug)) continue;
    seen.add(a.typeSlug);
    const inForce = a.status === 'active' && (!a.expiresAt || a.expiresAt > new Date());
    current.push({ typeSlug: a.typeSlug, inForce, attestation: a });
  }
  return current;
}

const listAll = () => Attestation.find({}).sort({ createdAt: -1 }).limit(200).exec();

module.exports = { listTypes, createType, issue, revoke, currentFor, listAll };
