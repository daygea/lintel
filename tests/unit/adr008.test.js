'use strict';

// Requiring the evaluator loads and registers every rule (it does require('./rules')).
// Real code always reaches the registry through the evaluator, so this mirrors reality.
require('../../src/services/eligibility/evaluator');
const registry = require('../../src/services/eligibility/registry');
const fs = require('node:fs');

/**
 * ADR-008, mechanically checked: adding assessment_score was a register() call in
 * a rule file, NOT an edit to the evaluator. If someone "teaches" the evaluator
 * about specific rule types, this catches it.
 */
describe('ADR-008 — the evaluator is written once', () => {
  it('assessment_score is now registered', () => {
    expect(registry.get('assessment_score')).toBeTypeOf('function');
  });

  it('payment_state is registered (Sprint 6) — the rule set is now complete', () => {
    expect(registry.get('payment_state')).toBeTypeOf('function');
  });

  it('the evaluator names no specific rule type', () => {
    const src = fs.readFileSync('src/services/eligibility/evaluator.js', 'utf8');
    for (const type of ['assessment_score', 'attestation', 'enrolled', 'payment_state', 'membership_role']) {
      expect(src.includes(`'${type}'`)).toBe(false);
      expect(src.includes(`"${type}"`)).toBe(false);
    }
  });
});
