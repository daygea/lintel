'use strict';

/**
 * Directory discovery (Oct-2026, P2). browse() searches across name, tagline,
 * city and country and filters by an exact country; directoryCountries() offers
 * the full country facet independent of the current query.
 */

const { Tenant, DirectoryListing } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const directory = require('../../src/services/directory.service');

async function seed(slug, handle, data) {
  const tenant = await Tenant.create({ slug, name: handle, locales: ['en'], status: 'active' });
  await runWithTenant(tenant._id, tenant._id, () =>
    DirectoryListing.create({ handle, displayName: handle, publishedAt: new Date(), ...data }));
}

beforeEach(async () => {
  await seed('t-lagos', 'lagos-tech', {
    displayName: 'Lagos Institute of Technology',
    tagline: { en: 'Engineering and robotics' },
    contact: { city: 'Lagos', country: 'Nigeria' },
  });
  await seed('t-accra', 'accra-biz', {
    displayName: 'Accra Business School',
    tagline: { en: 'Finance and leadership' },
    contact: { city: 'Accra', country: 'Ghana' },
  });
  await seed('t-abuja', 'abuja-med', {
    displayName: 'Abuja College of Health',
    tagline: { en: 'Nursing and public health' },
    contact: { city: 'Abuja', country: 'Nigeria' },
  });
});

it('matches on display name', async () => {
  const rows = await directory.browse({ q: 'accra business' });
  expect(rows.map((r) => r.handle)).toEqual(['accra-biz']);
});

it('matches on tagline', async () => {
  const rows = await directory.browse({ q: 'robotics' });
  expect(rows.map((r) => r.handle)).toEqual(['lagos-tech']);
});

it('matches on city and country', async () => {
  expect((await directory.browse({ q: 'abuja' })).map((r) => r.handle)).toEqual(['abuja-med']);
  const ng = (await directory.browse({ q: 'nigeria' })).map((r) => r.handle).sort();
  expect(ng).toEqual(['abuja-med', 'lagos-tech']);
});

it('filters by an exact country, case-insensitively', async () => {
  const rows = await directory.browse({ country: 'nigeria' });
  expect(rows.map((r) => r.handle).sort()).toEqual(['abuja-med', 'lagos-tech']);
});

it('combines a country filter with a search term', async () => {
  const rows = await directory.browse({ country: 'Nigeria', q: 'health' });
  expect(rows.map((r) => r.handle)).toEqual(['abuja-med']);
});

it('offers every country in the facet, sorted and distinct', async () => {
  expect(await directory.directoryCountries()).toEqual(['Ghana', 'Nigeria']);
});
