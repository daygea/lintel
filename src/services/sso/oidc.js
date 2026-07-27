'use strict';

const { SsoAdapter } = require('./base');
const logger = require('../../lib/logger');

/**
 * OpenID Connect adapter.
 *
 * ⚠ SECURITY BOUNDARY. verify() must validate the ID token: signature against the
 * IdP's JWKS, issuer, audience (clientId), expiry, and nonce. Use a maintained
 * library (e.g. openid-client) and review before production (ADR-017).
 *
 * DEV MODE mirrors the SAML adapter: a plain payload is trusted so the flow and
 * tests run without a live IdP, and is refused in production.
 */
class OidcAdapter extends SsoAdapter {
  get protocol() {
    return 'oidc';
  }

  async authnRequest(connection, { state } = {}) {
    const url = new URL(connection.discoveryUrl || `${connection.issuer}/authorize`);
    url.searchParams.set('client_id', connection.clientId || '');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    if (state) url.searchParams.set('state', state);
    return { redirectUrl: url.toString() };
  }

  async verify(connection, payload) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('OIDC verification not configured for production — see ADR-017');
    }
    logger.warn('OIDC verify running in DEV trust mode — never in production');
    const claims = payload.claims || payload;
    return { subject: claims.sub, attributes: claims };
  }
}

module.exports = { OidcAdapter };
