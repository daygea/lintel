'use strict';

const {
  Rubric, Assessment, Submission, AssessorAssignment, Grade,
  Membership, AuditLog,
} = require('../models');
const { ValidationError, NotAuthorisedError } = require('../lib/errors');
const { currentUserId } = require('../lib/context');

/* ------------------------------------------------------------------ rubrics */

const listRubrics = () => Rubric.find({}).sort({ createdAt: -1 }).exec();

async function createRubric({ title, criteria }) {
  if (!title) throw new ValidationError('A rubric needs a title');
  return Rubric.create({ title, criteria: criteria || [] });
}

/* -------------------------------------------------------------- assessments */

const listAssessments = (filter = {}) => Assessment.find(filter).sort({ createdAt: -1 }).exec();
const getAssessment = (id) => Assessment.findById(id).exec();

async function createAssessment(data) {
  if (!data.title) throw new ValidationError('An assessment needs a title');
  return Assessment.create(data);
}

/* -------------------------------------------------------------- submissions */

/**
 * A learner submits. Attempt numbers increment; the unique index stops a double
 * submit of the same attempt. The recording arrived via the Sprint 1 upload path
 * already — here we just record which assets belong to this attempt.
 */
async function submit({ assessmentId, userId, text, assetIds }) {
  const assessment = await Assessment.findById(assessmentId).exec();
  if (!assessment) throw new ValidationError('No such assessment');
  if (assessment.status === 'closed') throw new ValidationError('This assessment is closed');

  const prior = await Submission.countDocuments({ assessmentId, userId }).exec();
  if (prior >= assessment.attemptsAllowed) {
    throw new ValidationError(`No attempts remaining (limit ${assessment.attemptsAllowed})`);
  }

  const submission = await Submission.create({
    assessmentId,
    userId,
    attemptNo: prior + 1,
    text,
    assetIds: assetIds || [],
    status: 'submitted',
  });

  await audit('submission.created', 'Submission', submission._id, { assessmentId: String(assessmentId), attemptNo: prior + 1 });
  return submission;
}

const listSubmissions = (assessmentId) =>
  Submission.find({ assessmentId }).populate('userId', 'name email').sort({ submittedAt: 1 }).exec();

/* ---------------------------------------------------------------- assessors */

async function assignAssessor({ submissionId, assessorUserId, role = 'primary' }) {
  const submission = await Submission.findById(submissionId).exec();
  if (!submission) throw new ValidationError('No such submission');

  try {
    const assignment = await AssessorAssignment.create({ submissionId, assessorUserId, role });
    if (submission.status === 'submitted') {
      await Submission.updateOne({ _id: submissionId }, { status: 'under_review' }).exec();
    }
    return assignment;
  } catch (err) {
    if (err.code === 11000) throw new ValidationError('That assessor is already assigned to this submission');
    throw err;
  }
}

/* ------------------------------------------------------------------- grading */

/**
 * Record a grade. Computes the weighted total from the rubric so two assessors
 * choosing the same levels produce the same number. Writes a NEW grade — never
 * mutates an existing one.
 */
async function grade({ submissionId, criterionScores, feedback, feedbackAssetId }) {
  const submission = await Submission.findById(submissionId).exec();
  if (!submission) throw new ValidationError('No such submission');

  const assignment = await AssessorAssignment.findOne({
    submissionId,
    assessorUserId: currentUserId(),
  }).exec();
  if (!assignment) throw new NotAuthorisedError('You are not assigned to mark this submission');

  const totalPoints = computeTotal(criterionScores);

  const record = await Grade.create({
    submissionId,
    assessorUserId: currentUserId(),
    criterionScores: criterionScores || [],
    totalPoints,
    feedback,
    feedbackAssetId,
    isFinal: false, // provisional until moderated (if moderation is required)
  });

  await AssessorAssignment.updateOne(
    { _id: assignment._id },
    { status: 'completed', completedAt: new Date() }
  ).exec();

  await maybeFinalise(submission);
  await audit('grade.recorded', 'Grade', record._id, { submissionId: String(submissionId), total: totalPoints });
  return record;
}

/**
 * Moderation. An elder (or whoever the assessment names) overrules or confirms.
 * This writes a NEW grade pointing at the one it moderates. The provisional grade
 * is NOT touched — both survive, each attributed. This is the whole reason Grade
 * is append-only.
 */
async function moderate({ gradeId, criterionScores, feedback, feedbackAssetId }) {
  const provisional = await Grade.findById(gradeId).exec();
  if (!provisional) throw new ValidationError('No such grade');

  const submission = await Submission.findById(provisional.submissionId).exec();
  const assessment = await Assessment.findById(
    (await Submission.findById(provisional.submissionId).exec())?.assessmentId
  ).exec();

  const moderator = await Membership.findOne({ userId: currentUserId(), status: 'active' }).exec();
  const requiredRole = assessment?.moderatorRole || 'elder';
  if (!moderator || !moderator.roles.includes(requiredRole)) {
    throw new NotAuthorisedError(`Only a ${requiredRole} may moderate this grade`);
  }

  const totalPoints = computeTotal(criterionScores);

  const moderated = await Grade.create({
    submissionId: provisional.submissionId,
    assessorUserId: currentUserId(),
    criterionScores: criterionScores || provisional.criterionScores,
    totalPoints,
    feedback,
    feedbackAssetId,
    isFinal: true,
    moderatedFromGradeId: provisional._id,
  });

  await Submission.updateOne({ _id: provisional.submissionId }, { status: 'graded' }).exec();
  await audit('grade.moderated', 'Grade', moderated._id, { from: String(provisional._id), total: totalPoints });
  return moderated;
}

/** All grades for a submission, provisional and final, newest first. */
const gradesFor = (submissionId) =>
  Grade.find({ submissionId }).sort({ createdAt: -1 }).exec();

/** The grade that counts: the final one if it exists, else the latest provisional. */
async function finalGrade(submissionId) {
  const final = await Grade.findOne({ submissionId, isFinal: true }).sort({ createdAt: -1 }).exec();
  if (final) return final;
  return Grade.findOne({ submissionId }).sort({ createdAt: -1 }).exec();
}

/* ------------------------------------------------------------------- helpers */

function computeTotal(scores) {
  return (scores || []).reduce((sum, s) => sum + (s.points || 0), 0);
}

/** If the assessment needs no moderation, a single grade is final immediately. */
async function maybeFinalise(submission) {
  const assessment = await Assessment.findById(submission.assessmentId).exec();
  if (assessment && !assessment.requiresModeration) {
    await Submission.updateOne({ _id: submission._id }, { status: 'graded' }).exec();
    const latest = await Grade.findOne({ submissionId: submission._id }).sort({ createdAt: -1 }).exec();
    // We cannot mutate the grade (append-only). "Final" without moderation is
    // simply: the latest grade, and status graded. finalGrade() handles that.
  }
}

const audit = (action, subjectType, subjectId, meta) =>
  AuditLog.create({ actorUserId: currentUserId(), action, subjectType, subjectId, meta });

module.exports = {
  listRubrics, createRubric,
  listAssessments, getAssessment, createAssessment,
  submit, listSubmissions,
  assignAssessor,
  grade, moderate, gradesFor, finalGrade,
};
