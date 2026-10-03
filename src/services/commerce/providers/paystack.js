'use strict';

const crypto = require('node:crypto');
const { PaymentProvider } = require('./base');
const logger = require('../../../lib/logger');

// Read NODE_ENV at call time, not a boolean frozen at import — so the fail-closed
// branch is both reliable in production and testable without re-importing config.
const inProduction = () => process.env.NODE_ENV === 'production';

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

  async initialize({ amount, email, reference, callbackUrl, subaccount, transactionCharge }) {
    if (!this.isConfigured()) {
      // In production an unset key must not silently hand the payer a fake checkout
      // URL — that would strand real money. Fail loudly; the dev stub is dev-only.
      if (inProduction()) throw new Error('Paystack is not configured (PAYSTACK_SECRET_KEY missing)');
      logger.info({ reference }, 'paystack initialize (dev stub)');
      return { authorizationUrl: `https://checkout.paystack.test/${reference}`, reference };
    }
    const body = { amount: amount.amount, currency: amount.currency, email, reference };
    if (callbackUrl) body.callback_url = callbackUrl; // return the payer to their fees page
    if (subaccount) {
      // Marketplace split: credit the institution's subaccount, keep Lintel's cut
      // as the transaction charge, and let the subaccount bear Paystack's fee.
      body.subaccount = subaccount;
      if (transactionCharge != null) body.transaction_charge = transactionCharge;
      body.bearer = 'subaccount';
    }
    const res = await fetch(`${this.base}/transaction/initialize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
    if (!this.isConfigured()) {
      // FAIL CLOSED in production. With no secret there is nothing to verify, so a
      // forged `charge.success` would otherwise be accepted and mark invoices (and
      // subscriptions) paid. Only dev/test may accept unsigned, to exercise the path.
      if (inProduction()) {
        logger.error('paystack webhook received but PAYSTACK_SECRET_KEY is not set — rejecting (cannot verify signature)');
        return false;
      }
      return true;
    }
    if (!signature) return false;
    const hash = crypto.createHmac('sha512', this.secret).update(rawBody).digest('hex');
    // Constant-time compare — never leak timing on a signature check.
    const a = Buffer.from(hash);
    const b = Buffer.from(String(signature));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
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
