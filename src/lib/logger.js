'use strict';

const pino = require('pino');
const { logLevel, isProd } = require('../config/env');
const { store } = require('./context');

/** Pretty logs are a convenience, never a boot requirement. */
function transport() {
  if (isProd) return undefined;
  try {
    require.resolve('pino-pretty');
    return { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } };
  } catch {
    return undefined; // fall back to JSON lines
  }
}

const base = pino({ level: logLevel, transport: transport() });

const LEVELS = ['info', 'warn', 'error', 'debug', 'fatal', 'trace'];

/**
 * Every log line carries the tenant. Non-negotiable: during an incident, "which
 * institution was affected?" must be answerable with a grep, not an investigation.
 */
const logger = new Proxy(base, {
  get(target, prop) {
    if (!LEVELS.includes(prop)) return target[prop];

    return (obj, ...rest) => {
      const ctx = store();
      const tenantId = ctx && typeof ctx.tenantId === 'string' ? ctx.tenantId : undefined;
      const userId = ctx ? ctx.userId : undefined;

      const enriched =
        typeof obj === 'string'
          ? { msg: obj, tenantId, userId }
          : { ...obj, tenantId, userId };

      return target[prop](enriched, ...rest);
    };
  },
});

module.exports = logger;
