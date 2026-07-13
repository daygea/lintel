'use strict';

const { Schema, Types } = require('mongoose');
const { currentTenantId, isPlatform } = require('../lib/context');
const { CrossTenantWriteError } = require('../lib/errors');

/**
 * tenant-guard
 *
 * The most important file in this repository.
 *
 * Every tenant-owned schema registers this plugin. It makes tenant isolation a
 * property of the driver rather than a property of the developer's attention.
 *
 * Consequence, by design: a query written without tenant context THROWS rather
 * than leaking. That is the failure mode we want. Do not "fix" it by defaulting
 * the tenant.
 *
 * Platform-scoped models (Tenant, User) do not use this plugin and are listed in
 * scripts/checkers/check-tenant-guard.js under PLATFORM_SCOPED.
 *
 * ---------------------------------------------------------------------------
 * ORDERING NOTE — do not "tidy" this away.
 *
 * Mongoose runs validation BEFORE user-registered pre('save') hooks. Since
 * tenantId is `required`, stamping it in pre('save') is too late: validation has
 * already rejected the document. The stamp therefore happens in pre('validate').
 *
 * pre('save') is retained as a second gate: it asserts (but no longer relies on
 * stamping) that the document's tenantId still matches the request context at
 * the moment of the write.
 * ---------------------------------------------------------------------------
 */

const QUERY_HOOKS = [
  'count',
  'countDocuments',
  'deleteMany',
  'deleteOne',
  'estimatedDocumentCount',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
  'distinct',
];

module.exports = function tenantGuard(schema) {
  schema.add({
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
      immutable: true,
    },
  });

  schema.statics.isTenantScoped = true;

  for (const hook of QUERY_HOOKS) {
    schema.pre(hook, function scopeToTenant() {
      if (isPlatform()) return;
      const tenantId = currentTenantId();
      const filter = this.getFilter ? this.getFilter() : this.getQuery();
      if (filter.tenantId && String(filter.tenantId) !== String(tenantId)) {
        throw new CrossTenantWriteError(
          `Query filter names tenant ${filter.tenantId} but the request context is tenant ${tenantId}`
        );
      }
      this.where({ tenantId });
    });
  }

  schema.pre('aggregate', function scopeAggregateToTenant() {
    if (isPlatform()) return;
    this.pipeline().unshift({ $match: { tenantId: toObjectId(currentTenantId()) } });
  });

  // Stamp here, not in pre('save') — validation runs first. See ORDERING NOTE.
  schema.pre('validate', function stampTenant(next) {
    if (isPlatform()) {
      if (!this.tenantId) {
        return next(
          new CrossTenantWriteError('Platform context must set tenantId explicitly when saving')
        );
      }
      return next();
    }

    const tenantId = currentTenantId();

    if (!this.tenantId) {
      this.tenantId = tenantId;
      return next();
    }
    if (String(this.tenantId) !== String(tenantId)) {
      return next(
        new CrossTenantWriteError(
          `Document belongs to tenant ${this.tenantId} but the request context is tenant ${tenantId}`
        )
      );
    }
    return next();
  });

  // Second gate. Asserts only — the stamp already happened during validation.
  schema.pre('save', function assertTenant(next) {
    if (isPlatform()) {
      return this.tenantId
        ? next()
        : next(new CrossTenantWriteError('Platform context must set tenantId explicitly when saving'));
    }

    const tenantId = currentTenantId();
    if (!this.tenantId) {
      return next(new CrossTenantWriteError('Document reached save() with no tenantId'));
    }
    if (String(this.tenantId) !== String(tenantId)) {
      return next(
        new CrossTenantWriteError(
          `Document belongs to tenant ${this.tenantId} but the request context is tenant ${tenantId}`
        )
      );
    }
    return next();
  });

  schema.pre('insertMany', function stampMany(next, docs) {
    if (isPlatform()) return next();
    const tenantId = currentTenantId();
    for (const doc of docs) {
      if (doc.tenantId && String(doc.tenantId) !== String(tenantId)) {
        return next(new CrossTenantWriteError('insertMany contains a foreign tenantId'));
      }
      doc.tenantId = tenantId;
    }
    return next();
  });
};

function toObjectId(id) {
  return id instanceof Types.ObjectId ? id : new Types.ObjectId(String(id));
}
