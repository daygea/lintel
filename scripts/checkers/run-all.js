#!/usr/bin/env node
'use strict';

const CHECKERS = [
  ['tenant-guard', require('./check-tenant-guard')],
  ['tenant-indexes', require('./check-tenant-indexes')],
  ['sparse-compound', require('./check-sparse-compound')],
  ['append-only', require('./check-append-only')],
  ['no-tenant-terms', require('./check-no-tenant-terms')],
  ['money', require('./check-money')],
  ['locale-fields', require('./check-locale-fields')],
  ['api-parity', require('./check-api-parity')],
  ['route-handlers', require('./check-route-handlers')],
  ['ejs-syntax', require('./check-ejs-syntax')],
  ['a11y', require('./check-a11y')],
  ['csrf-forms', require('./check-csrf-forms')],
  ['view-fragility', require('./check-view-fragility')],
  ['boot', require('./check-boot')],
];

let failed = 0;
for (const [name, run] of CHECKERS) {
  let problems = [];
  try {
    problems = run() || [];
  } catch (err) {
    problems = [`checker crashed: ${err.message}`];
  }
  if (problems.length) {
    failed += problems.length;
    console.error(`\n  FAIL  ${name}`);
    for (const p of problems) console.error(`        ${p}`);
  } else {
    console.log(`  ok    ${name}`);
  }
}

if (failed) {
  console.error(`\n${failed} problem(s). These are invariants, not style preferences.\n`);
  process.exit(1);
}
console.log('\nAll checkers green.\n');
