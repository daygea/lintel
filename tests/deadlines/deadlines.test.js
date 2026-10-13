'use strict';

/**
 * A learner's upcoming deadlines aggregate sessions, unpaid fee instalments and
 * assessment due dates — sorted by date, tenant-scoped — and reminders go out once
 * per item (ReminderLog unique index).
 */

const { Tenant, User, Course, Cohort, Enrollment, Session, Assessment, Invoice, ReminderLog } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const deadlines = require('../../src/services/deadlines.service');

let tenant, user;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);
const NGN = (n) => ({ amount: n, currency: 'NGN' });
const inDays = (n) => new Date(Date.now() + n * 86400000);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'deadlines', name: 'DL', locales: ['en'], defaultLocale: 'en' });
  user = await User.create({ email: 'l@x.io', name: 'L', passwordHash: 'x', status: 'active' });
});

async function enrolledCourse() {
  return as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'Course one' } });
    const cohort = await Cohort.create({ courseId: course._id, title: { en: 'Jan cohort' }, session: '2026/2027', status: 'open' });
    await Enrollment.create({ userId: user._id, cohortId: cohort._id, courseId: course._id, status: 'active' });
    return { course, cohort };
  });
}

it('aggregates sessions, fees and assessments, sorted by date', async () => {
  const { course, cohort } = await enrolledCourse();
  await as(() => Session.create({ cohortId: cohort._id, title: { en: 'Live class' }, startsAt: inDays(3), status: 'scheduled' }));
  await as(() => Assessment.create({ courseId: course._id, title: { en: 'Essay 1' }, dueAt: inDays(5) }));
  await as(() => Invoice.create({
    enrollmentId: new (require('mongoose').Types.ObjectId)(), userId: user._id,
    amountDue: NGN(100000), amountPaid: NGN(0), state: 'part',
    dueDates: [{ amount: NGN(50000), dueAt: inDays(2) }],
  }));

  const items = await as(() => deadlines.upcomingFor({ userId: user._id }));
  expect(items.map((i) => i.kind)).toEqual(['fee', 'session', 'assessment']); // 2d, 3d, 5d
  expect(items[1].title).toBe('Live class');
  expect(items[1].context).toBe('Jan cohort');
});

it('ignores a settled invoice and a cancelled session', async () => {
  const { course, cohort } = await enrolledCourse();
  await as(() => Session.create({ cohortId: cohort._id, title: { en: 'Cancelled' }, startsAt: inDays(1), status: 'cancelled' }));
  await as(() => Invoice.create({
    enrollmentId: new (require('mongoose').Types.ObjectId)(), userId: user._id,
    amountDue: NGN(100000), amountPaid: NGN(100000), state: 'full',
    dueDates: [{ amount: NGN(100000), dueAt: inDays(2) }],
  }));
  const items = await as(() => deadlines.upcomingFor({ userId: user._id }));
  expect(items).toHaveLength(0);
});

it('reminds once per item (ReminderLog unique)', async () => {
  await as(() => ReminderLog.create({ userId: user._id, kind: 'session', itemId: 's1', at: inDays(1) }));
  await expect(as(() => ReminderLog.create({ userId: user._id, kind: 'session', itemId: 's1', at: inDays(1) })))
    .rejects.toMatchObject({ code: 11000 });
});
