'use strict';

/**
 * Reconcile online payments the webhook may have missed. Run every few minutes —
 * e.g. a Render Cron Job:
 *   node scripts/reconcile-payments.js
 * Needs the same env as the web service (MONGODB_URI, PAYSTACK_SECRET_KEY, …).
 *
 * The webhook is the primary confirmation; this is the safety net. For each active
 * tenant it re-verifies invoices that still carry a pending online reference older
 * than the grace window, and records any that actually succeeded — through the same
 * idempotent path, so it can never double-count alongside the webhook.
 *
 * With no PAYSTACK_SECRET_KEY the provider's verify() returns "not paid", so this
 * is a safe no-op in development.
 */

const mongoose = require('mongoose');
const env = require('../src/config/env');
const { Tenant } = require('../src/models');
const { runWithTenant } = require('../src/lib/context');
const commerce = require('../src/services/commerce');

const GRACE_MINUTES = Number(process.env.RECONCILE_GRACE_MINUTES || 10);

(async () => {
  await mongoose.connect(env.mongoUri);
  try {
    // Tenant is platform-scoped, so this query needs no tenant context.
    const tenants = await Tenant.find({ status: { $nin: ['closed', 'deleted'] } }).select('_id slug').exec();
    let checked = 0;
    let recovered = 0;
    for (const t of tenants) {
      const r = await runWithTenant(t._id, null, () =>
        commerce.reconcilePendingPayments({ olderThanMinutes: GRACE_MINUTES })
      );
      checked += r.checked;
      recovered += r.recovered;
      if (r.recovered) console.log(`reconcile: ${t.slug} recovered ${r.recovered}/${r.checked}`);
    }
    console.log(`reconcile: ${tenants.length} tenants, ${checked} pending checked, ${recovered} recovered`);
  } finally {
    await mongoose.disconnect();
  }
})().catch((err) => {
  console.error('reconcile failed:', err);
  process.exit(1);
});
