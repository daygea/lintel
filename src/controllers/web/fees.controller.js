'use strict';

const commerce = require('../../services/commerce');
const { format } = require('../../lib/money');

const h = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

exports.mine = h(async (req, res) => {
  // Verify-on-return. Paystack appends ?reference=/&trxref= to the callback; confirm
  // it server-side so the learner's access opens immediately rather than waiting on
  // the webhook — and so the banner tells the truth instead of trusting the redirect.
  const reference = req.query.reference || req.query.trxref || null;
  let payStatus = null; // 'confirmed' | 'pending' | null
  if (reference) {
    try {
      const { paid } = await commerce.confirmByReference(reference, { requireOwnerId: req.user._id });
      payStatus = paid ? 'confirmed' : 'pending';
    } catch {
      payStatus = 'pending'; // verification hiccup — the webhook/reconcile will still catch it
    }
  } else if (req.query.paid) {
    payStatus = 'pending'; // returned from checkout without a reference to verify yet
  }

  const rows = await commerce.myInvoices(req.user._id);
  res.render('fees/my', {
    rows, format,
    payStatus,
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
    const { authorizationUrl } = await commerce.beginPayment({ invoiceId: req.params.invoiceId, returnUrl, requireOwnerId: req.user._id });
    res.redirect(authorizationUrl);
  } catch (err) {
    if (err.status === 422 || err.name === 'ValidationError') {
      return res.redirect(`/my/fees?err=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
});
