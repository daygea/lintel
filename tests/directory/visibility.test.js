'use strict';

/**
 * The public directory shows only operational institutions. A suspended, closed,
 * or deleted institution must not appear in browse() or resolve in publicView(),
 * even though its listing is still marked published.
 */

const { Tenant, DirectoryListing } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const dir = require('../../src/services/directory.service');

async function institution(slug, status) {
  const t = await Tenant.create({ slug, name: slug.toUpperCase(), locales: ['en'], status, plan: 'institute' });
  await runWithTenant(t._id, t._id, () =>
    DirectoryListing.create({ handle: slug, displayName: `${slug} Institute`, publishedAt: new Date() })
  );
  return t;
}

beforeEach(async () => {
  await institution('active-inst', 'active');
  await institution('trial-inst', 'trial');
  await institution('susp-inst', 'suspended');
  await institution('closed-inst', 'closed');
  await institution('del-inst', 'deleted');
});

it('browse lists only operational institutions', async () => {
  const handles = (await dir.browse()).map((r) => r.handle);
  expect(handles).toEqual(expect.arrayContaining(['active-inst', 'trial-inst']));
  expect(handles).not.toContain('susp-inst');
  expect(handles).not.toContain('closed-inst');
  expect(handles).not.toContain('del-inst');
});

it('publicView returns null for a suspended, closed, or deleted institution', async () => {
  expect(await dir.publicView('active-inst')).not.toBeNull();
  expect(await dir.publicView('susp-inst')).toBeNull();
  expect(await dir.publicView('closed-inst')).toBeNull();
  expect(await dir.publicView('del-inst')).toBeNull();
});
