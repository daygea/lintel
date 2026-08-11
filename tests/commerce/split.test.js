'use strict';

/**
 * Marketplace split: when the institution has a Paystack subaccount, learner
 * payments route to it and Lintel keeps a plan-based cut as the transaction
 * charge. The Paystack provider forwards those fields; without a subaccount it
 * doesn't.
 */

const mongoose = require('mongoose');
const { Tenant, User, Invoice } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const commerce = require('../../src/services/commerce');
const { PaystackProvider } = require('../../src/services/commerce/providers/paystack');

const NGN = (n) => ({ amount: n, currency: 'NGN' });

describe('provider forwards split params', () => {
  let savedKey;
  beforeEach(() => {
    savedKey = process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ status: true, data: { authorization_url: 'https://pay/x', reference: 'r' } }),
    });
  });
  afterEach(() => { process.env.PAYSTACK_SECRET_KEY = savedKey; vi.restoreAllMocks(); });
  const bodyOf = () => JSON.parse(global.fetch.mock.calls[0][1].body);

  it('sends subaccount + transaction_charge + bearer when given', async () => {
    await new PaystackProvider().initialize({ amount: NGN(100000), email: 'l@x.io', reference: 'r', subaccount: 'ACCT_x', transactionCharge: 5000 });
    const b = bodyOf();
    expect(b.subaccount).toBe('ACCT_x');
    expect(b.transaction_charge).toBe(5000);
    expect(b.bearer).toBe('subaccount');
  });

  it('omits split fields with no subaccount', async () => {
    await new PaystackProvider().initialize({ amount: NGN(100000), email: 'l@x.io', reference: 'r' });
    expect(bodyOf().subaccount).toBeUndefined();
  });
});

describe('beginPayment computes the plan-based charge', () => {
  it('passes the subaccount and a trial-plan 5% cut to the provider', async () => {
    const tenant = await Tenant.create({ slug: 'test-split', name: 'S', locales: ['en'], status: 'trial', plan: 'trial', paystackSubaccount: 'ACCT_y' });
    const user = await User.create({ email: 'l@x.io', name: 'L', passwordHash: await User.hashPassword('x'.repeat(12)) });
    const spy = vi.spyOn(commerce.PROVIDERS.paystack, 'initialize').mockResolvedValue({ authorizationUrl: 'u', reference: 'r' });

    await runWithTenant(tenant._id, user._id, async () => {
      const inv = await Invoice.create({ enrollmentId: new mongoose.Types.ObjectId(), userId: user._id, amountDue: NGN(100000), amountPaid: NGN(0), state: 'unpaid' });
      await commerce.beginPayment({ invoiceId: inv._id });
    });

    expect(spy).toHaveBeenCalled();
    const arg = spy.mock.calls[0][0];
    expect(arg.subaccount).toBe('ACCT_y');
    expect(arg.transactionCharge).toBe(5000); // 5% of 100000 (trial = 500 bps)
    spy.mockRestore();
  });
});
