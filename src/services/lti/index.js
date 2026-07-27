'use strict';

const crypto = require('node:crypto');
const {
  LtiTool, LtiLaunch, User, Membership, Course, LineItem, Score, Enrollment, AuditLog,
} = require('../../models');
const { ValidationError, NotAuthorisedError } = require('../../lib/errors');
const { currentUserId, currentTenantId } = require('../../lib/context');
const { verifyToolJwt } = require('./verify');
const { rolesToLti, ltiToRoles } = require('./roles');

/* ---------------------------------------------------------------- tools */

const listTools = () => LtiTool.find({}).sort({ name: 1 }).exec();
async function registerTool(data) {
  if (!data.clientId || !data.issuer || !data.deploymentId) {
    throw new ValidationError('A tool needs clientId, issuer and deploymentId');
  }
  return LtiTool.create(data);
}

const toolHasScope = (tool, scope) => (tool.scopes || []).includes(scope);
const AGS_LINEITEM = 'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem';
const AGS_SCORE = 'https://purl.imsglobal.org/spec/lti-ags/scope/score';
const NRPS = 'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly';

/* ---------------------------------------------------------------- launch */

/**
 * Build a launch for a learner into a tool. We record a single-use nonce and
 * state so the tool's later callbacks tie back to this exact learner/course/line
 * item. The actual signed id_token is assembled and signed by verify.js (which
 * holds the crypto boundary); here we assemble the CLAIMS.
 */
async function buildLaunch({ toolId, userId, courseId, lineItemId, resourceLinkId }) {
  const tool = await LtiTool.findById(toolId).exec();
  if (!tool || !tool.enabled) throw new ValidationError('Tool not enabled');

  const user = await User.findById(userId).exec();
  const membership = await Membership.findOne({ userId }).exec();

  const nonce = crypto.randomBytes(16).toString('hex');
  const state = crypto.randomBytes(16).toString('hex');

  await LtiLaunch.create({ toolId, userId, courseId, lineItemId, resourceLinkId, nonce, state });

  // The LTI 1.3 message claims. Roles are mapped to the LTI vocabulary.
  const claims = {
    'https://purl.imsglobal.org/spec/lti/claim/message_type': 'LtiResourceLinkRequest',
    'https://purl.imsglobal.org/spec/lti/claim/version': '1.3.0',
    'https://purl.imsglobal.org/spec/lti/claim/deployment_id': tool.deploymentId,
    'https://purl.imsglobal.org/spec/lti/claim/target_link_uri': tool.launchUrl,
    'https://purl.imsglobal.org/spec/lti/claim/resource_link': { id: resourceLinkId || String(lineItemId || courseId) },
    'https://purl.imsglobal.org/spec/lti/claim/roles': rolesToLti(membership?.roles || []),
    'https://purl.imsglobal.org/spec/lti/claim/context': courseId ? { id: String(courseId) } : undefined,
    sub: String(userId),
    name: user?.name,
    email: user?.email,
    nonce,
  };

  // AGS endpoint claim — tells the tool where to post grades, IF it has the scope.
  if (lineItemId && toolHasScope(tool, AGS_SCORE)) {
    claims['https://purl.imsglobal.org/spec/lti-ags/claim/endpoint'] = {
      scope: tool.scopes.filter((s) => s.startsWith('https://purl.imsglobal.org/spec/lti-ags')),
      lineitem: `/api/v1/lti/${tool._id}/lineitems/${lineItemId}`,
    };
  }

  return { tool, claims, state, nonce };
}

/* ------------------------------------------------------- AGS: the payoff */

/**
 * A tool posts a score (AGS). This is the whole reason LineItem was built
 * LTI-native in Sprint 5b: the score lands in the SAME Score collection the
 * gradebook already computes over. LTI is not a parallel grade store — it is
 * another writer of rows that already exist.
 *
 * The tool authenticates with a bearer token it obtained via client-credentials;
 * verify.js checks it and confirms the AGS score scope. A tool without the scope
 * is refused — least privilege.
 */
async function receiveScore({ toolId, lineItemId, userId, scoreGiven, scoreMaximum, token }) {
  const tool = await LtiTool.findById(toolId).exec();
  if (!tool) throw new ValidationError('No such tool');

  await verifyToolJwt(tool, token, AGS_SCORE); // throws if invalid or scope missing

  const lineItem = await LineItem.findById(lineItemId).exec();
  if (!lineItem) throw new ValidationError('No such line item');
  if (String(lineItem.source) !== 'lti' && !lineItem.ltiResourceId) {
    // A tool may only write to line items designated for external tools.
    throw new NotAuthorisedError('This line item does not accept external scores');
  }

  // Normalise to the line item's own maxPoints — the tool may grade out of 1.0.
  const points = scoreMaximum ? (scoreGiven / scoreMaximum) * lineItem.maxPoints : scoreGiven;

  const score = await Score.findOneAndUpdate(
    { lineItemId, userId },
    { points, comment: `via ${tool.name}` },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).exec();

  await AuditLog.create({
    actorUserId: userId,
    action: 'lti.score_received',
    subjectType: 'Score',
    subjectId: score._id,
    meta: { toolId: String(toolId), lineItemId: String(lineItemId), points },
  });

  return score;
}

/** AGS read: a tool asks for the current scores on a line item it owns. */
async function readResults({ toolId, lineItemId, token }) {
  const tool = await LtiTool.findById(toolId).exec();
  if (!tool) throw new ValidationError('No such tool');
  await verifyToolJwt(tool, token, AGS_LINEITEM);

  const scores = await Score.find({ lineItemId }).exec();
  return scores.map((s) => ({
    userId: String(s.userId),
    resultScore: s.points,
    resultMaximum: undefined,
    timestamp: s.updatedAt,
  }));
}

/* --------------------------------------------------- NRPS: names & roles */

/**
 * A tool asks who is in a course (Names and Role Provisioning Service). We return
 * enrolled members with LTI-vocabulary roles. Requires the NRPS scope; a tool
 * without it gets nothing.
 */
async function courseMembership({ toolId, courseId, token }) {
  const tool = await LtiTool.findById(toolId).exec();
  if (!tool) throw new ValidationError('No such tool');
  await verifyToolJwt(tool, token, NRPS);

  const enrollments = await Enrollment.find({ courseId, status: 'active' }).exec();
  const members = [];
  for (const e of enrollments) {
    const user = await User.findById(e.userId).exec();
    const membership = await Membership.findOne({ userId: e.userId }).exec();
    if (!user) continue;
    members.push({
      user_id: String(user._id),
      name: user.name,
      email: user.email,
      roles: rolesToLti(membership?.roles || ['learner']),
      status: 'Active',
    });
  }
  return { context: { id: String(courseId) }, members };
}

module.exports = {
  listTools, registerTool,
  buildLaunch,
  receiveScore, readResults,
  courseMembership,
  SCOPES: { AGS_LINEITEM, AGS_SCORE, NRPS },
};
