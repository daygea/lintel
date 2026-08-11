'use strict';

const billing = require('../../services/billing.service');
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
  res.render('tenant/billing', {
    plans,
    format,
    status: t.status,
    plan: t.plan,
    trialEndsAt: t.trialEndsAt,
    currentPeriodEnd: t.currentPeriodEnd,
    subaccount: t.paystackSubaccount || '',
    feeBps: (PLANS[t.plan] && PLANS[t.plan].platformFeeBps) || 0,
    paid: req.query.paid || null,
    payout: req.query.payout || null,
    error: req.query.err || null,
  });
});

exports.savePayouts = h(async (req, res) => {
  const { Tenant } = require('../../models');
  const code = (req.body.subaccount || '').trim();
  await Tenant.updateOne({ _id: req.tenant._id }, { paystackSubaccount: code }).exec();
  res.redirect('/settings/billing?payout=1');
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
