'use strict';

const { requireFeature } = require('../../src/middleware/require-feature');

function run(hasFeatureReturn, { api = false } = {}) {
  const req = {
    path: api ? '/api/v1/invoices' : '/fees',
    tenant: { plan: 'trial', hasFeature: () => hasFeatureReturn },
    get: () => (api ? 'application/json' : 'text/html'),
  };
  let status = 200, jsonBody = null, rendered = null, nexted = false;
  const res = {
    status(c) { status = c; return this; },
    json(b) { jsonBody = b; return this; },
    render(v, d) { rendered = { v, d }; return this; },
  };
  requireFeature('commerce')(req, res, () => { nexted = true; });
  return { status, jsonBody, rendered, nexted };
}

it('calls next when the plan grants the feature', () => {
  const r = run(true);
  expect(r.nexted).toBe(true);
  expect(r.status).toBe(200);
});

it('renders the feature-locked page for a web request without the feature', () => {
  const r = run(false);
  expect(r.nexted).toBe(false);
  expect(r.status).toBe(403);
  expect(r.rendered.v).toBe('errors/feature-locked');
});

it('returns a 403 JSON for an API request without the feature', () => {
  const r = run(false, { api: true });
  expect(r.nexted).toBe(false);
  expect(r.status).toBe(403);
  expect(r.jsonBody.error).toBe('feature_not_in_plan');
});
