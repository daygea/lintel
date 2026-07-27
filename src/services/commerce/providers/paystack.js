'use strict';

const crypto = require('node:crypto');
const { PaymentProvider } = require('./base');
const logger = require('../../../lib/logger');

/**
 * Paystack. Amounts to Paystack are in kobo/minor units — which is exactly how
 * Money stores them, so no float ever appears. In development, with no secret
 * key, initialize() returns a stub URL so the whole flow is testable without a
 * live account; verify() and the webhook path are exercised by tests directly.
 */
class PaystackProvider extends PaymentProvider {
  constructor() {
    super();
    this.secret = process.env.PAYSTACK_SECRET_KEY;
    this.base = 'https://api.paystack.co';
  }

  get key() {
    return 'paystack';
  }
  isConfigured() {
    return !!this.secret;
  }

  async initialize({ amount, email, reference }) {
    if (!this.isConfigured()) {
      logger.info({ reference }, 'paystack initialize (dev stub)');
      return { authorizationUrl: `https://checkout.paystack.test/${reference}`, reference };
    }
    const res = await fetch(`${this.base}/transaction/initialize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amount.amount, currency: amount.currency, email, reference }),
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || 'Paystack initialize failed');
    return { authorizationUrl: data.data.authorization_url, reference: data.data.reference };
  }

  async verify(reference) {
    if (!this.isConfigured()) return { paid: false, providerRef: reference };
    const res = await fetch(`${this.base}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${this.secret}` },
    });
    const data = await res.json();
    const ok = data.status && data.data.status === 'success';
    return {
      paid: ok,
      amount: { amount: data.data?.amount, currency: data.data?.currency || 'NGN' },
      providerRef: data.data?.reference || reference,
    };
  }

  /** Paystack signs webhooks with HMAC-SHA512 of the raw body using the secret. */
  verifyWebhook(rawBody, signature) {
    if (!this.isConfigured()) return true; // dev: accept, so the path is testable
    const hash = crypto.createHmac('sha512', this.secret).update(rawBody).digest('hex');
    return hash === signature;
  }

  parseWebhook(body) {
    return {
      event: body.event,
      reference: body.data?.reference,
      amount: { amount: body.data?.amount, currency: body.data?.currency || 'NGN' },
      providerRef: body.data?.reference,
    };
  }
}

module.exports = { PaystackProvider };
