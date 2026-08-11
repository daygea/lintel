'use strict';

const commerce = require('../../services/commerce');
const { format } = require('../../lib/money');

const h = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

exports.mine = h(async (req, res) => {
  const rows = await commerce.myInvoices(req.user._id);
  res.render('fees/my', {
    rows, format,
    paid: req.query.paid || null,
    error: req.query.err || null,
  });
});

// Start an online payment for one of the learner's own invoices and hand off to
// the provider's hosted page. (In dev with no Paystack key the provider returns a
// stub URL, so the flow still completes.)
exports.pay = h(async (req, res) => {
  try {
    const host = req.get('host');
    const proto = host && host.includes('localhost') ? 'http' : 'https';
    const returnUrl = `${proto}://${host}/my/fees?paid=1`;
    const { authorizationUrl } = await commerce.beginPayment({ invoiceId: req.params.invoiceId, returnUrl });
    res.redirect(authorizationUrl);
  } catch (err) {
    if (err.status === 422 || err.name === 'ValidationError') {
      return res.redirect(`/my/fees?err=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
});
