'use strict';

/**
 * Webhook signature verification (Oct-2026 audit, #1). The whole idempotent-payment
 * story trusts this check: a forged `charge.success` must never be accepted. So it
 * must be strict when configured, and FAIL CLOSED in production when it can't verify.
 */

const crypto = require('node:crypto');

describe('paystack webhook signature', () => {
  const raw = JSON.stringify({ event: 'charge.success', data: { reference: 't_i_r', amount: 500000 } });

  describe('configured', () => {
    let provider, savedKey;
    const SECRET = 'sk_test_whsec';
    beforeEach(() => {
      savedKey = process.env.PAYSTACK_SECRET_KEY;
      process.env.PAYSTACK_SECRET_KEY = SECRET;
      const { PaystackProvider } = require('../../src/services/commerce/providers/paystack');
      provider = new PaystackProvider();
    });
    afterEach(() => { process.env.PAYSTACK_SECRET_KEY = savedKey; });

    const sign = (body) => crypto.createHmac('sha512', SECRET).update(body).digest('hex');

    it('accepts a correctly signed body', () => {
      expect(provider.verifyWebhook(raw, sign(raw))).toBe(true);
    });
    it('rejects a wrong signature', () => {
      expect(provider.verifyWebhook(raw, sign(raw + 'tampered'))).toBe(false);
    });
    it('rejects a missing signature', () => {
      expect(provider.verifyWebhook(raw, undefined)).toBe(false);
    });
    it('rejects a tampered body under a signature for the original', () => {
      expect(provider.verifyWebhook(raw + ' ', sign(raw))).toBe(false);
    });
  });

  it('accepts unsigned only in development (dev stub)', () => {
    const savedKey = process.env.PAYSTACK_SECRET_KEY;
    delete process.env.PAYSTACK_SECRET_KEY; // NODE_ENV is 'test' here → not prod
    try {
      const { PaystackProvider } = require('../../src/services/commerce/providers/paystack');
      expect(new PaystackProvider().verifyWebhook(raw, 'anything')).toBe(true);
    } finally {
      if (savedKey) process.env.PAYSTACK_SECRET_KEY = savedKey;
    }
  });

  it('fails closed when unconfigured in production', () => {
    // The provider reads NODE_ENV at call time, so no module mocking is needed —
    // set it for the duration of the call and restore it immediately after.
    const savedKey = process.env.PAYSTACK_SECRET_KEY;
    const savedEnv = process.env.NODE_ENV;
    delete process.env.PAYSTACK_SECRET_KEY;
    process.env.NODE_ENV = 'production';
    try {
      const { PaystackProvider } = require('../../src/services/commerce/providers/paystack');
      expect(new PaystackProvider().verifyWebhook(raw, 'anything')).toBe(false);
    } finally {
      process.env.NODE_ENV = savedEnv;
      if (savedKey) process.env.PAYSTACK_SECRET_KEY = savedKey;
    }
  });
});
