'use strict';

/**
 * Institution payouts (Oct-2026): an institution supplies its bank details, we
 * resolve the account and create a Paystack subaccount automatically, and every
 * learner payment then splits at checkout with no raw subaccount code touched by
 * hand. These run unconfigured (no PAYSTACK_SECRET_KEY), so the provider's dev
 * stubs stand in for the live API.
 */

const { Tenant, User, Invoice } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const commerce = require('../../src/services/commerce');
const { PaystackProvider } = require('../../src/services/commerce/providers/paystack');

let tenant, user;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);
const NGN = (n) => ({ amount: n, currency: 'NGN' });

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-payout', name: 'Oyo Institute', locales: ['en'], status: 'active', plan: 'institute' });
  user = await User.create({ email: 'admin@x.io', name: 'Admin', passwordHash: await User.hashPassword('x'.repeat(12)) });
});

describe('provider helpers (dev stubs)', () => {
  const p = new PaystackProvider();
  it('lists banks', async () => {
    const banks = await p.listBanks();
    expect(Array.isArray(banks)).toBe(true);
    expect(banks.length).toBeGreaterThan(0);
    expect(banks[0]).toHaveProperty('code');
    expect(banks[0]).toHaveProperty('name');
  });
  it('resolves a 10-digit account and rejects a bad one', async () => {
    const r = await p.resolveAccount({ accountNumber: '0123456789', bankCode: '058' });
    expect(r.accountName).toBeTruthy();
    await expect(p.resolveAccount({ accountNumber: '12', bankCode: '058' })).rejects.toThrow();
  });
  it('mints a subaccount code on create and keeps it on update', async () => {
    const created = await p.upsertSubaccount({ businessName: 'X', bankCode: '058', accountNumber: '0123456789' });
    expect(created.subaccountCode).toMatch(/^ACCT_/);
    const updated = await p.upsertSubaccount({ code: created.subaccountCode, businessName: 'X', bankCode: '058', accountNumber: '0123456789' });
    expect(updated.subaccountCode).toBe(created.subaccountCode);
  });
});

describe('savePayoutAccount', () => {
  it('resolves, creates a subaccount, and persists the bank details', async () => {
    const res = await as(() => commerce.savePayoutAccount({
      bankCode: '058', bankName: 'Guaranty Trust Bank (GTBank)', accountNumber: '0123456789',
    }));
    expect(res.subaccountCode).toMatch(/^ACCT_/);
    expect(res.last4).toBe('6789');

    const fresh = await Tenant.findById(tenant._id).exec();
    expect(fresh.paystackSubaccount).toBe(res.subaccountCode);
    expect(fresh.payout.bankName).toBe('Guaranty Trust Bank (GTBank)');
    expect(fresh.payout.accountNumber).toBe('0123456789');
    expect(fresh.payout.accountName).toBeTruthy();
  });

  it('rejects an account number that is not 10 digits', async () => {
    await expect(as(() => commerce.savePayoutAccount({ bankCode: '058', bankName: 'GTB', accountNumber: '123' })))
      .rejects.toThrow(/10-digit/);
  });

  it('requires a bank', async () => {
    await expect(as(() => commerce.savePayoutAccount({ bankCode: '', bankName: '', accountNumber: '0123456789' })))
      .rejects.toThrow(/bank/i);
  });
});

describe('automatic split after a payout account is set', () => {
  it('beginPayment routes the learner payment to the subaccount with a plan-based charge', async () => {
    await as(() => commerce.savePayoutAccount({ bankCode: '058', bankName: 'GTB', accountNumber: '0123456789' }));

    // Spy on the provider so we can see exactly what checkout was told to do.
    const spy = vi.spyOn(commerce.PROVIDERS.paystack, 'initialize')
      .mockResolvedValue({ authorizationUrl: 'https://pay.test/x', reference: 'r' });

    const invoice = await as(() => Invoice.create({
      enrollmentId: new (require('mongoose').Types.ObjectId)(),
      userId: user._id, amountDue: NGN(100000), amountPaid: NGN(0), state: 'unpaid',
    }));
    await as(() => commerce.beginPayment({ invoiceId: invoice._id }));

    const arg = spy.mock.calls[0][0];
    const fresh = await Tenant.findById(tenant._id).exec();
    expect(arg.subaccount).toBe(fresh.paystackSubaccount);        // split enabled
    expect(arg.transactionCharge).toBe(Math.round(100000 * 200 / 10000)); // 2% institute plan
    spy.mockRestore();
  });

  it('clearPayoutAccount turns the split off again', async () => {
    await as(() => commerce.savePayoutAccount({ bankCode: '058', bankName: 'GTB', accountNumber: '0123456789' }));
    await as(() => commerce.clearPayoutAccount());
    const fresh = await Tenant.findById(tenant._id).exec();
    expect(fresh.paystackSubaccount == null || fresh.paystackSubaccount === '').toBe(true);
    expect(fresh.payout == null || fresh.payout.accountNumber == null).toBe(true);
  });
});
