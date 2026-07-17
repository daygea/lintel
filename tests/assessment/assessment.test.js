'use strict';

/**
 * Sprint 5a exit criteria. The assertions that matter:
 *   - a submission survives (assets recorded, attempts capped)
 *   - a grade is computed from the rubric levels chosen
 *   - MODERATION WRITES A NEW GRADE — both survive, each attributed
 *   - Grade.updateOne throws (append-only)
 *   - only the named moderator role may moderate
 *   - the assessment_score rule reads the final grade (ADR-008: evaluator untouched)
 */

const {
  Tenant, User, Membership, Course,
  Rubric, Assessment, Submission, AssessorAssignment, Grade,
} = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const svc = require('../../src/services/assessment.service');
const { evaluate } = require('../../src/services/eligibility/evaluator');
const { ImmutableRecordError } = require('../../src/lib/errors');

let tenant, learner, assessor, elder, rubric, assessment;

const asAssessor = (fn) => runWithTenant(tenant._id, assessor._id, fn);
const asElder = (fn) => runWithTenant(tenant._id, elder._id, fn);
const asLearner = (fn) => runWithTenant(tenant._id, learner._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'inst', name: 'Institute', locales: ['en'] });
  learner = await User.create({ email: 'l@x.com', name: 'Learner', passwordHash: 'x', status: 'active' });
  assessor = await User.create({ email: 'a@x.com', name: 'Assessor', passwordHash: 'x', status: 'active' });
  elder = await User.create({ email: 'e@x.com', name: 'Elder', passwordHash: 'x', status: 'active' });

  await runWithTenant(tenant._id, elder._id, async () => {
    await Membership.create({ userId: learner._id, roles: ['learner'], status: 'active' });
    await Membership.create({ userId: assessor._id, roles: ['assessor'], status: 'active' });
    await Membership.create({ userId: elder._id, roles: ['elder'], status: 'active' });

    rubric = await Rubric.create({
      title: { en: 'Recitation' },
      criteria: [
        { label: { en: 'Tonal accuracy' }, weight: 1, levels: [
          { label: { en: 'Emerging' }, points: 1 },
          { label: { en: 'Secure' }, points: 3 },
        ] },
      ],
    });

    assessment = await Assessment.create({
      title: { en: 'Oríkì recitation' },
      type: 'oral',
      submissionTypes: ['audio'],
      rubricId: rubric._id,
      requiresModeration: true,
      moderatorRole: 'elder',
      status: 'open',
      attemptsAllowed: 2,
    });
  });
});

describe('submission', () => {
  it('records a learner attempt and caps attempts', async () => {
    await asLearner(() => svc.submit({ assessmentId: assessment._id, userId: learner._id, assetIds: [] }));
    await asLearner(() => svc.submit({ assessmentId: assessment._id, userId: learner._id, assetIds: [] }));
    await expect(
      asLearner(() => svc.submit({ assessmentId: assessment._id, userId: learner._id, assetIds: [] }))
    ).rejects.toThrow(/No attempts remaining/);
  });
});

describe('grading and moderation', () => {
  async function submitAndAssign() {
    const submission = await asLearner(() => svc.submit({ assessmentId: assessment._id, userId: learner._id, assetIds: [] }));
    await asAssessor(() => svc.assignAssessor({ submissionId: submission._id, assessorUserId: assessor._id, role: 'primary' }));
    return submission;
  }

  it('records a provisional grade from the assigned assessor', async () => {
    const submission = await submitAndAssign();
    const crit = rubric.criteria[0];
    const g = await asAssessor(() => svc.grade({
      submissionId: submission._id,
      criterionScores: [{ criterionId: crit._id, levelId: crit.levels[1]._id, points: 3 }],
    }));
    expect(g.totalPoints).toBe(3);
    expect(g.isFinal).toBe(false);
  });

  it('moderation writes a NEW grade — both survive, each attributed', async () => {
    const submission = await submitAndAssign();
    const crit = rubric.criteria[0];

    const provisional = await asAssessor(() => svc.grade({
      submissionId: submission._id,
      criterionScores: [{ criterionId: crit._id, levelId: crit.levels[0]._id, points: 1 }],
    }));

    const moderated = await asElder(() => svc.moderate({
      gradeId: provisional._id,
      criterionScores: [{ criterionId: crit._id, levelId: crit.levels[1]._id, points: 3 }],
      feedback: { en: 'Reconsidered — the tone was in fact secure.' },
    }));

    const all = await asElder(() => Grade.find({ submissionId: submission._id }).sort({ createdAt: 1 }).exec());
    expect(all).toHaveLength(2);
    expect(all[0].totalPoints).toBe(1);                 // the junior mark, untouched
    expect(String(all[0].assessorUserId)).toBe(String(assessor._id));
    expect(all[1].totalPoints).toBe(3);                 // the elder's, final
    expect(String(all[1].assessorUserId)).toBe(String(elder._id));
    expect(all[1].isFinal).toBe(true);
    expect(String(all[1].moderatedFromGradeId)).toBe(String(provisional._id));

    const final = await asElder(() => svc.finalGrade(submission._id));
    expect(final.totalPoints).toBe(3);
  });

  it('a grade cannot be updated (append-only)', async () => {
    const submission = await submitAndAssign();
    const crit = rubric.criteria[0];
    const g = await asAssessor(() => svc.grade({
      submissionId: submission._id,
      criterionScores: [{ criterionId: crit._id, levelId: crit.levels[0]._id, points: 1 }],
    }));
    await expect(
      asAssessor(() => Grade.updateOne({ _id: g._id }, { totalPoints: 99 }).exec())
    ).rejects.toThrow(ImmutableRecordError);
  });

  it('only the named moderator role may moderate', async () => {
    const submission = await submitAndAssign();
    const crit = rubric.criteria[0];
    const provisional = await asAssessor(() => svc.grade({
      submissionId: submission._id,
      criterionScores: [{ criterionId: crit._id, levelId: crit.levels[0]._id, points: 1 }],
    }));
    // assessor is not an elder — moderation must be refused
    await expect(
      asAssessor(() => svc.moderate({ gradeId: provisional._id, criterionScores: [{ criterionId: crit._id, levelId: crit.levels[1]._id, points: 3 }] }))
    ).rejects.toThrow(/Only a elder may moderate/);
  });
});

describe('assessment_score rule (ADR-008)', () => {
  it('passes when the final grade meets the threshold', async () => {
    const submission = await asLearner(() => svc.submit({ assessmentId: assessment._id, userId: learner._id, assetIds: [] }));
    await asAssessor(() => svc.assignAssessor({ submissionId: submission._id, assessorUserId: assessor._id }));
    const crit = rubric.criteria[0];
    const prov = await asAssessor(() => svc.grade({ submissionId: submission._id, criterionScores: [{ criterionId: crit._id, levelId: crit.levels[1]._id, points: 3 }] }));
    await asElder(() => svc.moderate({ gradeId: prov._id, criterionScores: [{ criterionId: crit._id, levelId: crit.levels[1]._id, points: 3 }] }));

    const policy = {
      rules: [{ type: 'assessment_score', params: { assessmentId: assessment._id, minPercent: 50, maxScore: 3 } }],
      combinator: 'all',
      denialMessage: { en: 'held' },
    };
    const verdict = await asLearner(() => evaluate(policy, { userId: learner._id }));
    expect(verdict.allowed).toBe(true);
  });

  it('withholds when the score is below the threshold', async () => {
    const submission = await asLearner(() => svc.submit({ assessmentId: assessment._id, userId: learner._id, assetIds: [] }));
    await asAssessor(() => svc.assignAssessor({ submissionId: submission._id, assessorUserId: assessor._id }));
    const crit = rubric.criteria[0];
    const prov = await asAssessor(() => svc.grade({ submissionId: submission._id, criterionScores: [{ criterionId: crit._id, levelId: crit.levels[0]._id, points: 1 }] }));
    await asElder(() => svc.moderate({ gradeId: prov._id, criterionScores: [{ criterionId: crit._id, levelId: crit.levels[0]._id, points: 1 }] }));

    const policy = {
      rules: [{ type: 'assessment_score', params: { assessmentId: assessment._id, minPercent: 80, maxScore: 3 } }],
      combinator: 'all',
      denialMessage: { en: 'held' },
    };
    const verdict = await asLearner(() => evaluate(policy, { userId: learner._id }));
    expect(verdict.allowed).toBe(false);
  });
});
