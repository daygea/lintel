'use strict';

/**
 * The credentials page (`/credentials`) calls credential.service.listAll(). That
 * function existed but wasn't exported, so the page 500'd. Guard both: it's
 * exported, and it returns issued credentials.
 */

const { Tenant, User } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const cred = require('../../src/services/credential.service');

let tenant, user;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-cred', name: 'Alpha', locales: ['en'], status: 'active' });
  user = await User.create({ email: 'c@x.io', name: 'C', passwordHash: await User.hashPassword('x'.repeat(12)) });
});

it('exports listAll', () => {
  expect(typeof cred.listAll).toBe('function');
});

it('listAll returns issued credentials', async () => {
  const tpl = await as(() => cred.createTemplate({ slug: 'dip', title: { en: 'Diploma' } }));
  await as(() => cred.issue({ templateId: tpl._id, userId: user._id }));
  const all = await as(() => cred.listAll());
  expect(all.length).toBe(1);
  expect(String(all[0].userId)).toBe(String(user._id));
});
