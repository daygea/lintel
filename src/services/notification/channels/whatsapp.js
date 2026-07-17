'use strict';

const { Channel } = require('./base');
const { AppError } = require('../../../lib/errors');

/**
 * WhatsApp — a STUB, by decision (ADR-013).
 *
 * The seam exists so that the day a tenant needs WhatsApp it is a week of work,
 * not a re-architecture. It is not built, because WhatsApp Business API access is
 * gated on Meta's approval, which can idle a solo builder for a whole sprint, and
 * that is the only such gatekeeper in the entire plan.
 *
 * It throws loudly. Do NOT route around it with a direct call elsewhere — the
 * seam is the whole point.
 */
class WhatsAppChannel extends Channel {
  get key() {
    return 'whatsapp';
  }
  isConfigured() {
    return false;
  }
  async send() {
    throw new AppError('WhatsApp is not implemented (ADR-013). Use email or SMS.', {
      status: 501,
      code: 'not_implemented',
      expose: true,
    });
  }
}

module.exports = { WhatsAppChannel };
