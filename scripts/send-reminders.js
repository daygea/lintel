'use strict';

/**
 * Deadline reminders. Run on a schedule — e.g. hourly as a Render Cron Job:
 *   node scripts/send-reminders.js
 * Needs the same env as the web service (MONGODB_URI, notification channel keys).
 *
 * For every active tenant, it finds each learner's dated items falling inside the
 * next window (default 24h) and sends one reminder per item across push + email.
 * A ReminderLog row per (learner, item) makes it idempotent — run it as often as
 * you like; each deadline nudges once. With no notification channel configured the
 * send falls back to the dev log transport, so it is safe to run anywhere.
 */

const mongoose = require('mongoose');
const env = require('../src/config/env');
const { rootDomain } = require('../src/config/env');
const { Tenant, Enrollment, ReminderLog } = require('../src/models');
const { runWithTenant } = require('../src/lib/context');
const deadlines = require('../src/services/deadlines.service');
const { notify } = require('../src/services/notification');

const WINDOW_HOURS = Number(process.env.REMINDER_WINDOW_HOURS || 24);

function formatWhen(at) {
  const d = new Date(at);
  return d.toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

const RETENTION_DAYS = Number(process.env.REMINDER_RETENTION_DAYS || 60);

async function remindTenant(tenant) {
  const now = new Date();
  const until = new Date(now.getTime() + WINDOW_HOURS * 3600 * 1000);
  const locale = tenant.defaultLocale || 'en';
  const appUrl = `https://${tenant.slug}.${rootDomain}/app/`;

  // Prune the dedup ledger past its retention window (replaces a TTL index).
  await ReminderLog.deleteMany({ createdAt: { $lt: new Date(now.getTime() - RETENTION_DAYS * 86400000) } }).exec();

  const userIds = await Enrollment.find({ status: 'active' }).distinct('userId');
  let sent = 0;

  for (const userId of userIds) {
    const items = await deadlines.upcomingFor({ userId, locale, from: now, to: until });
    for (const it of items) {
      // Claim the reminder first; a duplicate key means another run already sent it.
      try {
        await ReminderLog.create({ userId, kind: it.kind, itemId: it.id, at: it.at });
      } catch (err) {
        if (err && err.code === 11000) continue; // already reminded
        throw err;
      }
      await notify({
        userId,
        template: 'deadline.reminder',
        locale,
        channels: ['webpush', 'email'],
        data: { title: it.title, context: it.context, when: formatWhen(it.at), url: appUrl },
      });
      sent += 1;
    }
  }
  return sent;
}

(async () => {
  await mongoose.connect(env.mongoUri);
  try {
    const tenants = await Tenant.find({ status: { $in: ['active', 'trial'] } }).select('_id slug defaultLocale').exec();
    let total = 0;
    for (const t of tenants) {
      const n = await runWithTenant(t._id, null, () => remindTenant(t));
      if (n) console.log(`reminders: ${t.slug} sent ${n}`);
      total += n;
    }
    console.log(`reminders: ${tenants.length} tenants, ${total} reminders sent`);
  } finally {
    await mongoose.disconnect();
  }
})().catch((err) => {
  console.error('send-reminders failed:', err);
  process.exit(1);
});
