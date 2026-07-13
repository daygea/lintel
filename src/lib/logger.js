'use strict';

const pino = require('pino');
const { logLevel, isProd } = require('../config/env');
const { store } = require('./context');

const base = pino({
  level: logLevel,
  transport: isProd ? undefined : { target: 'pino-pretty', options: { colorize: true } },
});

/** Every log line carries the tenant. Non-negotiable for incident response. */
const logger = new Proxy(base, {
  get(target, prop) {
    if (['info', 'warn', 'error', 'debug', 'fatal', 'trace'].includes(prop)) {
      return (obj, ...rest) => {
        const ctx = store();
        const tenantId = ctx && typeof ctx.tenantId === 'string' ? ctx.tenantId : undefined;
        const enriched =
          typeof obj === 'string'
            ? { msg: obj, tenantId, userId: ctx?.userId }
            : { ...obj, tenantId, userId: ctx?.userId };
        return target[prop](enriched, ...rest);
      };
    }
    return target[prop];
  },
});

module.exports = logger;
