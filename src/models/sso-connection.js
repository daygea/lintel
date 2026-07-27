'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');

/**
 * A tenant's identity provider. One institution may connect its existing SSO so
 * staff and learners sign in with credentials they already have.
 *
 * The attribute map is the crucial, tenant-specific part: which claim in the
 * assertion carries the email, the name, the role. It is DATA — a university's
 * IdP might emit "eduPersonAffiliation"; a hospital's something else. Per
 * invariant 1, none of that is hardcoded.
 *
 * SECURITY: clientSecret / signing certs are sensitive. In production these
 * belong in a secrets manager, not this collection — the field holds a REFERENCE
 * (an env key name or vault path), not the secret itself. See ADR-017.
 */
const SsoConnectionSchema = new Schema(
  {
    label: { type: String, required: true }, // @admin-string — config name ("Campus Okta"), never shown to a learner
    protocol: { type: String, enum: ['saml', 'oidc'], required: true },
    enabled: { type: Boolean, default: false },

    // SAML
    idpEntityId: String,
    idpSsoUrl: String,
    idpCertRef: String, // reference to the signing cert, not the cert itself

    // OIDC
    issuer: String,
    clientId: String,
    clientSecretRef: String, // reference, not the secret
    discoveryUrl: String,

    /** claim/attribute name → our field. e.g. { email: 'mail', name: 'displayName' } */
    attributeMap: {
      email: { type: String, default: 'email' },
      name: { type: String, default: 'name' },
      role: { type: String, default: null }, // optional: a claim that carries role
    },

    /** How to map an incoming role claim value to our roles. Data, not code. */
    roleMap: { type: Map, of: String, default: undefined },
    /** Role given to a user who arrives with no mappable role claim. */
    defaultRole: { type: String, default: 'learner' },

    /** If true, a user who is not already provisioned is created on first login. */
    autoProvision: { type: Boolean, default: true },
  },
  { timestamps: true }
);

SsoConnectionSchema.plugin(tenantGuard);
SsoConnectionSchema.index({ tenantId: 1, protocol: 1 });

module.exports = mongoose.model('SsoConnection', SsoConnectionSchema);
