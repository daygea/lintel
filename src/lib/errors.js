'use strict';

class AppError extends Error {
  constructor(message, { status = 500, code = 'internal_error', expose = false } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.expose = expose;
    Error.captureStackTrace(this, this.constructor);
  }
}

class NoTenantContextError extends AppError {
  constructor(message = 'No tenant context') {
    super(message, { status: 500, code: 'no_tenant_context', expose: false });
  }
}

class CrossTenantWriteError extends AppError {
  constructor(message = 'Refusing to write a document belonging to another tenant') {
    super(message, { status: 500, code: 'cross_tenant_write', expose: false });
  }
}

class ImmutableRecordError extends AppError {
  constructor(model, op) {
    super(`${model} is append-only. "${op}" is not permitted. Write a new record instead.`, {
      status: 500,
      code: 'immutable_record',
      expose: false,
    });
  }
}

class TenantNotFoundError extends AppError {
  constructor(host) {
    super(`No institution is served at ${host}`, {
      status: 404,
      code: 'tenant_not_found',
      expose: true,
    });
  }
}

class NotAuthenticatedError extends AppError {
  constructor() {
    super('Sign in to continue', { status: 401, code: 'not_authenticated', expose: true });
  }
}

class NotAuthorisedError extends AppError {
  constructor(message = 'You do not have permission to do that') {
    super(message, { status: 403, code: 'not_authorised', expose: true });
  }
}

class ValidationError extends AppError {
  constructor(message, details = {}) {
    super(message, { status: 422, code: 'validation_failed', expose: true });
    this.details = details;
  }
}

module.exports = {
  AppError,
  NoTenantContextError,
  CrossTenantWriteError,
  ImmutableRecordError,
  TenantNotFoundError,
  NotAuthenticatedError,
  NotAuthorisedError,
  ValidationError,
};
