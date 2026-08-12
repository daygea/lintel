'use strict';

const { Schema } = require('mongoose');
const { ValidationError } = require('./errors');

/**
 * Money is always { amount: <integer minor units>, currency: <ISO-4217> }.
 * Never a float. Never a bare number. 
 *
 * ₦52,000.00 is { amount: 5200000, currency: 'NGN' }.
 * Free is { amount: 0, currency: <tenant base currency> } — and free is NOT the
 * same as open. An unpriced course can still be gated by attestation.
 */

const SUPPORTED = ['NGN', 'GHS', 'KES', 'ZAR', 'USD', 'EUR', 'GBP'];
const MINOR_UNITS = { NGN: 2, GHS: 2, KES: 2, ZAR: 2, USD: 2, EUR: 2, GBP: 2 };

const MoneySchema = new Schema(
  {
    amount: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: 'amount must be an integer of minor units' },
    },
    currency: { type: String, required: true, enum: SUPPORTED, uppercase: true },
  },
  { _id: false }
);

const zero = (currency) => ({ amount: 0, currency });

// Same shape as MoneySchema but WITHOUT the min:0 floor — for ledger reversals,
// where a refund is recorded as a negative Payment. Only Payment.amount uses this;
// everywhere else money stays >= 0.
const SignedMoneySchema = new Schema(
  {
    amount: {
      type: Number,
      required: true,
      validate: { validator: Number.isInteger, message: 'amount must be an integer of minor units' },
    },
    currency: { type: String, required: true, enum: SUPPORTED, uppercase: true },
  },
  { _id: false }
);
const isFree = (money) => !money || money.amount === 0;

function assertSameCurrency(a, b) {
  if (a.currency !== b.currency) {
    throw new ValidationError(`Cannot combine ${a.currency} with ${b.currency}`);
  }
}

const add = (a, b) => (assertSameCurrency(a, b), { amount: a.amount + b.amount, currency: a.currency });
const subtract = (a, b) => (assertSameCurrency(a, b), { amount: a.amount - b.amount, currency: a.currency });

function format(money, locale = 'en-NG') {
  if (!money) return '';
  const exp = MINOR_UNITS[money.currency] ?? 2;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
  }).format(money.amount / 10 ** exp);
}

module.exports = { MoneySchema, SignedMoneySchema, SUPPORTED, zero, isFree, add, subtract, format };
