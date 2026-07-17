'use strict';

/**
 * The rule registry.
 *
 * A rule type is a plugin: { slug, async evaluate(params, ctx) -> boolean }.
 * Rules register themselves here at load time. The evaluator only ever asks the
 * registry "does a rule of this type pass?" — it never knows the set of types.
 *
 * This is the mechanism (ADR-008) that lets Sprint 6 add 'payment_state' and
 * Sprint 5 add 'assessment_score' by writing a new file in rules/ and registering
 * it. The evaluator, written once in this sprint, is never modified again.
 */
const REGISTRY = new Map();

function register(slug, evaluate) {
  if (REGISTRY.has(slug)) throw new Error(`Rule type "${slug}" is already registered`);
  REGISTRY.set(slug, evaluate);
}

function get(slug) {
  return REGISTRY.get(slug);
}

const known = () => [...REGISTRY.keys()];

module.exports = { register, get, known, REGISTRY };
