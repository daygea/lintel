'use strict';

require('../../src/services/eligibility/evaluator'); // loads + registers rules
const registry = require('../../src/services/eligibility/registry');

/**
 * payment_state was the last deferred rule. Its arrival, like assessment_score's,
 * must not have touched the evaluator — the registry is now complete for the MVP.
 */
describe('payment_state rule (ADR-008, final rule)', () => {
  it('is registered', () => {
    expect(registry.get('payment_state')).toBeTypeOf('function');
  });

  it('the MVP rule set is now complete', () => {
    for (const t of ['enrolled', 'attestation', 'membership_role', 'course_completed', 'manual_approval', 'assessment_score', 'payment_state']) {
      expect(registry.get(t)).toBeTypeOf('function');
    }
  });
});
