'use strict';

const enforceActive = require('../../src/middleware/enforce-active');

function run({ status, roles = [], path = '/' }) {
  const req = { tenant: status ? { status } : null, membership: roles.length ? { roles } : null, path };
  let nexted = false, redirected = null, rendered = null, code = 200;
  const res = {
    status(c) { code = c; return this; },
    redirect(u) { redirected = u; },
    render(v) { rendered = v; },
  };
  enforceActive(req, res, () => { nexted = true; });
  return { nexted, redirected, rendered, code };
}

it('passes active tenants straight through', () => {
  expect(run({ status: 'active', path: '/' }).nexted).toBe(true);
});

it('passes trial tenants through', () => {
  expect(run({ status: 'trial', path: '/courses' }).nexted).toBe(true);
});

it('redirects a suspended tenant owner to billing', () => {
  const r = run({ status: 'suspended', roles: ['owner'], path: '/courses' });
  expect(r.redirected).toBe('/settings/billing');
  expect(r.nexted).toBe(false);
});

it('shows a suspended notice to a suspended tenant learner', () => {
  const r = run({ status: 'suspended', roles: ['learner'], path: '/app/' });
  expect(r.code).toBe(403);
  expect(r.rendered).toBe('errors/suspended');
});

it('lets a suspended tenant reach billing and the webhook', () => {
  expect(run({ status: 'suspended', roles: ['learner'], path: '/settings/billing' }).nexted).toBe(true);
  expect(run({ status: 'suspended', roles: [], path: '/api/v1/webhooks/paystack' }).nexted).toBe(true);
});
