'use strict';

/**
 * Every channel implements the same shape:
 *   { key, isConfigured(), async send({ to, subject, text, html, data }) -> { providerRef } }
 *
 * A channel that is not configured reports so and is skipped, never crashed —
 * a tenant with no SMS provider should still be able to send email.
 */
class Channel {
  get key() {
    throw new Error('channel must define a key');
  }
  isConfigured() {
    return false;
  }
  async send() {
    throw new Error(`${this.key} channel does not implement send()`);
  }
}

module.exports = { Channel };
