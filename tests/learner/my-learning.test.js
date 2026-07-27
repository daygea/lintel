'use strict';

/**
 * The learner home (myLearning).
 *   - lists the learner's actively-enrolled courses, lessons grouped by module
 *   - marks each lesson open or held via the engine
 *   - is a PREVIEW: browsing writes NO AccessLog (only opening a lesson does)
 */

const {
  Tenant, User, Membership, Course, Module, Lesson,
  Enrollment, Cohort, EligibilityPolicy, AccessLog,
} = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const { pick } = require('../../src/plugins/locale-map');
const learner = require('../../src/services/learner.service');

let tenant, user;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-mylearning', name: 'Alpha', locales: ['en'], status: 'active' });
  user = await User.create({ email: 'l@x.io', name: 'Ada', passwordHash: await User.hashPassword('x'.repeat(12)) });
  await runWithTenant(tenant._id, user._id, async () => {
    await Membership.create({ userId: user._id, roles: ['learner'], status: 'active' });
  });
});

async function seedCourse() {
  return as(async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'Foundations' }, status: 'active' });
    const mod = await Module.create({ courseId: course._id, title: { en: 'Module One' }, order: 0 });
    // An open lesson (no policy) and a held one (a policy requiring a standing the learner lacks).
    const held = await EligibilityPolicy.create({
      slug: 'needs-standing', label: { en: 'Needs standing' },
      combinator: 'all',
      rules: [{ type: 'attestation', params: { typeSlug: 'itefa-standing' } }],
      denialMessage: { en: 'This teaching opens once your standing is attested.' },
    });
    const openLesson = await Lesson.create({ moduleId: mod._id, courseId: course._id, title: { en: 'Open lesson' }, order: 0 });
    const heldLesson = await Lesson.create({ moduleId: mod._id, courseId: course._id, title: { en: 'Held lesson' }, order: 1, eligibilityPolicyId: held._id });
    const cohort = await Cohort.create({ courseId: course._id, title: { en: 'Intake A' }, session: '2026/2027' });
    await Enrollment.create({ userId: user._id, courseId: course._id, cohortId: cohort._id, status: 'active' });
    return { course, openLesson, heldLesson };
  });
}

it('assembles enrolled courses with open/held lessons grouped by module', async () => {
  await seedCourse();
  const out = await as(() => learner.myLearning({ userId: user._id, locale: 'en' }));

  expect(out.courses).toHaveLength(1);
  const c = out.courses[0];
  expect(c.code).toBe('C1');
  expect(c.lessonCount).toBe(2);
  expect(c.openCount).toBe(1);
  expect(c.modules).toHaveLength(1);

  const lessons = c.modules[0].lessons;
  const open = lessons.find((l) => pick(l.title, 'en') === 'Open lesson');
  const held = lessons.find((l) => pick(l.title, 'en') === 'Held lesson');
  expect(open.held).toBe(false);
  expect(held.held).toBe(true);
  expect(held.message).toMatch(/standing/i);
});

it('is a no-log preview — browsing the home writes no AccessLog', async () => {
  await seedCourse();
  await as(() => learner.myLearning({ userId: user._id, locale: 'en' }));
  const logs = await as(() => AccessLog.find({}).exec());
  expect(logs).toHaveLength(0);
});

it('shows nothing for a learner with no active enrolment', async () => {
  const out = await as(() => learner.myLearning({ userId: user._id, locale: 'en' }));
  expect(out.courses).toHaveLength(0);
});
