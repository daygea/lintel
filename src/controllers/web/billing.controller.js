'use strict';

const billing = require('../../services/billing.service');
const commerce = require('../../services/commerce');
const { PLANS } = require('../../config/plans');
const { format, isFree } = require('../../lib/money');

const h = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

exports.show = h(async (req, res) => {
  const t = req.tenant;
  const plans = Object.entries(PLANS).map(([key, p]) => ({
    key,
    label: p.label,
    seats: p.seats,
    price: p.price,
    free: !p.price || isFree(p.price),
    featureCount: p.features.length,
    current: key === t.plan,
  }));

  // The bank list powers the payout dropdown. If Paystack can't be reached, the
  // page still renders — the form just notes that bank selection is unavailable.
  let banks = [];
  let banksError = null;
  try {
    banks = await commerce.listPayoutBanks();
  } catch (err) {
    banksError = 'Bank list is unavailable right now — please try again shortly.';
  }

  res.render('tenant/billing', {
    plans,
    format,
    status: t.status,
    plan: t.plan,
    trialEndsAt: t.trialEndsAt,
    currentPeriodEnd: t.currentPeriodEnd,
    payoutAccount: t.payout && t.payout.accountNumber
      ? {
          accountName: t.payout.accountName,
          bankName: t.payout.bankName,
          bankCode: t.payout.bankCode,
          last4: String(t.payout.accountNumber).slice(-4),
        }
      : null,
    hasSubaccount: !!t.paystackSubaccount,
    businessNameDefault: t.name,
    banks,
    banksError,
    feeBps: (PLANS[t.plan] && PLANS[t.plan].platformFeeBps) || 0,
    paid: req.query.paid || null,
    payout: req.query.payout || null,
    error: req.query.err || null,
  });
});

exports.savePayouts = h(async (req, res) => {
  try {
    const banks = await commerce.listPayoutBanks().catch(() => []);
    const bankCode = (req.body.bankCode || '').trim();
    const bankName = (banks.find((b) => b.code === bankCode) || {}).name || '';
    await commerce.savePayoutAccount({
      bankCode,
      bankName,
      accountNumber: req.body.accountNumber,
      businessName: req.body.businessName,
    });
    res.redirect('/settings/billing?payout=1');
  } catch (err) {
    if (err.status === 422 || err.name === 'ValidationError' || err.message) {
      return res.redirect(`/settings/billing?err=${encodeURIComponent(err.message || 'Could not save payout details')}`);
    }
    throw err;
  }
});

exports.removePayout = h(async (req, res) => {
  await commerce.clearPayoutAccount();
  res.redirect('/settings/billing?payout=removed');
});

exports.subscribe = h(async (req, res) => {
  try {
    const host = req.get('host');
    const proto = host && host.includes('localhost') ? 'http' : 'https';
    const returnUrl = `${proto}://${host}/settings/billing?paid=1`;
    const { authorizationUrl } = await billing.beginSubscription({
      plan: req.body.plan,
      returnUrl,
      email: req.user && req.user.email,
    });
    res.redirect(authorizationUrl);
  } catch (err) {
    if (err.status === 422 || err.name === 'ValidationError') {
      return res.redirect(`/settings/billing?err=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
});
