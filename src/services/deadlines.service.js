'use strict';

/**
 * A learner's upcoming dated items, drawn from the three sources that carry dates:
 * cohort sessions (live classes), unpaid fee instalments, and assessment due dates.
 * One shape for all of them, so the schedule view, the "due soon" strip, the
 * calendar (ICS) feed and the reminder sweep all read the same list.
 *
 * Runs inside a tenant context; everything it reads is tenant-scoped.
 */

const { Enrollment, Session, Cohort, Course, Assessment, Invoice } = require('../models');
const { pick } = require('../plugins/locale-map');
const money = require('../lib/money');

/**
 * @returns {Promise<Array<{kind, id, title, at, context, amount?, location?}>>}
 *   sorted by `at` ascending. `kind` ∈ 'session' | 'fee' | 'assessment'.
 */
async function upcomingFor({ userId, locale = 'en', from = new Date(), to = null } = {}) {
  const until = to || new Date(Date.now() + 120 * 24 * 3600 * 1000); // default horizon: 120 days

  const enrolments = await Enrollment.find({ userId, status: 'active' }).exec();
  if (!enrolments.length) return [];
  const cohortIds = enrolments.map((e) => e.cohortId).filter(Boolean);
  const courseIds = enrolments.map((e) => e.courseId).filter(Boolean);

  // Titles for context, fetched once.
  const [cohorts, courses] = await Promise.all([
    Cohort.find({ _id: { $in: cohortIds } }).exec(),
    courseIds.length ? Course.find({ _id: { $in: courseIds } }).exec() : [],
  ]);
  const cohortTitle = new Map(cohorts.map((c) => [String(c._id), pick(c.title, locale)]));
  const courseTitle = new Map(courses.map((c) => [String(c._id), pick(c.title, locale)]));

  const items = [];

  // 1. Sessions — scheduled or live, in the window.
  if (cohortIds.length) {
    const sessions = await Session.find({
      cohortId: { $in: cohortIds },
      status: { $in: ['scheduled', 'live'] },
      startsAt: { $gte: from, $lte: until },
    }).exec();
    for (const s of sessions) {
      items.push({
        kind: 'session',
        id: String(s._id),
        title: pick(s.title, locale),
        at: s.startsAt,
        durationMinutes: s.durationMinutes || 60,
        context: cohortTitle.get(String(s.cohortId)) || '',
        location: s.location || '',
      });
    }
  }

  // 2. Fee instalments — unsettled invoices with scheduled due dates. Overdue ones
  //    are included (from the start of time) so a learner sees what is already late.
  const invoices = await Invoice.find({
    userId,
    state: { $nin: ['full', 'waived'] },
  }).exec();
  for (const inv of invoices) {
    for (const d of inv.dueDates || []) {
      if (!d.dueAt || d.dueAt > until) continue;
      items.push({
        kind: 'fee',
        id: `${inv._id}:${new Date(d.dueAt).getTime()}`,
        title: 'Fee instalment',
        at: d.dueAt,
        amount: d.amount ? money.format(d.amount) : null,
        context: 'Payment due',
      });
    }
  }

  // 3. Assessment due dates — for the learner's enrolled courses, in the window.
  if (courseIds.length) {
    const assessments = await Assessment.find({
      courseId: { $in: courseIds },
      dueAt: { $gte: from, $lte: until },
    }).exec();
    for (const a of assessments) {
      items.push({
        kind: 'assessment',
        id: String(a._id),
        title: pick(a.title, locale),
        at: a.dueAt,
        context: courseTitle.get(String(a.courseId)) || 'Assessment',
      });
    }
  }

  items.sort((x, y) => new Date(x.at) - new Date(y.at));
  return items;
}

/* ------------------------------------------------------------------------ ICS */

const pad = (n) => String(n).padStart(2, '0');
/** A UTC timestamp in iCalendar basic format: 20261013T090000Z. */
function icsStamp(date) {
  const d = new Date(date);
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}
/** Escape per RFC 5545: backslash, comma, semicolon, and newlines. */
function icsEscape(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Build a VCALENDAR from upcoming items. Sessions get an end time from their
 * duration; dated-only items (fees, assessments) are 30-minute markers at the due
 * instant. UIDs are stable, so re-subscribing updates events instead of duplicating.
 */
function toICS(items, { calendarName = 'Lintel', now = new Date() } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lintel//Learner calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(calendarName)}`,
  ];
  for (const it of items) {
    const start = new Date(it.at);
    const mins = it.kind === 'session' ? it.durationMinutes || 60 : 30;
    const end = new Date(start.getTime() + mins * 60000);
    const summary =
      it.kind === 'fee' ? `${it.title}${it.amount ? ' — ' + it.amount : ''}` : it.title;
    const desc = [it.context, it.location].filter(Boolean).join(' · ');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${it.kind}-${it.id}@lintel`,
      `DTSTAMP:${icsStamp(now)}`,
      `DTSTART:${icsStamp(start)}`,
      `DTEND:${icsStamp(end)}`,
      `SUMMARY:${icsEscape(summary)}`
    );
    if (desc) lines.push(`DESCRIPTION:${icsEscape(desc)}`);
    if (it.location) lines.push(`LOCATION:${icsEscape(it.location)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  // RFC 5545 wants CRLF line endings.
  return lines.join('\r\n') + '\r\n';
}

module.exports = { upcomingFor, toICS };
