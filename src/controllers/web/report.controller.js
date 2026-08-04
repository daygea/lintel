'use strict';

const platform = require('../../services/platform.service');
const { currentTenantId } = require('../../lib/context');

const h = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

exports.show = (req, res) => {
  res.render('report/new', { sent: req.query.sent || null, error: null });
};

exports.submit = h(async (req, res) => {
  await platform.fileReport({
    tenantId: currentTenantId(),
    subjectType: ['tenant', 'user', 'resource'].includes(req.body.subjectType) ? req.body.subjectType : 'resource',
    subjectRef: (req.body.subjectRef || '').trim() || undefined,
    category: req.body.category || 'other',
    detail: (req.body.detail || '').trim() || undefined,
    reportedByUserId: req.user._id,
  });
  res.redirect('/report?sent=1');
});
