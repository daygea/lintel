'use strict';

/**
 * The learner "why is this held / what unlocks it" panel. explain() turns a held
 * verdict into a plain checklist of requirements with friendly labels and a met flag.
 */

const { Tenant, User, AttestationType } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const curriculum = require('../../src/services/curriculum.service');
const eligibility = require('../../src/services/eligibility.service');

let tenant, user, lesson;
const as = (fn) => runWithTenant(tenant._id, user._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'explain', name: 'E', locales: ['en'], defaultLocale: 'en', status: 'active' });
  user = await User.create({ email: 'l@x.io', name: 'L', passwordHash: 'x', status: 'active' });
  await as(async () => {
    const course = await curriculum.createCourse({ code: 'C1', title: { en: 'Course' } });
    const mod = await curriculum.createModule({ courseId: course._id, title: { en: 'M' } });
    lesson = await curriculum.createLesson({ moduleId: mod._id, title: { en: 'Lesson one' } });
  });
});

it('explains a multi-rule policy with friendly labels and a fees link', async () => {
  await as(async () => {
    await AttestationType.create({ slug: 'initiated', label: { en: 'Initiated member' } });
    const policy = await eligibility.upsertPolicy({
      slug: 'held',
      label: { en: 'Held' },
      denialMessage: { en: 'This teaching is held until you are received.' },
      combinator: 'all',
      rules: [
        { type: 'attestation', params: { typeSlug: 'initiated' } },
        { type: 'payment_state', params: { atLeast: 'full' } },
      ],
    });
    await curriculum.setLessonPolicy(lesson._id, policy._id);

    const fresh = await curriculum.getLesson(lesson._id);
    const panel = await eligibility.explain({ lesson: fresh, userId: user._id });

    expect(panel.held).toBe(true);
    expect(panel.combinator).toBe('all');
    expect(panel.message).toMatch(/held until you are received/);
    expect(panel.requirements).toHaveLength(2);

    const attest = panel.requirements.find((r) => r.type === 'attestation');
    expect(attest.met).toBe(false);
    expect(attest.title).toContain('Initiated member'); // slug resolved to the type's label

    const pay = panel.requirements.find((r) => r.type === 'payment_state');
    expect(pay.href).toBe('/my/fees');
  });
});

it('falls back to the implicit "be enrolled" requirement when no policy governs the lesson', async () => {
  await as(async () => {
    const fresh = await curriculum.getLesson(lesson._id);
    const panel = await eligibility.explain({ lesson: fresh, userId: user._id });
    expect(panel.held).toBe(true); // not enrolled → held by the baseline
    expect(panel.requirements).toHaveLength(1);
    expect(panel.requirements[0].type).toBe('enrolled');
    expect(panel.requirements[0].met).toBe(false);
  });
});
