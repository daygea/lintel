'use strict';

/**
 * Institution payouts (Oct-2026): an institution supplies its bank details, we
 * resolve the account and create a Paystack subaccount automatically, and every
 * learner payment then splits at checkout with no raw subaccount code touched by
 * hand.
 *
 * These tests are deterministic whether or not PAYSTACK_SECRET_KEY is set in the
 * environment: the provider-helper block forces the provider into its unconfigured
 * (dev-stub) mode by clearing the secret on the instance, and the service block
 * stubs the provider's network methods outright. Neither ever calls the live API.
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
afterEach(() => vi.restoreAllMocks());

describe('provider helpers (dev stubs)', () => {
  // Force unconfigured mode on the instance so the dev stubs run regardless of
  // whether a real PAYSTACK_SECRET_KEY is present in this environment.
  const devProvider = () => {
    const p = new PaystackProvider();
    p.secret = undefined;
    p._banks = undefined;
    return p;
  };

  it('lists banks', async () => {
    const banks = await devProvider().listBanks();
    expect(Array.isArray(banks)).toBe(true);
    expect(banks.length).toBeGreaterThan(0);
    expect(banks[0]).toHaveProperty('code');
    expect(banks[0]).toHaveProperty('name');
  });
  it('resolves a 10-digit account and rejects a bad one', async () => {
    const p = devProvider();
    const r = await p.resolveAccount({ accountNumber: '0123456789', bankCode: '058' });
    expect(r.accountName).toBeTruthy();
    await expect(p.resolveAccount({ accountNumber: '12', bankCode: '058' })).rejects.toThrow();
  });
  it('mints a subaccount code on create and keeps it on update', async () => {
    const p = devProvider();
    const created = await p.upsertSubaccount({ businessName: 'X', bankCode: '058', accountNumber: '0123456789' });
    expect(created.subaccountCode).toMatch(/^ACCT_/);
    const updated = await p.upsertSubaccount({ code: created.subaccountCode, businessName: 'X', bankCode: '058', accountNumber: '0123456789' });
    expect(updated.subaccountCode).toBe(created.subaccountCode);
  });
});

describe('savePayoutAccount', () => {
  // Stub the provider's network calls so the service logic is tested in isolation,
  // with no dependence on a live key or the dev-stub branch.
  const stubProvider = () => {
    vi.spyOn(commerce.PROVIDERS.paystack, 'resolveAccount').mockResolvedValue({ accountName: 'OYO INSTITUTE LTD' });
    vi.spyOn(commerce.PROVIDERS.paystack, 'upsertSubaccount').mockResolvedValue({ subaccountCode: 'ACCT_testcode' });
  };

  it('resolves, creates a subaccount, and persists the bank details', async () => {
    stubProvider();
    const res = await as(() => commerce.savePayoutAccount({
      bankCode: '058', bankName: 'Guaranty Trust Bank (GTBank)', accountNumber: '0123456789',
    }));
    expect(res.subaccountCode).toBe('ACCT_testcode');
    expect(res.last4).toBe('6789');

    const fresh = await Tenant.findById(tenant._id).exec();
    expect(fresh.paystackSubaccount).toBe('ACCT_testcode');
    expect(fresh.payout.bankName).toBe('Guaranty Trust Bank (GTBank)');
    expect(fresh.payout.accountNumber).toBe('0123456789');
    expect(fresh.payout.accountName).toBe('OYO INSTITUTE LTD');
  });

  it('passes the existing subaccount code so a re-save updates in place', async () => {
    stubProvider();
    await Tenant.updateOne({ _id: tenant._id }, { paystackSubaccount: 'ACCT_existing' }).exec();
    await as(() => commerce.savePayoutAccount({ bankCode: '058', bankName: 'GTB', accountNumber: '0123456789' }));
    expect(commerce.PROVIDERS.paystack.upsertSubaccount).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ACCT_existing', bankCode: '058', accountNumber: '0123456789' })
    );
  });

  it('rejects an account number that is not 10 digits (before hitting the provider)', async () => {
    const spy = vi.spyOn(commerce.PROVIDERS.paystack, 'resolveAccount');
    await expect(as(() => commerce.savePayoutAccount({ bankCode: '058', bankName: 'GTB', accountNumber: '123' })))
      .rejects.toThrow(/10-digit/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('requires a bank', async () => {
    await expect(as(() => commerce.savePayoutAccount({ bankCode: '', bankName: '', accountNumber: '0123456789' })))
      .rejects.toThrow(/bank/i);
  });
});

describe('automatic split after a payout account is set', () => {
  it('beginPayment routes the learner payment to the subaccount with a plan-based charge', async () => {
    vi.spyOn(commerce.PROVIDERS.paystack, 'resolveAccount').mockResolvedValue({ accountName: 'OYO INSTITUTE LTD' });
    vi.spyOn(commerce.PROVIDERS.paystack, 'upsertSubaccount').mockResolvedValue({ subaccountCode: 'ACCT_split' });
    await as(() => commerce.savePayoutAccount({ bankCode: '058', bankName: 'GTB', accountNumber: '0123456789' }));

    const init = vi.spyOn(commerce.PROVIDERS.paystack, 'initialize')
      .mockResolvedValue({ authorizationUrl: 'https://pay.test/x', reference: 'r' });

    const invoice = await as(() => Invoice.create({
      enrollmentId: new (require('mongoose').Types.ObjectId)(),
      userId: user._id, amountDue: NGN(100000), amountPaid: NGN(0), state: 'unpaid',
    }));
    await as(() => commerce.beginPayment({ invoiceId: invoice._id }));

    const arg = init.mock.calls[0][0];
    expect(arg.subaccount).toBe('ACCT_split');                      // split enabled
    expect(arg.transactionCharge).toBe(Math.round(100000 * 200 / 10000)); // 2% institute plan
  });

  it('clearPayoutAccount turns the split off again', async () => {
    vi.spyOn(commerce.PROVIDERS.paystack, 'resolveAccount').mockResolvedValue({ accountName: 'OYO INSTITUTE LTD' });
    vi.spyOn(commerce.PROVIDERS.paystack, 'upsertSubaccount').mockResolvedValue({ subaccountCode: 'ACCT_split' });
    await as(() => commerce.savePayoutAccount({ bankCode: '058', bankName: 'GTB', accountNumber: '0123456789' }));
    await as(() => commerce.clearPayoutAccount());

    const fresh = await Tenant.findById(tenant._id).exec();
    expect(fresh.paystackSubaccount == null || fresh.paystackSubaccount === '').toBe(true);
    expect(fresh.payout == null || fresh.payout.accountNumber == null).toBe(true);
  });
});
