'use strict';

/**
 * THE KEYSTONE SUITE. Sprint 3 is not done until every line here is green.
 *
 * This is the sequence the whole product exists to make true:
 *
 *   1. a lesson gated on a standing is WITHHELD from a learner who lacks it
 *   2. an assessor ISSUES the standing → the lesson becomes visible NEXT request
 *   3. the standing is REVOKED → the lesson is withheld again NEXT request
 *   4. all three evaluations appear in the append-only access log
 *
 * If any of these fails, it is not a failing test. It is an elder's recording
 * shown to someone who was not meant to see it. Treat a red line here as an
 * incident, not a bug.
 *
 * Everything below uses SYNTHETIC standings — 'threshold-standing', not any real
 * tradition's term. That is invariant 1 working: the engine has no idea what the
 * standing means, and neither does this test.
 */

const {
  Tenant, User, Membership,
  Course, Module, Lesson,
  Enrollment, Cohort,
  AttestationType, Attestation,
  EligibilityPolicy, AccessLog,
} = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const att = require('../../src/services/attestation.service');
const elig = require('../../src/services/eligibility.service');
const { ImmutableRecordError } = require('../../src/lib/errors');

let tenant, elder, learner, lesson;

const asElder = (fn) => runWithTenant(tenant._id, elder._id, fn);
const asLearner = (fn) => runWithTenant(tenant._id, learner._id, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'inst', name: 'Institute', locales: ['en'] });
  elder = await User.create({ email: 'elder@x.com', name: 'Elder', passwordHash: 'x', status: 'active' });
  learner = await User.create({ email: 'learner@x.com', name: 'Learner', passwordHash: 'x', status: 'active' });

  await asElder(async () => {
    await Membership.create({ userId: elder._id, roles: ['assessor'], status: 'active' });
    await Membership.create({ userId: learner._id, roles: ['learner'], status: 'active' });

    // A standing only an assessor may grant.
    await AttestationType.create({
      slug: 'threshold-standing',
      label: { en: 'Threshold standing' },
      requiresIssuerRole: 'assessor',
    });

    // The policy: enrolled AND holds the standing.
    const policy = await EligibilityPolicy.create({
      slug: 'threshold-tier',
      label: { en: 'Threshold tier' },
      combinator: 'all',
      rules: [
        { type: 'enrolled' },
        { type: 'attestation', params: { typeSlug: 'threshold-standing' } },
      ],
      denialMessage: { en: 'This teaching is held until your standing has been attested.' },
    });

    // A course with a gated lesson, and the learner enrolled.
    const course = await Course.create({ code: 'C1', title: { en: 'Ceremony' } });
    const mod = await Module.create({ courseId: course._id, title: { en: 'M4' } });
    lesson = await Lesson.create({
      moduleId: mod._id,
      courseId: course._id,
      title: { en: 'The threshold rites' },
      eligibilityPolicyId: policy._id,
    });
    const cohort = await Cohort.create({ courseId: course._id, title: { en: 'Run' }, session: '2026/2027' });
    await Enrollment.create({ userId: learner._id, courseId: course._id, cohortId: cohort._id, status: 'active' });
  });
});

describe('the keystone sequence', () => {
  it('1 — withholds the lesson from a learner without the standing', async () => {
    const verdict = await asLearner(() =>
      elig.canAccessLesson({ lessonId: lesson._id, userId: learner._id })
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.failedRules).toContain('attestation');
    expect(verdict.message).toMatch(/held until your standing/);
  });

  it('2 — becomes visible on the next request once the standing is attested', async () => {
    await asElder(() => att.issue({ subjectUserId: learner._id, typeSlug: 'threshold-standing' }));

    const verdict = await asLearner(() =>
      elig.canAccessLesson({ lessonId: lesson._id, userId: learner._id })
    );
    expect(verdict.allowed).toBe(true);
    expect(verdict.message).toBe('');
  });

  it('3 — is withheld again on the next request once the standing is revoked', async () => {
    const grant = await asElder(() =>
      att.issue({ subjectUserId: learner._id, typeSlug: 'threshold-standing' })
    );
    // sanity: allowed while held
    let verdict = await asLearner(() => elig.canAccessLesson({ lessonId: lesson._id, userId: learner._id }));
    expect(verdict.allowed).toBe(true);

    await asElder(() => att.revoke({ attestationId: grant._id, reason: 'standing lapsed' }));

    verdict = await asLearner(() => elig.canAccessLesson({ lessonId: lesson._id, userId: learner._id }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.failedRules).toContain('attestation');
  });

  it('4 — records every evaluation, granted and withheld, in the access log', async () => {
    await asLearner(() => elig.canAccessLesson({ lessonId: lesson._id, userId: learner._id })); // withheld
    const grant = await asElder(() => att.issue({ subjectUserId: learner._id, typeSlug: 'threshold-standing' }));
    await asLearner(() => elig.canAccessLesson({ lessonId: lesson._id, userId: learner._id })); // granted
    await asElder(() => att.revoke({ attestationId: grant._id, reason: 'x' }));
    await asLearner(() => elig.canAccessLesson({ lessonId: lesson._id, userId: learner._id })); // withheld

    const log = await asElder(() => AccessLog.find({}).sort({ at: 1 }).exec());
    const actions = log.map((e) => e.action);
    expect(actions).toEqual([
      'eligibility_withheld',
      'eligibility_granted',
      'eligibility_withheld',
    ]);
  });
});

describe('attestations are append-only', () => {
  it('a revocation is a new record — the grant survives', async () => {
    const grant = await asElder(() => att.issue({ subjectUserId: learner._id, typeSlug: 'threshold-standing' }));
    await asElder(() => att.revoke({ attestationId: grant._id, reason: 'lapsed' }));

    const all = await asElder(() => Attestation.find({ subjectUserId: learner._id }).sort({ createdAt: 1 }).exec());
    expect(all).toHaveLength(2);
    expect(all[0].status).toBe('active');   // the original grant, untouched
    expect(all[1].status).toBe('revoked');  // the revocation, a separate write
    expect(String(all[1].revokesAttestationId)).toBe(String(grant._id));
  });

  it('cannot be updated', async () => {
    const grant = await asElder(() => att.issue({ subjectUserId: learner._id, typeSlug: 'threshold-standing' }));
    await expect(
      asElder(() => Attestation.updateOne({ _id: grant._id }, { status: 'revoked' }).exec())
    ).rejects.toThrow(ImmutableRecordError);
  });
});

describe('only the permitted role may attest', () => {
  it('a learner cannot grant themselves a standing', async () => {
    await expect(
      asLearner(() => att.issue({ subjectUserId: learner._id, typeSlug: 'threshold-standing' }))
    ).rejects.toThrow(/Only a assessor may grant/);
  });
});

describe('the engine holds nothing tenant-specific', () => {
  it('unknown rule types fail closed', async () => {
    const { evaluate } = require('../../src/services/eligibility/evaluator');
    const verdict = await evaluate(
      { rules: [{ type: 'a_rule_that_does_not_exist' }], combinator: 'all', denialMessage: { en: 'no' } },
      { userId: learner._id }
    );
    expect(verdict.allowed).toBe(false);
  });

  it('an empty policy allows (enrolment alone suffices)', async () => {
    const { evaluate } = require('../../src/services/eligibility/evaluator');
    const verdict = await evaluate(null, { userId: learner._id });
    expect(verdict.allowed).toBe(true);
  });
});
