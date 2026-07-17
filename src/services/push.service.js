'use strict';

const webpush = require('web-push');
const { PushSubscription, Notification } = require('../models');
const { currentUserId, currentTenantId, runWithTenant } = require('../lib/context');
const logger = require('../lib/logger');

/**
 * Web Push channel (ADR-014). Registers with the notification service in Sprint 4.
 *
 * VAPID keys identify the sender. Generate once (npx web-push generate-vapid-keys)
 * and set VAPID_PUBLIC / VAPID_PRIVATE in .env. Without them, push is simply
 * unavailable — the learner UI degrades to "not configured" rather than crashing.
 */
const configured = !!(process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE);
if (configured) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@lintel.africa',
    process.env.VAPID_PUBLIC,
    process.env.VAPID_PRIVATE
  );
}

const publicKey = () => (configured ? process.env.VAPID_PUBLIC : null);

async function subscribe(sub, userAgent) {
  return PushSubscription.findOneAndUpdate(
    { userId: currentUserId(), endpoint: sub.endpoint },
    { keys: sub.keys, userAgent },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).exec();
}

/**
 * Send to every device a user has registered. A subscription that returns 404/410
 * is dead (the browser dropped it) and is pruned — otherwise dead endpoints
 * accumulate forever.
 */
async function sendToUser({ userId, title, body, url, tag }) {
  if (!configured) return { sent: 0, skipped: 'push not configured' };

  const subs = await PushSubscription.find({ userId }).exec();
  let sent = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify({ title, body, url, tag })
      );
      sent += 1;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await PushSubscription.deleteOne({ _id: sub._id }).exec();
      } else {
        logger.warn({ err: err.message, userId: String(userId) }, 'push send failed');
      }
    }
  }
  return { sent };
}

module.exports = { configured, publicKey, subscribe, sendToUser };
