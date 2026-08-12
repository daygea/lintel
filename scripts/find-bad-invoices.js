'use strict';

/**
 * Find invoices whose money fields are malformed — a missing amount, an
 * unsupported/absent currency, or an amountPaid in a different currency than
 * amountDue. These are the rows that used to 500 the fees page before myInvoices
 * was hardened. Read-only: it reports, it does not change anything.
 *
 *   node scripts/find-bad-invoices.js
 *
 * Uses the raw collection so it scans every tenant at once (bypasses tenant scoping).
 */

require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../src/config/env');
const { SUPPORTED } = require('../src/lib/money');

const valid = new Set(SUPPORTED);
const badMoney = (m) => !m || !valid.has(m.currency) || !Number.isFinite(m.amount);

(async () => {
  await mongoose.connect(env.mongoUri);
  try {
    const rows = await mongoose.connection.collection('invoices').find({}).toArray();
    const problems = [];
    for (const inv of rows) {
      const issues = [];
      if (badMoney(inv.amountDue)) issues.push('amountDue');
      if (badMoney(inv.amountPaid)) issues.push('amountPaid');
      if (inv.amountDue && inv.amountPaid && inv.amountDue.currency !== inv.amountPaid.currency) {
        issues.push(`currency mismatch (${inv.amountDue.currency} due vs ${inv.amountPaid.currency} paid)`);
      }
      if (issues.length) {
        problems.push({ id: String(inv._id), tenantId: String(inv.tenantId), state: inv.state, issues });
      }
    }
    console.log(`Scanned ${rows.length} invoice(s).`);
    if (!problems.length) {
      console.log('No malformed invoices found.');
    } else {
      console.log(`${problems.length} malformed invoice(s):`);
      for (const p of problems) {
        console.log(` - ${p.id} | tenant ${p.tenantId} | state ${p.state} | ${p.issues.join('; ')}`);
      }
    }
  } finally {
    await mongoose.disconnect();
  }
})().catch((err) => {
  console.error('find-bad-invoices failed:', err);
  process.exit(1);
});
