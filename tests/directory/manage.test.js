'use strict';

/**
 * Directory self-management (the fix for an empty public directory): an
 * institution edits and publishes its OWN listing, and publication is an act
 * that makes it appear in browse() — and unpublishing removes it.
 */

const { Tenant, DirectoryListing } = require('../../src/models');
const directory = require('../../src/services/directory.service');
const { runWithTenant, runAsPlatform } = require('../../src/lib/context');

describe('an institution manages its own listing', () => {
  let tenant;
  beforeEach(async () => {
    tenant = await Tenant.create({ slug: 'oiss', name: 'OISS', locales: ['en'], status: 'active' });
  });

  it('is invisible in browse until published, then visible, then hidden again', async () => {
    await runWithTenant(tenant._id, null, () =>
      directory.upsertListing({ handle: 'oiss', displayName: 'Obatala Institute' }));

    // not published -> not in browse
    let results = await runAsPlatform('t', () => directory.browse());
    expect(results.find((l) => l.handle === 'oiss')).toBeUndefined();

    // publish -> appears
    await runWithTenant(tenant._id, null, () => directory.publish());
    results = await runAsPlatform('t', () => directory.browse());
    expect(results.find((l) => l.handle === 'oiss')).toBeTruthy();

    // unpublish -> gone
    await runWithTenant(tenant._id, null, () => directory.unpublish());
    results = await runAsPlatform('t', () => directory.browse());
    expect(results.find((l) => l.handle === 'oiss')).toBeUndefined();
  });

  it('publicView returns null for an unpublished listing (fail closed)', async () => {
    await runWithTenant(tenant._id, null, () =>
      directory.upsertListing({ handle: 'oiss', displayName: 'Obatala Institute' }));
    const view = await runAsPlatform('t', () => directory.publicView('oiss'));
    expect(view).toBeNull();
  });
});
