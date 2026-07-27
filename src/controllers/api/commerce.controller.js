'use strict';

const commerce = require('../../services/commerce');

const h = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

exports.listSchedules = h(async (req, res) => res.json({ schedules: await commerce.listSchedules(req.query.cohortId ? { cohortId: req.query.cohortId } : {}) }));
exports.createSchedule = h(async (req, res) => res.status(201).json({ schedule: await commerce.createSchedule(req.body) }));

exports.raiseInvoice = h(async (req, res) => res.status(201).json({ invoice: await commerce.raiseInvoice(req.body) }));
exports.invoice = h(async (req, res) => res.json({ invoice: await commerce.invoiceFor(req.params.enrollmentId) }));

exports.beginPayment = h(async (req, res) => res.json(await commerce.beginPayment(req.body)));
exports.confirmTransfer = h(async (req, res) => res.json(await commerce.confirmBankTransfer(req.body)));
exports.waive = h(async (req, res) => res.json({ invoice: await commerce.waive(req.body) }));
exports.payments = h(async (req, res) => res.json({ payments: await commerce.paymentsFor(req.params.invoiceId) }));
