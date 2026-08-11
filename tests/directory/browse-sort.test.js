'use strict';

/**
 * The public directory lists institutions most-recently-published first.
 */

const { Tenant, DirectoryListing } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const directory = require('../../src/services/directory.service');

async function seedListing(slug, handle, publishedAt) {
  const tenant = await Tenant.create({ slug, name: handle, locales: ['en'], status: 'active' });
  await runWithTenant(tenant._id, tenant._id, () =>
    DirectoryListing.create({ handle, displayName: handle, publishedAt }));
}

it('lists published institutions newest first', async () => {
  await seedListing('t-old', 'old', new Date('2026-01-01'));
  await seedListing('t-new', 'new', new Date('2026-06-01'));
  await seedListing('t-mid', 'mid', new Date('2026-03-01'));

  const rows = await directory.browse();
  expect(rows.map((r) => r.handle)).toEqual(['new', 'mid', 'old']);
});
