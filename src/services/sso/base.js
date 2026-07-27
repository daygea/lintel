'use strict';

/**
 * An SSO adapter turns a protocol exchange into a VERIFIED { subject, attributes }
 * that identity.service can trust. The security-critical responsibility — proving
 * the assertion genuinely came from the configured IdP and was not tampered with —
 * lives ENTIRELY in verify(). Everything downstream assumes verify() did its job.
 *
 *   authnRequest(connection) -> { redirectUrl }        // send the user to the IdP
 *   verify(connection, payload) -> { subject, attributes }  // MUST check signature
 *
 * See ADR-017: the concrete verify() implementations use a vetted library and
 * require a security review before production. The interface exists now so the
 * flow, the identity linking, and the tests are real; the crypto is pluggable.
 */
class SsoAdapter {
  get protocol() {
    throw new Error('adapter must define a protocol');
  }
  async authnRequest() {
    throw new Error(`${this.protocol}: authnRequest not implemented`);
  }
  async verify() {
    throw new Error(`${this.protocol}: verify not implemented`);
  }
}

module.exports = { SsoAdapter };
