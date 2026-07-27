'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { NoTenantContextError } = require('./errors');

const als = new AsyncLocalStorage();

const PLATFORM = Symbol('platform');

/**
 * A Mongoose Query is lazy: `Model.find()` builds it, `.exec()` (or `await`)
 * runs it. If a callback RETURNS an unexecuted Query, the query escapes this
 * scope and runs with no tenant context — producing a NoTenantContextError from
 * code that appears, to the reader, to have one.
 *
 * This does not arise in request handling (tenantResolver wraps next(), so the
 * whole async chain stays inside the context). It arises at explicit boundaries:
 * tests, seed scripts, workers. Catch it there, loudly, with an actionable message.
 */
function assertExecuted(result, wrapper) {
  const isLazyQuery =
    result &&
    typeof result.exec === 'function' &&
    typeof result.then === 'function' &&
    !(result instanceof Promise);

  if (isLazyQuery) {
    throw new NoTenantContextError(
      `${wrapper}() was given a callback that returned an unexecuted Mongoose Query.\n` +
        'The query would run AFTER the tenant context has unwound, and would throw.\n\n' +
        `  wrong:  ${wrapper}(id, uid, () => Model.find({}))\n` +
        `  right:  ${wrapper}(id, uid, () => Model.find({}).exec())\n` +
        `  right:  ${wrapper}(id, uid, async () => { return await Model.find({}); })`
    );
  }
  return result;
}

function runWithTenant(tenantId, userId, fn) {
  if (!tenantId) throw new NoTenantContextError('runWithTenant called without a tenantId');
  return als.run({ tenantId: String(tenantId), userId: userId ? String(userId) : null }, () =>
    assertExecuted(fn(), 'runWithTenant')
  );
}

function runAsPlatform(reason, fn, actingUserId = null) {
  if (!reason) throw new Error('runAsPlatform requires a reason for the audit trail');
  return als.run({ tenantId: PLATFORM, userId: actingUserId ? String(actingUserId) : null, reason }, () =>
    assertExecuted(fn(), 'runAsPlatform')
  );
}

function store() {
  return als.getStore() || null;
}

function isPlatform() {
  const ctx = store();
  return !!ctx && ctx.tenantId === PLATFORM;
}

function currentTenantId() {
  const ctx = store();
  if (!ctx || !ctx.tenantId) {
    throw new NoTenantContextError(
      'No tenant context. Every query must run inside runWithTenant() or runAsPlatform().'
    );
  }
  if (ctx.tenantId === PLATFORM) {
    throw new NoTenantContextError(
      'Platform context has no tenantId. Query platform-scoped models directly.'
    );
  }
  return ctx.tenantId;
}

function currentUserId() {
  const ctx = store();
  return ctx ? ctx.userId : null;
}

module.exports = {
  PLATFORM,
  runWithTenant,
  runAsPlatform,
  isPlatform,
  currentTenantId,
  currentUserId,
  store,
};
