'use strict';
const { walk, read, rel } = require('./lib');

/**
 * Money is never a Number. Floats and currency do not mix.
 *
 * A field named for money (price/fee/amount/cost/total) must use MoneySchema.
 * EXCEPTION: fields explicitly suffixed *Points are rubric SCORES, not currency —
 * a count of marks, which is legitimately an integer. The exception is narrow on
 * purpose: only the "...Points" suffix is exempt, so "totalCost" still trips.
 */
module.exports = function checkMoney() {
  const problems = [];
  const re = /(\w*(?:price|fee|amount|cost|total)\w*)\s*:\s*\{\s*type\s*:\s*Number/gi;
  for (const file of walk('src/models')) {
    const src = read(file);
    let m;
    while ((m = re.exec(src))) {
      if (/amount\s*:\s*\{\s*type:\s*Number/.test(m[0]) && file.endsWith('money.js')) continue;
      if (/Points$/.test(m[1])) continue; // rubric score, not money
      problems.push(
        `${rel(file)}: field "${m[1]}" is typed Number. Use MoneySchema from lib/money.js — { amount: <minor units>, currency }.`
      );
    }
  }
  return problems;
};
