'use strict';

/**
 * THE EVALUATOR. Written once. Do not modify it to add a rule type — add a rule
 * file to rules/ and register it. If you find yourself editing this file to teach
 * it about a new kind of rule, stop: that is the mistake ADR-008 exists to prevent.
 *
 * Pure with respect to its inputs: given a policy and a learner context, it asks
 * the registry to evaluate each rule and combines the results with the policy's
 * combinator. It resolves the denial message but takes no action and writes no
 * log — the caller decides what to do with the verdict and records it.
 */
require('./rules'); // registers all rule types
const registry = require('./registry');
const { pick } = require('../../plugins/locale-map');

/**
 * @returns {Promise<{ allowed: boolean, failedRules: string[], message: string }>}
 */
async function evaluate(policy, ctx) {
  if (!policy || !policy.rules || policy.rules.length === 0) {
    return { allowed: true, failedRules: [], message: '' };
  }

  const now = ctx.now || new Date();
  const context = { ...ctx, now };

  const results = [];
  for (const rule of policy.rules) {
    const fn = registry.get(rule.type);
    if (!fn) {
      // An unknown rule type fails CLOSED. A policy that references a rule we
      // cannot evaluate must withhold, never wave through.
      results.push({ type: rule.type, passed: false, unknown: true });
      continue;
    }
    let passed = false;
    try {
      passed = await fn(rule.params, context);
    } catch {
      passed = false; // an erroring rule fails closed
    }
    results.push({ type: rule.type, passed });
  }

  const allowed =
    policy.combinator === 'any'
      ? results.some((r) => r.passed)
      : results.every((r) => r.passed);

  const failedRules = results.filter((r) => !r.passed).map((r) => r.type);
  const message = allowed ? '' : pick(policy.denialMessage, context.locale || 'en');

  return { allowed, failedRules, message };
}

module.exports = { evaluate };
