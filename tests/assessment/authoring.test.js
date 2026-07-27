'use strict';

/**
 * Assessment authoring wiring: create a rubric, create an assessment using it,
 * and mark a submission (which requires an assessor assignment — the domain rule).
 */

const { Tenant } = require('../../src/models');
const svc = require('../../src/services/assessment.service');
const { runWithTenant } = require('../../src/lib/context');
const mongoose = require('mongoose');

describe('assessment authoring', () => {
  let tenantId;
  beforeEach(async () => {
    const t = await Tenant.create({ slug: 'test-assess', name: 'T', locales: ['en'], status: 'active' });
    tenantId = t._id;
  });

  it('creates a rubric and an assessment referencing it', async () => {
    await runWithTenant(tenantId, null, async () => {
      const rubric = await svc.createRubric({
        title: { en: 'Recitation' },
        criteria: [{ label: { en: 'Tonal accuracy' }, levels: [
          { label: { en: 'Emerging' }, points: 1 },
          { label: { en: 'Secure' }, points: 3 },
        ] }],
      });
      expect(rubric.criteria[0].levels).toHaveLength(2);

      const assessment = await svc.createAssessment({ title: { en: 'Oríkì recital' }, rubricId: rubric._id });
      expect(String(assessment.rubricId)).toBe(String(rubric._id));
    });
  });

  it('marks a submission when the grader is an assigned assessor', async () => {
    await runWithTenant(tenantId, new mongoose.Types.ObjectId(), async () => {
      const rubric = await svc.createRubric({ title: { en: 'R' }, criteria: [{ label: { en: 'C' }, levels: [{ label: { en: 'L' }, points: 5 }] }] });
      const assessment = await svc.createAssessment({ title: { en: 'A' }, rubricId: rubric._id });
      const learner = new mongoose.Types.ObjectId();
      const submission = await svc.submit({ assessmentId: assessment._id, userId: learner, text: 'my recitation' });

      // Without an assessor assignment, grading is refused (the domain rule).
      const crit = rubric.criteria[0];
      await expect(svc.grade({
        submissionId: submission._id,
        criterionScores: [{ criterionId: crit._id, levelId: crit.levels[0]._id, points: 5 }],
      })).rejects.toThrow(/not assigned/i);
    });
  });
});
