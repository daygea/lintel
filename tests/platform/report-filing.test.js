'use strict';

const { Tenant, User } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const platform = require('../../src/services/platform.service');

let tenant, user;

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-report', name: 'Alpha', locales: ['en'], status: 'active' });
  user = await User.create({ email: 'r@x.io', name: 'R', passwordHash: await User.hashPassword('x'.repeat(12)) });
});

it('files a report and it shows up open in the console list', async () => {
  await runWithTenant(tenant._id, user._id, () =>
    platform.fileReport({
      tenantId: tenant._id, subjectType: 'resource', subjectRef: 'Week 3 lesson',
      category: 'illegal_content', detail: 'please review', reportedByUserId: user._id,
    }));

  const open = await platform.listReports('open');
  const mine = open.find((r) => String(r.tenantId) === String(tenant._id));
  expect(mine).toBeTruthy();
  expect(mine.category).toBe('illegal_content');
  expect(mine.status).toBe('open');
});
