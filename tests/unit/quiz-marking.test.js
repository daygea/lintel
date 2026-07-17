'use strict';

const { mark } = require('../../src/services/quiz.service');

/**
 * Auto-marking, proven per type without a database. A marking bug is silent —
 * a learner is simply given the wrong score and rarely knows — so every branch
 * is pinned here.
 */
const id = (n) => ({ toString: () => n, _id: n });

describe('quiz auto-marking', () => {
  it('mcq: full marks for the right option, zero otherwise', () => {
    const q = { type: 'mcq', points: 2, options: [{ _id: 'a', correct: false }, { _id: 'b', correct: true }] };
    expect(mark(q, 'b')).toBe(2);
    expect(mark(q, 'a')).toBe(0);
    expect(mark(q, null)).toBe(0);
  });

  it('multi: partial credit, floored at zero', () => {
    const q = { type: 'multi', points: 3, options: [
      { _id: 'a', correct: true }, { _id: 'b', correct: true }, { _id: 'c', correct: false },
    ] };
    expect(mark(q, ['a', 'b'])).toBe(3);        // both right
    expect(mark(q, ['a'])).toBeCloseTo(1.5);     // one of two right
    expect(mark(q, ['a', 'c'])).toBeCloseTo(0);  // +1 -1 = 0
    expect(mark(q, ['c'])).toBe(0);              // wrong only, floored
  });

  it('numeric: within tolerance passes', () => {
    const q = { type: 'numeric', points: 1, numericAnswer: 42, tolerance: 0.5 };
    expect(mark(q, '42.3')).toBe(1);
    expect(mark(q, '43')).toBe(0);
    expect(mark(q, 'not a number')).toBe(0);
  });

  it('short: accepted answers, case per flag', () => {
    const q = { type: 'short', points: 1, answers: ['Ifá', 'Ifa'], caseSensitive: false };
    expect(mark(q, 'ifa')).toBe(1);
    const strict = { ...q, caseSensitive: true };
    expect(mark(strict, 'ifa')).toBe(0);
  });

  it('matching: full marks only when every pair is right and complete', () => {
    const q = { type: 'matching', points: 2, pairs: [{ left: 'A', right: '1' }, { left: 'B', right: '2' }] };
    expect(mark(q, { A: '1', B: '2' })).toBe(2);
    expect(mark(q, { A: '1', B: '1' })).toBe(0);
    expect(mark(q, { A: '1' })).toBe(0); // incomplete
  });

  it('essay is never auto-marked (handled by needsManual upstream)', () => {
    expect(mark({ type: 'essay', points: 5 }, 'a thoughtful answer')).toBe(0);
  });
});
