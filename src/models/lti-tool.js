'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');

/**
 * An external LTI 1.3 tool a tenant has registered — a publisher's reader, a
 * proctoring service, an interactive-exercise vendor. Lintel is the PLATFORM;
 * the tool launches FROM us and may call back to read rosters (NRPS) and post
 * grades (AGS).
 *
 * The trust is mutual and key-based: we hold the tool's public JWKS (to verify
 * what it sends us) and our own key pair (to sign launches). As with SSO, the
 * SIGNING KEY is sensitive and held as a REFERENCE, not inline (ADR-017).
 *
 * scopes gate what the tool may do — a tool granted only the AGS lineitem scope
 * cannot read the roster. Least privilege, per tool.
 */
const LtiToolSchema = new Schema(
  {
    name: { type: String, required: true }, // @admin-string — tool name in the admin UI

    // The tool's identity (from its registration).
    clientId: { type: String, required: true },
    issuer: { type: String, required: true },      // the tool's issuer
    deploymentId: { type: String, required: true },

    // Endpoints the tool exposes.
    loginUrl: String,        // the tool's OIDC login initiation
    launchUrl: String,       // where we POST the signed launch
    jwksUrl: String,         // the tool's public keys, to verify its calls
    keySetRef: String,       // reference to OUR signing key for this tool

    /** Advantage service scopes this tool is permitted. */
    scopes: {
      type: [String],
      default: [],
      // e.g. 'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem'
      //      'https://purl.imsglobal.org/spec/lti-ags/scope/score'
      //      'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly'
    },

    enabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

LtiToolSchema.plugin(tenantGuard);
LtiToolSchema.index({ tenantId: 1, clientId: 1, deploymentId: 1 }, { unique: true });

module.exports = mongoose.model('LtiTool', LtiToolSchema);
