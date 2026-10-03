'use strict';

/**
 * Locale-map save round-trips (Oct-2026 audit). These fields are Mongoose Maps;
 * the bug was that edit paths wrote them through a query-update (silent drop) and
 * one view read them with bracket access (blank on reload). Each test edits an
 * EXISTING record and asserts the new value reads back.
 */

const mongoose = require('mongoose');
const { Tenant, Course } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const { pick } = require('../../src/plugins/locale-map');
const eligibility = require('../../src/services/eligibility.service');
const gradebook = require('../../src/services/gradebook.service');
const curriculum = require('../../src/services/curriculum.service');
const directory = require('../../src/services/directory.service');

let tenant;
const as = (fn) => runWithTenant(tenant._id, null, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'inst', name: 'Inst', locales: ['en'] });
});

it('editing an eligibility policy persists the new denial message', async () => {
  await as(() => eligibility.upsertPolicy({ slug: 'p', label: { en: 'P' }, denialMessage: { en: 'first' } }));
  const edited = await as(() => eligibility.upsertPolicy({ slug: 'p', label: { en: 'P' }, denialMessage: { en: 'second' } }));
  expect(pick(edited.denialMessage, 'en')).toBe('second');
  const reloaded = await as(() => eligibility.getPolicy(edited._id));
  expect(pick(reloaded.denialMessage, 'en')).toBe('second');
});

it('editing a grade scheme persists the new label', async () => {
  await as(() => gradebook.upsertScheme({ slug: 's', label: { en: 'First' } }));
  const edited = await as(() => gradebook.upsertScheme({ slug: 's', label: { en: 'Second' } }));
  expect(pick(edited.label, 'en')).toBe('Second');
});

it('updating a course persists a new title (locale map) and a scalar', async () => {
  const course = await as(() => Course.create({ code: 'C1', title: { en: 'Old' } }));
  await as(() => curriculum.updateCourse(course._id, { title: { en: 'New' }, visibility: 'catalog' }));
  const reloaded = await as(() => Course.findById(course._id).exec());
  expect(pick(reloaded.title, 'en')).toBe('New');
  expect(reloaded.visibility).toBe('catalog');
});

it('editing a directory listing persists tagline and about', async () => {
  await as(() => directory.upsertListing({ handle: 'inst', displayName: 'Inst', tagline: { en: 'one' }, about: { en: 'desc one' } }));
  await as(() => directory.upsertListing({ handle: 'inst', displayName: 'Inst', tagline: { en: 'two' }, about: { en: 'desc two' } }));
  const listing = await as(() => directory.getOwnListing());
  expect(pick(listing.tagline, 'en')).toBe('two');
  expect(pick(listing.about, 'en')).toBe('desc two');
});
