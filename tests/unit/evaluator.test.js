'use strict';

const { evaluate } = require('../../src/services/eligibility/evaluator');
const registry = require('../../src/services/eligibility/registry');

describe('the evaluator (no database)', () => {
  it('allows an empty or absent policy', async () => {
    expect((await evaluate(null, {})).allowed).toBe(true);
    expect((await evaluate({ rules: [] }, {})).allowed).toBe(true);
  });

  it('fails closed on an unknown rule type', async () => {
    const v = await evaluate(
      { rules: [{ type: 'nope' }], combinator: 'all', denialMessage: { en: 'held' } },
      {}
    );
    expect(v.allowed).toBe(false);
    expect(v.message).toBe('held');
  });

  it('combines with all', async () => {
    registry.register('always', async () => true);
    registry.register('never', async () => false);

    const allPass = await evaluate(
      { rules: [{ type: 'always' }, { type: 'always' }], combinator: 'all', denialMessage: { en: 'x' } }, {}
    );
    expect(allPass.allowed).toBe(true);

    const oneFails = await evaluate(
      { rules: [{ type: 'always' }, { type: 'never' }], combinator: 'all', denialMessage: { en: 'x' } }, {}
    );
    expect(oneFails.allowed).toBe(false);
    expect(oneFails.failedRules).toEqual(['never']);
  });

  it('combines with any', async () => {
    const v = await evaluate(
      { rules: [{ type: 'always' }, { type: 'never' }], combinator: 'any', denialMessage: { en: 'x' } }, {}
    );
    expect(v.allowed).toBe(true);
  });

  it('an erroring rule fails closed, it does not crash', async () => {
    registry.register('throws', async () => { throw new Error('boom'); });
    const v = await evaluate(
      { rules: [{ type: 'throws' }], combinator: 'all', denialMessage: { en: 'held' } }, {}
    );
    expect(v.allowed).toBe(false);
  });

  it('the five core rule types are registered', () => {
    for (const t of ['enrolled', 'attestation', 'membership_role', 'course_completed', 'manual_approval']) {
      expect(registry.get(t)).toBeTypeOf('function');
    }
  });

  it('the full MVP rule set is registered (Sprints 3, 5a, 6)', () => {
    // Sprint 3 asserted assessment_score and payment_state were absent. 5a and 6
    // registered them, each without touching the evaluator — ADR-008 across three
    // sprints. The registry is now complete for the MVP.
    expect(registry.get('assessment_score')).toBeTypeOf('function');
    expect(registry.get('payment_state')).toBeTypeOf('function');
  });
});
