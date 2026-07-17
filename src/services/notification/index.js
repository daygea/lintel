'use strict';

const { Notification, User } = require('../../models');
const { EmailChannel } = require('./channels/email');
const { SmsChannel } = require('./channels/sms');
const { WhatsAppChannel } = require('./channels/whatsapp');
const { pick } = require('../../plugins/locale-map');
const { currentTenantId } = require('../../lib/context');
const logger = require('../../lib/logger');

/**
 * The notification service. One entry point — notify() — chooses channels,
 * renders the tenant's locale-mapped template, records every attempt, and never
 * lets one channel's failure stop another.
 *
 * Web Push registers here in Sprint 4. WhatsApp is present but stubbed.
 */
const push = require('../push.service');

/** A thin adapter wrapping the push service so notify() can target 'webpush'. */
const webpushChannel = {
  key: 'webpush',
  isConfigured: () => push.configured,
  async send({ data, subject, text, userId }) {
    const out = await push.sendToUser({ userId, title: subject, body: text, url: data?.url });
    return { providerRef: `push-${out.sent}`, skipped: out.sent === 0 ? 'no devices' : undefined };
  },
};

const CHANNELS = {
  email: new EmailChannel(),
  sms: new SmsChannel(),
  webpush: webpushChannel,
  whatsapp: new WhatsAppChannel(),
};

/**
 * Templates are defined per-tenant in a real deployment. For Sprint 2 they are
 * built-in, locale-mapped, and deliberately plain. The tenant's own words replace
 * these once the authoring UI for templates lands.
 */
const TEMPLATES = {
  'application.decided': {
    subject: { en: 'Your application' },
    text: {
      en: (d) =>
        d.status === 'admitted'
          ? `You have been admitted to ${d.cohortTitle}. Welcome.`
          : `Thank you for applying to ${d.cohortTitle}. On this occasion you were not admitted.`,
    },
  },
  'session.reminder': {
    subject: { en: 'A session is coming up' },
    text: {
      en: (d) => `${d.sessionTitle} begins ${d.when}. ${d.joinUrl ? 'Join: ' + d.joinUrl : ''}`.trim(),
    },
  },
  'enrollment.activated': {
    subject: { en: 'You are enrolled' },
    text: { en: (d) => `You are now enrolled in ${d.cohortTitle}.` },
  },
};

/**
 * Send a templated notification across the given channels.
 * Records one Notification per channel. A failure in one is logged and does not
 * stop the others.
 */
async function notify({ userId, template, data = {}, channels = ['email'], locale = 'en' }) {
  const tmpl = TEMPLATES[template];
  if (!tmpl) throw new Error(`Unknown notification template: ${template}`);

  const user = await User.findById(userId).exec();
  if (!user) throw new Error('No such user');

  const subject = pick(tmpl.subject, locale) || pick(tmpl.subject, 'en');
  const textFn = tmpl.text[locale] || tmpl.text.en;
  const text = typeof textFn === 'function' ? textFn(data) : textFn;

  const results = [];

  for (const channelKey of channels) {
    const channel = CHANNELS[channelKey];
    const record = await Notification.create({
      userId,
      channel: channelKey,
      template,
      payload: data,
      status: 'queued',
    });

    if (!channel) {
      await mark(record, 'failed', { error: `Unknown channel ${channelKey}` });
      continue;
    }

    const to = channelKey === 'email' ? user.email : user.phone;
    if (!to) {
      await mark(record, 'skipped', { error: `No ${channelKey} address on file` });
      results.push({ channel: channelKey, status: 'skipped' });
      continue;
    }

    try {
      const out = await channel.send({ to, subject, text, data, userId });
      await mark(record, out.skipped ? 'skipped' : 'sent', {
        to,
        providerRef: out.providerRef,
        error: out.skipped,
      });
      results.push({ channel: channelKey, status: out.skipped ? 'skipped' : 'sent' });
    } catch (err) {
      await mark(record, 'failed', { to, error: err.message });
      logger.warn({ channel: channelKey, template, err: err.message }, 'notification failed');
      results.push({ channel: channelKey, status: 'failed', error: err.message });
    }
  }

  return results;
}

const mark = (record, status, fields = {}) =>
  Notification.updateOne(
    { _id: record._id },
    { status, sentAt: status === 'sent' ? new Date() : undefined, ...fields }
  ).exec();

const history = (filter = {}) =>
  Notification.find(filter).sort({ createdAt: -1 }).limit(100).exec();

module.exports = { notify, history, CHANNELS, TEMPLATES };
