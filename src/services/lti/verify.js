'use strict';

const { NotAuthorisedError } = require('../../lib/errors');
const logger = require('../../lib/logger');

/**
 * ⚠ SECURITY BOUNDARY — same posture as SSO (ADR-017).
 *
 * A production implementation must:
 *   - verify the tool's bearer token / id_token signature against its JWKS
 *     (fetched from tool.jwksUrl, cached, key-rotation-aware)
 *   - check issuer, audience (our clientId), and expiry
 *   - confirm the requested scope is one the tool was granted
 *   - reject a replayed nonce
 * using a maintained JOSE/JWKS library and a security review before production.
 * LTI 1.3 launches are OIDC id_tokens; the same crypto rules apply.
 *
 * DEV MODE lets the full flow, the AGS write into Score, and the tests run
 * without a live tool. It checks the scope (which is our own authorization logic,
 * not crypto) but trusts the token's origin. It REFUSES to run in production.
 */
async function verifyToolJwt(tool, token, requiredScope) {
  // Scope enforcement is OUR logic and always runs — even in dev. A tool without
  // the scope is refused regardless of token authenticity.
  if (requiredScope && !(tool.scopes || []).includes(requiredScope)) {
    throw new NotAuthorisedError(`Tool lacks the required scope: ${requiredScope}`);
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('LTI token verification not configured for production — see ADR-017');
  }

  logger.warn('LTI verifyToolJwt running in DEV trust mode — never in production');
  return { ok: true };
}

/**
 * Signs an LTI launch id_token with our key for this tool. Production uses the
 * referenced signing key (tool.keySetRef) and a JOSE library; dev returns an
 * unsigned, clearly-marked token so a launch can be inspected end to end.
 */
async function signLaunch(tool, claims) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('LTI launch signing not configured for production — see ADR-017');
  }
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.dev-unsigned`;
}

module.exports = { verifyToolJwt, signLaunch };
