'use strict';

const { Channel } = require('./base');
const logger = require('../../../lib/logger');

/**
 * Email. In development, and until an SMTP provider is wired, this logs instead
 * of sending — so the whole notification path is testable without a provider
 * account, and nobody is blocked waiting on one.
 *
 * Swap the body of send() for nodemailer/Resend/SES when ready. The interface
 * does not change.
 */
class EmailChannel extends Channel {
  get key() {
    return 'email';
  }
  isConfigured() {
    return true; // the log transport is always "configured"
  }
  async send({ to, subject, text }) {
    logger.info({ channel: 'email', to, subject, preview: (text || '').slice(0, 80) }, 'email (dev transport)');
    return { providerRef: `dev-${Date.now()}` };
  }
}

module.exports = { EmailChannel };
