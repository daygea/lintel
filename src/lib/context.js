'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { NoTenantContextError } = require('./errors');

const als = new AsyncLocalStorage();

const PLATFORM = Symbol('platform');

function runWithTenant(tenantId, userId, fn) {
  if (!tenantId) throw new NoTenantContextError('runWithTenant called without a tenantId');
  return als.run({ tenantId: String(tenantId), userId: userId ? String(userId) : null }, fn);
}

function runAsPlatform(reason, fn) {
  if (!reason) throw new Error('runAsPlatform requires a reason for the audit trail');
  return als.run({ tenantId: PLATFORM, userId: null, reason }, fn);
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
