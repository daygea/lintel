'use strict';

const crypto = require('node:crypto');
const {
  CredentialTemplate, Credential, User, AuditLog, Tenant,
} = require('../models');
const { ValidationError } = require('../lib/errors');
const { currentUserId, currentTenantId, runAsPlatform } = require('../lib/context');

/* ------------------------------------------------------------------ templates */

const listTemplates = () => CredentialTemplate.find({}).sort({ slug: 1 }).exec();
async function createTemplate(data) {
  if (!data.slug || !data.title) throw new ValidationError('A template needs a slug and a title');
  return CredentialTemplate.create(data);
}

/* ---------------------------------------------------------------- issuance */

/**
 * Issue a credential to a learner. The serial is generated from the template's
 * format; the verification code is a separate, unguessable token. We snapshot the
 * holder's name and the award title at issue time, so the printed certificate
 * never drifts if the person later changes their name or the template changes.
 */
async function issue({ templateId, userId }) {
  const template = await CredentialTemplate.findById(templateId).exec();
  if (!template) throw new ValidationError('No such template');

  const user = await User.findById(userId).exec();
  if (!user) throw new ValidationError('No such learner');

  const seq = (await Credential.countDocuments({}).exec()) + 1;
  const serial = template.serialFormat
    .replace('{YEAR}', new Date().getFullYear())
    .replace('{SEQ}', String(seq).padStart(5, '0'))
    .replace('{SLUG}', template.slug.toUpperCase());

  const credential = await Credential.create({
    templateId,
    userId,
    serial,
    verificationCode: crypto.randomBytes(16).toString('hex'),
    holderName: user.name,
    awardTitle: template.title,
    issuedByUserId: currentUserId(),
  });

  await AuditLog.create({
    actorUserId: currentUserId(),
    action: 'credential.issued',
    subjectType: 'Credential',
    subjectId: credential._id,
    meta: { serial, userId: String(userId) },
  });

  return credential;
}

/** Revocation flips a field the public verifier reads. Audited; nothing deleted. */
async function revoke({ credentialId, reason }) {
  const credential = await Credential.findById(credentialId).exec();
  if (!credential) throw new ValidationError('No such credential');
  if (credential.revokedAt) throw new ValidationError('Already revoked');

  await Credential.updateOne(
    { _id: credentialId },
    { revokedAt: new Date(), revocationReason: reason }
  ).exec();

  await AuditLog.create({
    actorUserId: currentUserId(),
    action: 'credential.revoked',
    subjectType: 'Credential',
    subjectId: credential._id,
    meta: { reason },
  });
  return Credential.findById(credentialId).exec();
}

const listFor = (userId) => Credential.find({ userId }).sort({ issuedAt: -1 }).exec();
const listAll = () => Credential.find({}).sort({ issuedAt: -1 }).limit(200).exec();

/**
 * PUBLIC verification. Called with no session, across tenants, by a stranger with
 * a QR. Returns ONLY: the award, the holder's name, the date, and validity.
 *
 * NEVER marks, standings, transcript, or what was taught. That restraint is the
 * product's promise made visible — a credential proves an award and nothing more,
 * so a verifier learns nothing that could embarrass or expose the holder.
 *
 * Runs as platform because the caller has no tenant; the verification code is
 * globally unique enough (128-bit) to resolve without one.
 */
async function verifyPublic(verificationCode) {
  return runAsPlatform('public credential verification (no session)', async () => {
    const credential = await Credential.findOne({ verificationCode }).exec();
    if (!credential) return { valid: false, reason: 'not_found' };

    const tenant = await Tenant.findById(credential.tenantId).exec();

    return {
      valid: !credential.revokedAt,
      revoked: !!credential.revokedAt,
      // Deliberately minimal. This object is the ENTIRE public surface.
      award: credential.awardTitle,
      holderName: credential.holderName,
      issuedAt: credential.issuedAt,
      serial: credential.serial,
      institution: tenant?.name,
    };
  });
}

module.exports = {
  listTemplates, createTemplate,
  issue, revoke, listFor, listAll, verifyPublic,
};
