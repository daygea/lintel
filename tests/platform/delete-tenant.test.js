'use strict';

/**
 * Deleting an institution soft-deletes it: hidden from the console list (as are
 * closed ones) and restorable. Restore brings it back as suspended.
 */

const mongoose = require('mongoose');
const { Tenant } = require('../../src/models');
const platform = require('../../src/services/platform.service');

const actor = new mongoose.Types.ObjectId();
const ids = (list) => list.map((t) => String(t._id));

it('delete hides from the list (with closed); archived view shows it; restore returns it as suspended', async () => {
  const live = await Tenant.create({ slug: 'live', name: 'Live', locales: ['en'], status: 'active', plan: 'institute' });
  const closed = await Tenant.create({ slug: 'closed', name: 'Closed', locales: ['en'], status: 'closed', plan: 'trial' });
  const junk = await Tenant.create({ slug: 'junk', name: 'Junk', locales: ['en'], status: 'trial', plan: 'trial' });

  await platform.deleteTenant(junk._id, 'test account', actor);
  const fresh = await Tenant.findById(junk._id);
  expect(fresh.status).toBe('deleted');
  expect(fresh.deletedAt).toBeInstanceOf(Date);

  const list = ids(await platform.listTenants());
  expect(list).toContain(String(live._id));
  expect(list).not.toContain(String(junk._id));
  expect(list).not.toContain(String(closed._id)); // closed is archived too

  const all = ids(await platform.listTenants({ includeArchived: true }));
  expect(all).toEqual(expect.arrayContaining([String(live._id), String(closed._id), String(junk._id)]));

  await platform.restoreTenant(junk._id, actor);
  const restored = await Tenant.findById(junk._id);
  expect(restored.status).toBe('suspended');
  expect(restored.deletedAt == null).toBe(true);
});

it('rejects a double delete and restoring a non-deleted institution', async () => {
  const t = await Tenant.create({ slug: 'xco', name: 'X', locales: ['en'], status: 'active', plan: 'trial' });
  await expect(platform.restoreTenant(t._id, actor)).rejects.toThrow(/deleted/i);
  await platform.deleteTenant(t._id, '', actor);
  await expect(platform.deleteTenant(t._id, '', actor)).rejects.toThrow(/already deleted/i);
});
