'use strict';

const logger = require('../lib/logger');
const { AppError } = require('../lib/errors');

module.exports = function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const expose = err instanceof AppError && err.expose;

  if (status >= 500) {
    logger.error({ err, path: req.path, method: req.method }, 'unhandled error');
  } else {
    logger.warn({ code: err.code, path: req.path, msg: err.message }, 'request failed');
  }

  const payload = {
    error: {
      code: err.code || 'internal_error',
      message: expose ? err.message : 'Something went wrong on our side.',
    },
  };

  if (req.path.startsWith('/api/')) return res.status(status).json(payload);
  return res.status(status).render('error', { status, message: payload.error.message });
};
