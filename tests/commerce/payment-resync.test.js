'use strict';

/**
 * Payment correctness (Oct-2026 audit). Two properties:
 *  1. A currency-mismatched payment is rejected BEFORE any Payment row exists.
 *  2. A replayed webhook re-syncs the invoice even if the first delivery crashed
 *     after writing the Payment row but before updating the invoice (self-heal).
 */

const mongoose = require('mongoose');
const { Tenant, User, Enrollment, Invoice, Payment } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const commerce = require('../../src/services/commerce');
const { ValidationError } = require('../../src/lib/errors');

const oid = () => new mongoose.Types.ObjectId();
let tenant, learner;
const as = (fn) => runWithTenant(tenant._id, learner._id, fn);

async function freshInvoice() {
  return as(() =>
    Invoice.create({
      enrollmentId: oid(), userId: learner._id,
      amountDue: { amount: 500000, currency: 'NGN' }, amountPaid: { amount: 0, currency: 'NGN' }, state: 'unpaid',
    })
  );
}

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'inst', name: 'Inst', locales: ['en'] });
  learner = await User.create({ email: 'l@x.io', name: 'L', passwordHash: await User.hashPassword('x'.repeat(12)) });
});

it('rejects a currency mismatch before creating a Payment row', async () => {
  const inv = await freshInvoice();
  await expect(
    as(() => commerce.recordPayment({ invoiceId: inv._id, amount: { amount: 500000, currency: 'USD' }, method: 'paystack', providerRef: 'r1' }))
  ).rejects.toBeInstanceOf(ValidationError);
  const count = await as(() => Payment.countDocuments({ invoiceId: inv._id }).exec());
  expect(count).toBe(0); // nothing written — no stuck row
});

it('re-syncs the invoice on a replay after a half-applied first delivery', async () => {
  const inv = await freshInvoice();
  // Simulate: first webhook created the Payment row, then crashed before syncing.
  await as(() => Payment.create({
    invoiceId: inv._id, userId: learner._id,
    amount: { amount: 500000, currency: 'NGN' }, method: 'paystack', provider: 'paystack', providerRef: 'r2',
  }));
  let reloaded = await as(() => Invoice.findById(inv._id).exec());
  expect(reloaded.state).toBe('unpaid'); // still stuck at this point

  // The retry (same providerRef) must converge instead of short-circuiting.
  const res = await as(() => commerce.recordPayment({ invoiceId: inv._id, amount: { amount: 500000, currency: 'NGN' }, method: 'paystack', providerRef: 'r2' }));
  expect(res.replay).toBe(true);
  reloaded = await as(() => Invoice.findById(inv._id).exec());
  expect(reloaded.state).toBe('full');
  expect(reloaded.amountPaid.amount).toBe(500000);
  // and exactly one payment — the replay did not double-count
  expect(await as(() => Payment.countDocuments({ invoiceId: inv._id }).exec())).toBe(1);
});
