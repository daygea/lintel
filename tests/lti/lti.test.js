'use strict';

/**
 * Sprint 9 exit criteria — the payoff first:
 *   - a tool's AGS score lands in the SAME Score collection the gradebook reads,
 *     and the computed course grade reflects it (LTI is a writer of existing rows,
 *     not a parallel store)
 *   - a tool without the required scope is refused (least privilege)
 *   - roles map to the LTI vocabulary on a launch and back on a roster
 *   - a launch records a single-use nonce
 *   - NRPS returns enrolled members with LTI roles
 */

const {
  Tenant, User, Membership, Course, LineItem, Score, Enrollment, Cohort,
  LtiTool, LtiLaunch, GradeScheme,
} = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const lti = require('../../src/services/lti');
const gb = require('../../src/services/gradebook.service');

let tenant, staff, learner, course, tool, lineItem;
const as = (fn) => runWithTenant(tenant._id, staff._id, fn);

const AGS_SCORE = lti.SCOPES.AGS_SCORE;
const NRPS = lti.SCOPES.NRPS;

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'uni', name: 'University', locales: ['en'] });
  staff = await User.create({ email: 's@x.com', name: 'Staff', passwordHash: 'x', status: 'active' });
  learner = await User.create({ email: 'l@x.com', name: 'Learner', passwordHash: 'x', status: 'active' });
  await as(async () => {
    await Membership.create({ userId: staff._id, roles: ['registrar'], status: 'active' });
    await Membership.create({ userId: learner._id, roles: ['learner'], status: 'active' });
    course = await Course.create({ code: 'C1', title: { en: 'Course' } });
    lineItem = await LineItem.create({
      courseId: course._id, label: { en: 'External exercise' }, category: 'exercises',
      source: 'lti', maxPoints: 100, ltiResourceId: 'res-1',
    });
    tool = await LtiTool.create({
      name: 'Exercise Tool', clientId: 'tool-1', issuer: 'https://tool.example', deploymentId: 'dep-1',
      launchUrl: 'https://tool.example/launch',
      scopes: [AGS_SCORE, NRPS],
      enabled: true,
    });
  });
});

describe('AGS — the payoff', () => {
  it('a tool score lands in Score and the gradebook reflects it', async () => {
    // The tool grades out of 1.0; it should normalise to the line item's 100.
    await as(() => lti.receiveScore({
      toolId: tool._id, lineItemId: lineItem._id, userId: learner._id,
      scoreGiven: 0.8, scoreMaximum: 1.0, token: 'dev',
    }));

    const score = await as(() => Score.findOne({ lineItemId: lineItem._id, userId: learner._id }).exec());
    expect(score.points).toBe(80); // normalised

    // And the gradebook — the SAME Score collection — computes over it.
    await as(() => gb.upsertScheme({
      slug: 'std', label: { en: 'Std' }, passPercent: 50,
      categories: [{ key: 'exercises', label: { en: 'Exercises' }, weight: 100 }], bands: [],
    }));
    const result = await as(() => gb.computeForLearner({ courseId: course._id, userId: learner._id, schemeSlug: 'std' }));
    expect(result.overallPercent).toBe(80);
  });

  it('an idempotent re-post updates rather than duplicates', async () => {
    await as(() => lti.receiveScore({ toolId: tool._id, lineItemId: lineItem._id, userId: learner._id, scoreGiven: 50, scoreMaximum: 100, token: 'dev' }));
    await as(() => lti.receiveScore({ toolId: tool._id, lineItemId: lineItem._id, userId: learner._id, scoreGiven: 90, scoreMaximum: 100, token: 'dev' }));
    const scores = await as(() => Score.find({ lineItemId: lineItem._id, userId: learner._id }).exec());
    expect(scores).toHaveLength(1);
    expect(scores[0].points).toBe(90);
  });
});

describe('least privilege', () => {
  it('refuses a tool that lacks the score scope', async () => {
    const weak = await as(() => LtiTool.create({
      name: 'Read-only', clientId: 'tool-2', issuer: 'https://t2', deploymentId: 'd2',
      scopes: [NRPS], enabled: true, // no AGS_SCORE
    }));
    await expect(as(() => lti.receiveScore({
      toolId: weak._id, lineItemId: lineItem._id, userId: learner._id, scoreGiven: 1, scoreMaximum: 1, token: 'dev',
    }))).rejects.toThrow(/lacks the required scope/);
  });

  it('refuses a score to a non-LTI line item', async () => {
    const manual = await as(() => LineItem.create({ courseId: course._id, label: { en: 'Manual' }, category: 'x', source: 'manual', maxPoints: 100 }));
    await expect(as(() => lti.receiveScore({
      toolId: tool._id, lineItemId: manual._id, userId: learner._id, scoreGiven: 1, scoreMaximum: 1, token: 'dev',
    }))).rejects.toThrow(/does not accept external scores/);
  });
});

describe('launch', () => {
  it('records a single-use nonce and maps roles to the LTI vocabulary', async () => {
    const { claims, nonce } = await as(() => lti.buildLaunch({
      toolId: tool._id, userId: learner._id, courseId: course._id, lineItemId: lineItem._id,
    }));
    expect(claims['https://purl.imsglobal.org/spec/lti/claim/roles']).toContain(
      'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'
    );
    const launch = await as(() => LtiLaunch.findOne({ nonce }).exec());
    expect(launch).toBeTruthy();
    expect(launch.consumed).toBe(false);
  });

  it('includes the AGS endpoint only when the tool has the score scope', async () => {
    const { claims } = await as(() => lti.buildLaunch({ toolId: tool._id, userId: learner._id, courseId: course._id, lineItemId: lineItem._id }));
    expect(claims['https://purl.imsglobal.org/spec/lti-ags/claim/endpoint']).toBeTruthy();
  });
});

describe('NRPS', () => {
  it('returns enrolled members with LTI roles', async () => {
    await as(async () => {
      const cohort = await Cohort.create({ courseId: course._id, title: { en: 'R' }, session: '2026/2027' });
      await Enrollment.create({ userId: learner._id, courseId: course._id, cohortId: cohort._id, status: 'active' });
    });
    const result = await as(() => lti.courseMembership({ toolId: tool._id, courseId: course._id, token: 'dev' }));
    expect(result.members).toHaveLength(1);
    expect(result.members[0].roles).toContain('http://purl.imsglobal.org/vocab/lis/v2/membership#Learner');
  });
});
