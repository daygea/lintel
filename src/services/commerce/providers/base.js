'use strict';

/**
 * Every payment provider implements the same shape. Paystack ships first;
 * Flutterwave and Stripe are later adapters against this identical interface, so
 * nobody hardcodes Paystack into the service layer.
 *
 *   initialize({ invoice, amount, email, reference }) -> { authorizationUrl, reference }
 *   verify(reference) -> { paid: bool, amount, currency, providerRef }
 *   verifyWebhook(rawBody, signature) -> bool
 *   parseWebhook(body) -> { event, reference, amount, currency, providerRef }
 */
class PaymentProvider {
  get key() {
    throw new Error('provider must define a key');
  }
  isConfigured() {
    return false;
  }
  async initialize() {
    throw new Error(`${this.key} does not implement initialize()`);
  }
  async verify() {
    throw new Error(`${this.key} does not implement verify()`);
  }
  verifyWebhook() {
    return false;
  }
  parseWebhook() {
    throw new Error(`${this.key} does not implement parseWebhook()`);
  }
}

module.exports = { PaymentProvider };
