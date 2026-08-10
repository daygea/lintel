'use strict';

/**
 * Directory listing save. tagline/about are Mongoose Map fields; the update path
 * (a listing already exists) previously used updateOne, which didn't cast a plain
 * object into a Map — so edits to tagline/about were silently dropped. They must
 * round-trip on both create and update.
 */

const { Tenant, DirectoryListing } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const directory = require('../../src/services/directory.service');

let tenant;
const as = (fn) => runWithTenant(tenant._id, tenant._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-dir', name: 'Alpha', locales: ['en', 'yo'], status: 'active' });
});

it('persists tagline/about when creating the listing', async () => {
  await as(() => directory.upsertListing({
    handle: 'alpha', displayName: 'Alpha', tagline: { en: 'Learn well' }, about: { en: 'About Alpha' },
  }));
  const l = await as(() => directory.getOwnListing());
  expect(l.tagline.get('en')).toBe('Learn well');
  expect(l.about.get('en')).toBe('About Alpha');
});

it('persists tagline/about when UPDATING an existing listing (the bug)', async () => {
  await as(() => directory.upsertListing({ handle: 'alpha', displayName: 'Alpha', tagline: { en: 'v1' }, about: { en: 'old' } }));
  await as(() => directory.upsertListing({
    handle: 'alpha', displayName: 'Alpha',
    tagline: { en: 'v2', yo: 'Kọ́' }, about: { en: 'new about' },
  }));
  const l = await as(() => directory.getOwnListing());
  expect(l.tagline.get('en')).toBe('v2');
  expect(l.tagline.get('yo')).toBe('Kọ́');
  expect(l.about.get('en')).toBe('new about');
});
