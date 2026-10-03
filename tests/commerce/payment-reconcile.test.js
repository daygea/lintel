'use strict';

/**
 * Verify-on-return and the reconcile sweep (Oct-2026 audit, #2/#3/#5). The webhook is
 * the primary confirmation; these are the backstops when it is slow or lost. Both go
 * through the same idempotent recordPayment, so they can never double-count.
 */

const mongoose = require('mongoose');
const { Tenant, User, Invoice, Payment, AuditLog } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const commerce = require('../../src/services/commerce');

let tenant, user;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);
const NGN = (n) => ({ amount: n, currency: 'NGN' });

async function invoiceWithPendingRef({ minutesAgo = 0, paid = 0, state = 'unpaid' } = {}) {
  return as(async () => {
    const inv = await Invoice.create({
      enrollmentId: new mongoose.Types.ObjectId(),
      userId: user._id,
      amountDue: NGN(100000),
      amountPaid: NGN(paid),
      state,
    });
    const ref = `${tenant._id}_${inv._id}_abc123`;
    await Invoice.updateOne(
      { _id: inv._id },
      { pendingReference: ref, pendingReferenceAt: new Date(Date.now() - minutesAgo * 60000) }
    ).exec();
    return { inv, ref };
  });
}

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-recon', name: 'R', locales: ['en'], status: 'active', plan: 'institute' });
  user = await User.create({ email: 'l@x.io', name: 'L', passwordHash: await User.hashPassword('x'.repeat(12)) });
});
afterEach(() => vi.restoreAllMocks());

describe('confirmByReference (verify-on-return)', () => {
  it('records a verified payment and opens the invoice, once (idempotent)', async () => {
    const { inv, ref } = await invoiceWithPendingRef();
    const spy = vi.spyOn(commerce.PROVIDERS.paystack, 'verify')
      .mockResolvedValue({ paid: true, amount: NGN(100000), providerRef: 'pref-1' });

    const r1 = await as(() => commerce.confirmByReference(ref, { requireOwnerId: user._id }));
    expect(r1.paid).toBe(true);
    expect(r1.invoice.state).toBe('full');

    // A second return (or return + webhook) must not double-count.
    const r2 = await as(() => commerce.confirmByReference(ref, { requireOwnerId: user._id }));
    expect(r2.paid).toBe(true);
    const rows = await as(() => Payment.find({ invoiceId: inv._id }).exec());
    expect(rows.length).toBe(1);
    expect(spy).toHaveBeenCalled();
  });

  it('clears the pending reference once recorded', async () => {
    const { inv, ref } = await invoiceWithPendingRef();
    vi.spyOn(commerce.PROVIDERS.paystack, 'verify')
      .mockResolvedValue({ paid: true, amount: NGN(100000), providerRef: 'pref-2' });
    await as(() => commerce.confirmByReference(ref));
    const fresh = await as(() => Invoice.findById(inv._id).exec());
    expect(fresh.pendingReference == null).toBe(true);
  });

  it('does not record when the provider says the charge did not succeed', async () => {
    const { inv, ref } = await invoiceWithPendingRef();
    vi.spyOn(commerce.PROVIDERS.paystack, 'verify').mockResolvedValue({ paid: false });
    const r = await as(() => commerce.confirmByReference(ref, { requireOwnerId: user._id }));
    expect(r.paid).toBe(false);
    const rows = await as(() => Payment.find({ invoiceId: inv._id }).exec());
    expect(rows.length).toBe(0);
  });

  it('ignores a reference that is not the returning user’s invoice', async () => {
    const { ref } = await invoiceWithPendingRef();
    const spy = vi.spyOn(commerce.PROVIDERS.paystack, 'verify').mockResolvedValue({ paid: true, amount: NGN(100000), providerRef: 'x' });
    const stranger = new mongoose.Types.ObjectId();
    const r = await as(() => commerce.confirmByReference(ref, { requireOwnerId: stranger }));
    expect(r.paid).toBe(false);
    expect(r.ignored).toBe('not_owner');
    expect(spy).not.toHaveBeenCalled(); // bailed before hitting the provider
  });

  it('ignores a reference belonging to another tenant', async () => {
    const otherRef = `${new mongoose.Types.ObjectId()}_${new mongoose.Types.ObjectId()}_z`;
    const r = await as(() => commerce.confirmByReference(otherRef));
    expect(r.paid).toBe(false);
    expect(r.ignored).toBe('foreign_tenant');
  });
});

describe('reconcilePendingPayments (sweep)', () => {
  it('recovers a stale pending reference that has actually paid', async () => {
    const { inv } = await invoiceWithPendingRef({ minutesAgo: 20 });
    vi.spyOn(commerce.PROVIDERS.paystack, 'verify')
      .mockResolvedValue({ paid: true, amount: NGN(100000), providerRef: 'pref-sweep' });

    const result = await as(() => commerce.reconcilePendingPayments({ olderThanMinutes: 10 }));
    expect(result.recovered).toBe(1);
    const fresh = await as(() => Invoice.findById(inv._id).exec());
    expect(fresh.state).toBe('full');
  });

  it('leaves a reference inside the grace window alone', async () => {
    await invoiceWithPendingRef({ minutesAgo: 2 });
    const spy = vi.spyOn(commerce.PROVIDERS.paystack, 'verify').mockResolvedValue({ paid: true, amount: NGN(100000), providerRef: 'nope' });
    const result = await as(() => commerce.reconcilePendingPayments({ olderThanMinutes: 10 }));
    expect(result.checked).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('amount-mismatch flag (#5)', () => {
  it('audits an online underpayment as a mismatch', async () => {
    const { inv } = await invoiceWithPendingRef();
    await as(() => commerce.recordPayment({
      invoiceId: inv._id, amount: NGN(60000), method: 'paystack', provider: 'paystack', providerRef: 'pref-partial',
    }));
    const log = await as(() => AuditLog.findOne({ action: 'payment.recorded', subjectId: { $exists: true } }).sort({ _id: -1 }).exec());
    expect(log.meta.mismatch).toBe(true);
    expect(log.meta.expected).toBe(100000);
    expect(log.meta.amount).toBe(60000);
  });
});
