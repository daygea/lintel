'use strict';

const lti = require('../../services/lti');
const { signLaunch } = require('../../services/lti/verify');

const h = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

exports.listTools = h(async (req, res) => res.json({ tools: await lti.listTools() }));
exports.registerTool = h(async (req, res) => res.status(201).json({ tool: await lti.registerTool(req.body) }));

/** Build and sign a launch; returns the id_token the browser auto-POSTs to the tool. */
exports.launch = h(async (req, res) => {
  const { tool, claims, state } = await lti.buildLaunch({
    toolId: req.params.toolId,
    userId: req.user._id,
    courseId: req.body.courseId,
    lineItemId: req.body.lineItemId,
    resourceLinkId: req.body.resourceLinkId,
  });
  const idToken = await signLaunch(tool, claims);
  res.json({ launchUrl: tool.launchUrl, idToken, state });
});

/* --- Advantage service callbacks the TOOL calls (bearer-token authed) --- */

exports.receiveScore = h(async (req, res) => {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  const score = await lti.receiveScore({
    toolId: req.params.toolId,
    lineItemId: req.params.lineItemId,
    userId: req.body.userId,
    scoreGiven: req.body.scoreGiven,
    scoreMaximum: req.body.scoreMaximum,
    token,
  });
  res.status(200).json({ ok: true, scoreId: score._id });
});

exports.readResults = h(async (req, res) => {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  res.json({ results: await lti.readResults({ toolId: req.params.toolId, lineItemId: req.params.lineItemId, token }) });
});

exports.membership = h(async (req, res) => {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  res.json(await lti.courseMembership({ toolId: req.params.toolId, courseId: req.params.courseId, token }));
});
