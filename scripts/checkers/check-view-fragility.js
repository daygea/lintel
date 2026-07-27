'use strict';

/**
 * Catch the specific fragility that has 500'd pages more than once: calling a
 * string/array method directly on a property that can be null/undefined at
 * runtime, inside a view, with no guard.
 *
 * The pattern that bit us: `<%= b.type.replace('_',' ') %>` — when a content
 * block had no `type`, the whole lesson page 500'd. Same risk for `.toUpperCase`,
 * `.toLowerCase`, `.split`, `.charAt`, and `.length` on a possibly-absent array.
 *
 * This checker is deliberately CONSERVATIVE — it only flags an unguarded method
 * call on a DOTTED property (`x.y.method(`), which is the dangerous shape, and
 * only when there is no `?`, `||`, or `&&` guarding it on the same output tag.
 * A bare local like `locale.toUpperCase()` is not flagged (locals are controlled
 * by the controller); only property access on loop/data variables is.
 *
 * If it false-positives on something genuinely safe, guard it anyway (`x.y ? …`)
 * or add the file:line to ALLOW below with a reason — the guard is cheap and the
 * 500 is not.
 */

const { walk, read, rel } = require('./lib');

// Methods that throw on null/undefined receivers.
const RISKY = ['replace', 'toUpperCase', 'toLowerCase', 'split', 'charAt', 'slice', 'padStart', 'padEnd'];

// Known-safe lines, each with a reason. (Empty — nothing exempted yet.)
const ALLOW = new Set([
  // 'src/views/foo.ejs:12',  // reason
]);

module.exports = function checkViewFragility() {
  const problems = [];
  const methodAlt = RISKY.join('|');
  // Match  <something>.<prop>.<risky>(   — a method on a dotted property.
  const re = new RegExp(`([a-zA-Z_$][\\w$]*\\.[a-zA-Z_$][\\w$]*)\\.(${methodAlt})\\(`, 'g');

  for (const file of walk('src/views', '.ejs')) {
    const lines = read(file).split('\n');
    lines.forEach((line, i) => {
      // Only care about EJS output/eval tags.
      if (!line.includes('<%')) return;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(line)) !== null) {
        const expr = m[1]; // e.g. b.type
        // Guarded if the SAME line has a `?`, `||`, or `&&` referencing the base.
        const base = expr.split('.')[0];
        const guarded =
          line.includes(`${expr} ?`) ||
          line.includes(`${expr}?.`) ||
          line.includes(`${expr} ||`) ||
          line.includes(`${expr} &&`) ||
          line.includes(`(${expr}||`) ||
          new RegExp(`${base}\\s*&&`).test(line) ||
          new RegExp(`typeof\\s+${base}`).test(line);
        if (guarded) continue;
        const loc = `${rel(file)}:${i + 1}`;
        if (ALLOW.has(loc)) continue;
        problems.push(`${loc}: \`${expr}.${m[2]}(\` — method on a possibly-undefined property. Guard it: \`${expr} ? ${expr}.${m[2]}(…) : …\`. This is the shape that 500'd the lesson page.`);
      }
    });
  }
  return problems;
};
