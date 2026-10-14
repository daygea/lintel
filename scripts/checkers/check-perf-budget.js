'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Performance budget — the learner-facing assets must stay small.
 *
 * Lintel ships NO front-end framework: the PWA is hand-written vanilla JS, and
 * that leanness is a feature (fast first paint on a mid-range Android over a
 * Nigerian mobile connection — the real target device). This checker locks that
 * in. If someone pastes a charting library into app.js or lets the CSS balloon,
 * the build fails here instead of the regression reaching a learner's phone.
 *
 * Budgets are RAW (uncompressed) bytes — deterministic, no build step to run.
 * Over the wire these gzip to roughly a third. Headroom above today's sizes is
 * deliberate (~35–50%): a budget that trips on the next ordinary edit is noise.
 * When a rise is genuinely needed, raise the number HERE, in the same commit —
 * a conscious act, not a silent drift.
 */

// path (repo-relative) → budget in bytes. A file that isn't present is skipped
// (other checkers and boot guard existence); only a present, over-budget file fails.
const BUDGETS = {
  'public/app/app.js': 72 * 1024,
  'public/app/app.css': 30 * 1024,
  'public/app/pack.js': 6 * 1024,
  'public/app/push.js': 4 * 1024,
  'public/sw.js': 8 * 1024,
  'public/css/lintel.css': 24 * 1024,
  'public/js/upload.js': 6 * 1024,
};

// The PWA critical path — what index.html pulls in before a learner sees their
// home screen. Bounded as a whole, not just file by file, so growth spread thin
// across both files still gets caught.
const SHELL = ['public/app/app.js', 'public/app/app.css'];
const SHELL_BUDGET = 96 * 1024;

const fmt = (n) => `${(n / 1024).toFixed(1)}KB`;

module.exports = function checkPerfBudget() {
  const root = path.join(__dirname, '..', '..');
  const problems = [];

  for (const [rel, budget] of Object.entries(BUDGETS)) {
    const abs = path.join(root, rel);
    let size;
    try { size = fs.statSync(abs).size; } catch (_) { continue; } // not present → skip
    if (size > budget) {
      problems.push(
        `${rel} is ${fmt(size)}, over its ${fmt(budget)} budget by ${fmt(size - budget)} ` +
        `— trim it, or raise the budget in check-perf-budget.js on purpose.`
      );
    }
  }

  let shellTotal = 0;
  let shellPresent = false;
  for (const rel of SHELL) {
    try { shellTotal += fs.statSync(path.join(root, rel)).size; shellPresent = true; } catch (_) { /* skip */ }
  }
  if (shellPresent && shellTotal > SHELL_BUDGET) {
    problems.push(
      `the PWA shell (${SHELL.join(' + ')}) is ${fmt(shellTotal)}, over its ${fmt(SHELL_BUDGET)} budget ` +
      `— this is what loads before a learner's home screen paints.`
    );
  }

  return problems;
};
