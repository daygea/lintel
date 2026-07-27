'use strict';

const { SamlAdapter } = require('./saml');
const { OidcAdapter } = require('./oidc');

const ADAPTERS = { saml: new SamlAdapter(), oidc: new OidcAdapter() };

const adapterFor = (protocol) => {
  const a = ADAPTERS[protocol];
  if (!a) throw new Error(`No SSO adapter for protocol: ${protocol}`);
  return a;
};

module.exports = { adapterFor, ADAPTERS };
