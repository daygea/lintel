'use strict';

const { ContentBlock, AccessLog, Tenant } = require('../models');
const { currentTenantId, currentUserId } = require('../lib/context');
const { AppError } = require('../lib/errors');
const logger = require('../lib/logger');

/**
 * The archive client. Lintel is an ordinary external API consumer of an archive
 * (OISS's, or any institution's) against a whitelisted publication set. It has no
 * privileged access, caches METADATA ONLY, and never holds media bytes (ADR-004).
 *
 * In this sprint the HTTP client is stubbed — a real fetch() goes here once an
 * archive endpoint exists. What is real now is the CONSENT-REVOCATION handler,
 * because that is the behaviour that matters: when a depositor withdraws consent,
 * every referencing lesson must go dark, and any catalog listing must come down.
 */

/**
 * Resolve a short-TTL playback URL for an archive_ref block. Stubbed transport.
 *
 * Refuses a block whose consent has been revoked. This is belt-and-braces: the
 * eligibility engine should already have withheld the lesson, but a second,
 * independent refusal here means a revoked recording cannot leak even through a
 * caller that forgot to check. Defence in depth is not paranoia when the failure
 * mode is an elder's revoked testimony playing anyway.
 */
async function accessUrl({ block, accessionNumber, purpose = 'lesson_render' }) {
  const ref = block ? block.archiveRef : null;
  const accession = accessionNumber || ref?.accessionNumber;

  if (ref && ref.available === false) {
    throw new AppError('This recording is no longer available: its depositor withdrew consent.', {
      status: 410,
      code: 'archive_consent_revoked',
      expose: true,
    });
  }

  // Real implementation: POST to the archive with { learnerRef, tenantRef, purpose }.
  // The archive performs its OWN consent-tier check — our engine saying "allowed"
  // is not sufficient authority for the archive to release restricted media.
  logger.info({ accessionNumber: accession, purpose }, 'archive access-url requested (stub)');
  return {
    url: `https://archive.example/stream/${encodeURIComponent(accession)}?sig=stub`,
    expiresInSeconds: 300,
  };
}

/**
 * Consent revoked at the archive. Everything referencing this accession goes
 * unavailable NOW: the block stops resolving, and (Sprint 11) any catalog listing
 * that referenced it is unpublished. This is the whole reason archive material is
 * referenced rather than copied — revocation propagates in one write.
 */
async function onConsentRevoked({ accessionNumber, reason }) {
  const blocks = await ContentBlock.find({ 'archiveRef.accessionNumber': accessionNumber }).exec();

  for (const block of blocks) {
    block.archiveRef.available = false;
    block.archiveRef.revokedAt = new Date();
    block.archiveRef.revocationReason = reason;
    block.previewable = false;
    await block.save();

    await AccessLog.create({
      userId: currentUserId(),
      action: 'denied',
      subjectType: 'ContentBlock',
      subjectId: block._id,
      accessionNumber,
      failedRules: ['consent_revoked'],
    });
  }

  logger.warn({ accessionNumber, blocks: blocks.length, reason }, 'archive consent revoked — content withheld');
  return { affectedBlocks: blocks.length };
}

module.exports = { accessUrl, onConsentRevoked };
