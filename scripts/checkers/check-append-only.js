'use strict';
const { walk, read, rel } = require('./lib');

/** Nobody may mutate the record that IS the audit trail. */
const IMMUTABLE = ['AuditLog', 'Attestation', 'Grade', 'AccessLog'];
const MUTATORS = ['updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'findOneAndUpdate', 'findByIdAndUpdate', 'findByIdAndDelete', 'findOneAndDelete', 'replaceOne'];

module.exports = function checkAppendOnly() {
  const problems = [];
  for (const file of [...walk('src/services'), ...walk('src/controllers')]) {
    const src = read(file);
    for (const model of IMMUTABLE) {
      for (const op of MUTATORS) {
        if (new RegExp(`\\b${model}\\.${op}\\s*\\(`).test(src)) {
          problems.push(
            `${rel(file)}: calls ${model}.${op}(). ${model} is append-only — revocation is a WRITE, not a delete. Write a new record.`
          );
        }
      }
    }
  }
  return problems;
};
