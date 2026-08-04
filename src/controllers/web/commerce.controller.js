'use strict';

const commerce = require('../../services/commerce');
const { pick } = require('../../plugins/locale-map');
const { ValidationError } = require('../../lib/errors');
const { format, SUPPORTED } = require('../../lib/money');

const h = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

exports.fees = h(async (req, res) => {
  const schedules = await commerce.listSchedules();
  res.render('commerce/fees', { schedules, pick, format, currencies: SUPPORTED, locale: req.tenant.defaultLocale, error: null });
});

/** Major units (what a person types, e.g. 250.00) -> integer minor units. */
function toMinor(major) {
  const n = parseFloat(major);
  if (!isFinite(n) || n < 0) throw new ValidationError('Enter a valid amount');
  return Math.round(n * 100);
}

exports.createSchedule = h(async (req, res) => {
  const loc = req.tenant.defaultLocale;
  const currency = (req.body.currency || 'NGN').toUpperCase();
  const items = [];

  // A schedule's total is expressed through its items — there is no separate
  // total field. The headline "amount" is recorded as a first item; leave it 0
  // (and add no line items) for a free schedule.
  const headline = toMinor(req.body.amount || 0);
  if (headline > 0) {
    items.push({ label: { [loc]: req.body.amount_label || 'Tuition' }, amount: { amount: headline, currency } });
  }

  // Optional additional line items: parallel label/amount arrays.
  const itemLabels = [].concat(req.body.item_label || []);
  const itemAmounts = [].concat(req.body.item_amount || []);
  itemLabels.forEach((label, i) => {
    if (label && label.trim() && itemAmounts[i]) {
      items.push({ label: { [loc]: label.trim() }, amount: { amount: toMinor(itemAmounts[i]), currency } });
    }
  });

  await commerce.createSchedule({
    label: { [loc]: req.body.label },
    items,
  });
  res.redirect('/fees');
});

exports.recordPayment = h(async (req, res) => {
  const currency = (req.body.currency || 'NGN').toUpperCase();
  await commerce.recordPayment({
    invoiceId: req.body.invoiceId,
    amount: { amount: toMinor(req.body.amount), currency },
    method: req.body.method || 'bank_transfer',
    note: req.body.note || undefined,
  });
  res.redirect('/fees');
});

/* --------------------------------------------------------------------- invoices */

exports.raiseInvoice = h(async (req, res) => {
  const invoice = await commerce.raiseInvoice({
    enrollmentId: req.body.enrollmentId,
    feeScheduleId: req.body.feeScheduleId,
  });
  res.redirect(`/invoices/${invoice._id}`);
});

exports.showInvoice = h(async (req, res) => {
  const view = await commerce.invoiceView(req.params.id);
  if (!view) return res.status(404).render('error', { status: 404, message: 'Invoice not found' });
  res.render('commerce/invoice', {
    ...view, format, currencies: SUPPORTED, pick,
    online: commerce.PROVIDERS.paystack.isConfigured(),
    error: null,
  });
});

exports.recordInvoicePayment = h(async (req, res) => {
  const currency = (req.body.currency || 'NGN').toUpperCase();
  await commerce.recordPayment({
    invoiceId: req.params.id,
    amount: { amount: toMinor(req.body.amount), currency },
    method: req.body.method === 'cash' ? 'cash' : 'bank_transfer',
    note: req.body.note || undefined,
  });
  res.redirect(`/invoices/${req.params.id}`);
});

exports.payInvoice = h(async (req, res) => {
  const { authorizationUrl } = await commerce.beginPayment({ invoiceId: req.params.id });
  res.redirect(authorizationUrl); // Paystack checkout (or a dev stub URL when unconfigured)
});

exports.waiveInvoice = h(async (req, res) => {
  await commerce.waive({ invoiceId: req.params.id, reason: req.body.reason || 'Waived' });
  res.redirect(`/invoices/${req.params.id}`);
});
