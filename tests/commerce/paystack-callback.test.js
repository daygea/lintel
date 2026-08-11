'use strict';

/**
 * When a learner pays, the return URL is forwarded to Paystack as callback_url so
 * the payer lands back on their own fees page — and it's omitted when not given.
 */

const { PaystackProvider } = require('../../src/services/commerce/providers/paystack');

let savedKey;
const amount = { amount: 500000, currency: 'NGN' };

beforeEach(() => {
  savedKey = process.env.PAYSTACK_SECRET_KEY;
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
  vi.spyOn(global, 'fetch').mockResolvedValue({
    json: async () => ({ status: true, data: { authorization_url: 'https://pay.test/x', reference: 'r' } }),
  });
});
afterEach(() => {
  process.env.PAYSTACK_SECRET_KEY = savedKey;
  vi.restoreAllMocks();
});

const bodyOf = () => JSON.parse(global.fetch.mock.calls[0][1].body);

it('sends callback_url when a return URL is given', async () => {
  await new PaystackProvider().initialize({ amount, email: 'l@x.io', reference: 'r', callbackUrl: 'https://oiss.lintel.africa/my/fees?paid=1' });
  expect(bodyOf().callback_url).toBe('https://oiss.lintel.africa/my/fees?paid=1');
});

it('omits callback_url when none is given', async () => {
  await new PaystackProvider().initialize({ amount, email: 'l@x.io', reference: 'r' });
  expect(bodyOf().callback_url).toBeUndefined();
});
