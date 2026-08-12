'use strict';

/**
 * Regression: a single malformed invoice (missing amountPaid, or a paid amount in
 * a different currency than due) must not 500 the learner's fees page. myInvoices
 * coerces each row to safe, same-currency money. Malformed docs are inserted via
 * the raw collection because schema validation would otherwise reject them.
 */

const mongoose = require('mongoose');
const { Tenant, User, Invoice } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const commerce = require('../../src/services/commerce');

let tenant, user;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);

async function rawInvoice(extra) {
  await Invoice.collection.insertOne({
    tenantId: tenant._id,
    userId: user._id,
    enrollmentId: new mongoose.Types.ObjectId(),
    state: 'unpaid',
    createdAt: new Date(),
    ...extra,
  });
}

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'bad-inv', name: 'B', locales: ['en'], status: 'active', plan: 'institute' });
  user = await User.create({ email: 'l@x.io', name: 'L', passwordHash: await User.hashPassword('x'.repeat(12)) });
});

it('survives an invoice with a missing amountPaid', async () => {
  await rawInvoice({ amountDue: { amount: 100000, currency: 'NGN' } }); // no amountPaid
  const rows = await as(() => commerce.myInvoices(user._id));
  expect(rows).toHaveLength(1);
  expect(rows[0].amountPaid).toEqual({ amount: 0, currency: 'NGN' });
  expect(rows[0].outstanding).toEqual({ amount: 100000, currency: 'NGN' });
});

it('survives an amountPaid in a different currency than due', async () => {
  await rawInvoice({ amountDue: { amount: 100000, currency: 'NGN' }, amountPaid: { amount: 5000, currency: 'USD' } });
  const rows = await as(() => commerce.myInvoices(user._id));
  expect(rows).toHaveLength(1);
  // the mismatched paid amount is ignored rather than crashing the page
  expect(rows[0].outstanding).toEqual({ amount: 100000, currency: 'NGN' });
});
