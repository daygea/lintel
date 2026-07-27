'use strict';

/**
 * Eligibility authoring: creating a policy and attaching it to a lesson — the UI
 * path that turns a lesson from open to held. The engine itself is tested
 * elsewhere; this proves the authoring wiring reaches it.
 */

const { Course, Module, Lesson, EligibilityPolicy } = require('../../src/models');
const curriculum = require('../../src/services/curriculum.service');
const eligibility = require('../../src/services/eligibility.service');
const { runWithTenant } = require('../../src/lib/context');
const { Tenant } = require('../../src/models');

describe('eligibility authoring', () => {
  let tenantId, lesson;
  beforeEach(async () => {
    const t = await Tenant.create({ slug: 'test-elig', name: 'T', locales: ['en'], status: 'active' });
    tenantId = t._id;
    await runWithTenant(tenantId, null, async () => {
      const course = await curriculum.createCourse({ code: 'C1', title: { en: 'Course' } });
      const mod = await curriculum.createModule({ courseId: course._id, title: { en: 'M' } });
      lesson = await curriculum.createLesson({ moduleId: mod._id, title: { en: 'L' } });
    });
  });

  it('creates a policy and attaches it, making the lesson held', async () => {
    await runWithTenant(tenantId, null, async () => {
      const policy = await eligibility.upsertPolicy({
        slug: 'initiated-only',
        label: { en: 'Initiated only' },
        denialMessage: { en: 'This teaching is held until you have been received.' },
        combinator: 'all',
        rules: [{ type: 'attestation', params: { typeSlug: 'initiated' } }],
      });
      expect(policy._id).toBeTruthy();

      // lesson starts open
      let fresh = await curriculum.getLesson(lesson._id);
      expect(fresh.eligibilityPolicyId).toBeUndefined();

      // attach -> held
      await curriculum.setLessonPolicy(lesson._id, policy._id);
      fresh = await curriculum.getLesson(lesson._id);
      expect(String(fresh.eligibilityPolicyId)).toBe(String(policy._id));

      // clear -> open again
      await curriculum.setLessonPolicy(lesson._id, '');
      fresh = await curriculum.getLesson(lesson._id);
      expect(fresh.eligibilityPolicyId).toBeUndefined();
    });
  });
});
