'use strict';

const crypto = require('node:crypto');
const { User } = require('../../models');
const deadlines = require('../../services/deadlines.service');

const h = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

/**
 * The learner's private calendar feed (ICS). Authenticated by the token in the URL,
 * not a session — calendar apps subscribe by URL and send no cookie. It runs on the
 * institution's own subdomain, so the tenant context (and thus the events) is the
 * one the learner belongs to here; a token used on the wrong host simply finds no
 * enrolments and returns an empty calendar.
 */
exports.ics = h(async (req, res) => {
  if (!req.tenant) return res.status(404).type('text/plain').send('Not found');
  const token = String(req.params.token || '').replace(/\.ics$/i, '');
  if (!token) return res.status(404).type('text/plain').send('Not found');

  const user = await User.findOne({ calendarToken: token }).select('+calendarToken').exec();
  if (!user) return res.status(404).type('text/plain').send('Not found');

  const items = await deadlines.upcomingFor({ userId: user._id, locale: req.tenant.defaultLocale || 'en' });
  const ics = deadlines.toICS(items, { calendarName: `${req.tenant.name || 'Lintel'} — my schedule` });

  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'inline; filename="lintel.ics"');
  res.set('Cache-Control', 'private, max-age=300');
  return res.send(ics);
});

/**
 * Ensure the signed-in learner has a calendar token and return the subscribe URL.
 * Generating a fresh token on demand means the feed stays off until the learner
 * asks for it; it is never exposed in an ordinary user read.
 */
exports.ensureToken = h(async (req, res) => {
  const existing = await User.findById(req.user._id).select('+calendarToken').exec();
  let token = existing && existing.calendarToken;
  if (!token) {
    token = crypto.randomBytes(24).toString('base64url');
    await User.updateOne({ _id: req.user._id }, { calendarToken: token }).exec();
  }
  const host = req.get('host');
  const proto = host && host.includes('localhost') ? 'http' : 'https';
  return res.json({ url: `${proto}://${host}/calendar/${token}.ics` });
});
