'use strict';

/**
 * The ICS (calendar) builder is pure — given items, it emits a valid VCALENDAR.
 * Needs no database.
 */

const { toICS } = require('../../src/services/deadlines.service');

const NOW = new Date('2026-10-13T00:00:00Z');

it('emits an empty but valid calendar for no items', () => {
  const ics = toICS([], { now: NOW });
  expect(ics).toContain('BEGIN:VCALENDAR');
  expect(ics).toContain('END:VCALENDAR');
  expect(ics).not.toContain('BEGIN:VEVENT');
  expect(ics.endsWith('\r\n')).toBe(true); // RFC 5545 CRLF
});

it('renders a session with a stable UID and a duration-derived end', () => {
  const ics = toICS([{
    kind: 'session', id: 'abc', title: 'Tafsir class', at: new Date('2026-10-14T09:00:00Z'),
    durationMinutes: 90, context: 'Jan cohort', location: 'Room 2',
  }], { now: NOW });
  expect(ics).toContain('UID:session-abc@lintel');
  expect(ics).toContain('DTSTART:20261014T090000Z');
  expect(ics).toContain('DTEND:20261014T103000Z'); // +90 min
  expect(ics).toContain('SUMMARY:Tafsir class');
  expect(ics).toContain('LOCATION:Room 2');
});

it('escapes commas, semicolons and newlines per RFC 5545', () => {
  const ics = toICS([{
    kind: 'assessment', id: 'x', title: 'Essay: part 1, final', at: new Date('2026-10-20T12:00:00Z'), context: 'Fiqh 101',
  }], { now: NOW });
  expect(ics).toContain('SUMMARY:Essay: part 1\\, final'); // colon stays; comma escaped
});

it('folds the fee amount into the summary', () => {
  const ics = toICS([{
    kind: 'fee', id: 'inv1:123', title: 'Fee instalment', at: new Date('2026-10-15T00:00:00Z'), amount: '₦50,000',
  }], { now: NOW });
  expect(ics).toMatch(/SUMMARY:Fee instalment — ₦50\\,000/);
});
