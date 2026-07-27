'use strict';

const { SsoAdapter } = require('./base');
const logger = require('../../lib/logger');

/**
 * SAML 2.0 adapter.
 *
 * ⚠ SECURITY BOUNDARY. verify() must validate the XML signature of the assertion
 * against connection.idpCertRef, check the audience, check NotBefore/NotOnOrAfter,
 * and reject replays. This is where SAML deployments get breached (signature
 * wrapping, comment-injection on nameID, missing audience checks). It MUST use a
 * maintained library (e.g. @node-saml/node-saml) and pass a security review before
 * production. Do not hand-roll XML-DSig.
 *
 * A DEV MODE is provided so the whole login flow, identity linking, and tests are
 * exercisable without a live IdP. Dev mode trusts a plain payload and is refused
 * the moment NODE_ENV is production.
 */
class SamlAdapter extends SsoAdapter {
  get protocol() {
    return 'saml';
  }

  async authnRequest(connection, { relayState } = {}) {
    // Real: build a signed AuthnRequest and redirect to idpSsoUrl.
    return { redirectUrl: `${connection.idpSsoUrl}?RelayState=${encodeURIComponent(relayState || '')}` };
  }

  async verify(connection, payload) {
    if (process.env.NODE_ENV === 'production') {
      // The production path requires the vetted library + review (ADR-017).
      throw new Error('SAML verification not configured for production — see ADR-017');
    }
    // DEV ONLY: trust the decoded payload so the flow is testable.
    logger.warn('SAML verify running in DEV trust mode — never in production');
    return {
      subject: payload.nameID || payload.subject,
      attributes: payload.attributes || {},
    };
  }
}

module.exports = { SamlAdapter };
