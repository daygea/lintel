'use strict';

/**
 * A refund is an append-only negative payment: it reduces what's paid, re-derives
 * the invoice state, records a 'refund' Payment, and can't exceed the net paid.
 */

const mongoose = require('mongoose');
const { Tenant, User, Invoice, Payment } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const commerce = require('../../src/services/commerce');

let tenant, user;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);
const NGN = (n) => ({ amount: n, currency: 'NGN' });

async function paidInvoice() {
  return as(async () => {
    const inv = await Invoice.create({
      enrollmentId: new mongoose.Types.ObjectId(),
      userId: user._id,
      amountDue: NGN(100000),
      amountPaid: NGN(100000),
      state: 'full',
    });
    return inv;
  });
}

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-refund', name: 'R', locales: ['en'], status: 'active', plan: 'institute' });
  user = await User.create({ email: 'l@x.io', name: 'L', passwordHash: await User.hashPassword('x'.repeat(12)) });
});

it('records a partial refund and re-derives state to part', async () => {
  const inv = await paidInvoice();
  await as(() => commerce.refund({ invoiceId: inv._id, amount: NGN(40000), reason: 'overpaid' }));

  const fresh = await as(() => Invoice.findById(inv._id).exec());
  expect(fresh.amountPaid.amount).toBe(60000);
  expect(fresh.state).toBe('part');

  const refunds = await as(() => Payment.find({ invoiceId: inv._id, method: 'refund' }).exec());
  expect(refunds).toHaveLength(1);
  expect(refunds[0].amount.amount).toBe(-40000); // append-only negative entry
});

it('refunds the full amount back to unpaid', async () => {
  const inv = await paidInvoice();
  await as(() => commerce.refund({ invoiceId: inv._id, amount: NGN(100000), reason: 'cancelled' }));
  const fresh = await as(() => Invoice.findById(inv._id).exec());
  expect(fresh.amountPaid.amount).toBe(0);
  expect(fresh.state).toBe('unpaid');
});

it('refuses to refund more than has been paid', async () => {
  const inv = await paidInvoice();
  await expect(as(() => commerce.refund({ invoiceId: inv._id, amount: NGN(150000), reason: 'x' }))).rejects.toThrow(/more than/i);
});
