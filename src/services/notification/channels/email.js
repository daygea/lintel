'use strict';

const { Channel } = require('./base');
const env = require('../../../config/env');
const logger = require('../../../lib/logger');

/**
 * Email. Sends through Resend's HTTP API when RESEND_API_KEY and EMAIL_FROM are
 * set; otherwise falls back to a dev log transport (writes the full body to the
 * log) so the whole notification path stays testable without a provider account.
 *
 * The channel is always "configured" — it either sends or logs — so a fresh
 * install still exercises onboarding without blocking on credentials. On a real
 * provider error it throws, and the dispatcher records the attempt as failed.
 *
 * Resend was chosen for deliverability (including to Nigerian inboxes) and a
 * plain HTTP interface. A different provider (Postmark, SES) is a one-method swap
 * behind this same Channel contract.
 */
class EmailChannel extends Channel {
  get key() {
    return 'email';
  }

  isConfigured() {
    return true; // always available: sends when creds are present, logs otherwise
  }

  async send({ to, subject, text, html }) {
    const { resendApiKey, from, configured } = env.email;

    if (!configured) {
      // Dev transport: log the FULL body — set-password links and temp passwords
      // live past the first line, so a preview would hide exactly what's needed.
      logger.info(
        { channel: 'email', to, subject, transport: 'dev' },
        `email (dev transport)\n--- to: ${to} | ${subject} ---\n${text || ''}\n---`
      );
      return { providerRef: `dev-${Date.now()}` };
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, text, ...(html ? { html } : {}) }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Thrown, not swallowed — notify() marks this attempt 'failed' and logs it.
      throw new Error(`Resend responded ${res.status}: ${body.slice(0, 200)}`);
    }

    const out = await res.json().catch(() => ({}));
    logger.info({ channel: 'email', to, providerRef: out.id }, 'email sent');
    return { providerRef: out.id ? `resend-${out.id}` : 'resend' };
  }
}

module.exports = { EmailChannel };
