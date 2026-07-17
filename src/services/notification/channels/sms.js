'use strict';

const { Channel } = require('./base');
const logger = require('../../../lib/logger');

/**
 * SMS. Configured via Termii or Africa's Talking later; logs in development.
 *
 * TRANSACTIONAL ONLY. Nigeria's DND regime filters anything promotional, and a
 * filtered sender reputation is slow to recover. "Your assessment is due Friday"
 * is fine; "See our new course" is not, and the service layer should never send
 * the latter by SMS.
 */
class SmsChannel extends Channel {
  constructor() {
    super();
    this.configured = !!process.env.SMS_API_KEY;
  }
  get key() {
    return 'sms';
  }
  isConfigured() {
    return true; // dev transport
  }
  async send({ to, text }) {
    if (!to) return { providerRef: null, skipped: 'no phone number on file' };
    logger.info({ channel: 'sms', to, preview: (text || '').slice(0, 60) }, 'sms (dev transport)');
    return { providerRef: `dev-${Date.now()}` };
  }
}

module.exports = { SmsChannel };
