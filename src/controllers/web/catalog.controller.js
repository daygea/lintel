'use strict';

const catalog = require('../../services/catalog.service');
const { format } = require('../../lib/money');

const h = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

exports.show = h(async (req, res) => {
  const { courses, programmes } = await catalog.catalogue({
    userId: req.user._id,
    locale: req.tenant.defaultLocale,
  });
  res.render('catalog/index', {
    courses,
    programmes,
    format,
    applied: req.query.applied || null,
    error: req.query.err || null,
  });
});
