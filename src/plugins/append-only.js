'use strict';

const { ImmutableRecordError } = require('../lib/errors');

/**
 * append-only
 *
 * For collections where the record IS the audit trail: Attestation, Grade,
 * AccessLog, AuditLog.
 *
 * A revocation is a WRITE, not a delete. A moderated grade is a NEW grade, not an
 * update to the old one. When an elder overrules a junior assessor, both
 * judgements must survive in the record.
 *
 * Enforced here so that nobody can quietly erase history with a convenience
 * method three sprints from now.
 */

const FORBIDDEN = [
  'deleteMany',
  'deleteOne',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
];

module.exports = function appendOnly(schema, options = {}) {
  const modelName = options.modelName || 'This collection';

  schema.statics.isAppendOnly = true;

  for (const op of FORBIDDEN) {
    schema.pre(op, function reject() {
      throw new ImmutableRecordError(modelName, op);
    });
  }

  schema.pre('save', function rejectModification(next) {
    if (!this.isNew) {
      return next(new ImmutableRecordError(modelName, 'save (document already exists)'));
    }
    return next();
  });

  schema.pre('deleteOne', { document: true, query: false }, function rejectDocDelete(next) {
    return next(new ImmutableRecordError(modelName, 'document.deleteOne'));
  });
};
