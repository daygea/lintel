'use strict';

const { GradeScheme, LineItem, Score, Course, User, AuditLog, QuizAttempt } = require('../models');
const { ValidationError } = require('../lib/errors');
const { currentUserId } = require('../lib/context');
const { pick } = require('../plugins/locale-map');

/* -------------------------------------------------------------- grade schemes */

const listSchemes = () => GradeScheme.find({}).sort({ slug: 1 }).exec();
async function upsertScheme(data) {
  if (!data.slug || !data.label) throw new ValidationError('A scheme needs a slug and a label');
  return GradeScheme.findOneAndUpdate({ slug: data.slug }, data, {
    upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true,
  }).exec();
}

/* ---------------------------------------------------------------- line items */

const listLineItems = (courseId) => LineItem.find({ courseId }).sort({ category: 1 }).exec();

async function createLineItem(data) {
  if (!data.courseId || !data.label || !data.category) {
    throw new ValidationError('A line item needs a course, a label and a category');
  }
  return LineItem.create(data);
}

/* --------------------------------------------------------------------- scores */

/**
 * Record or update a score. A Score is mutable — a correction is a correction,
 * not a new record — but an override (a human changing a computed mark) is stamped
 * with who and when, and audited. Accountability without immutability.
 */
async function putScore({ lineItemId, userId, points, override, note }) {
  const existing = await Score.findOne({ lineItemId, userId }).exec();

  const patch = { points };
  if (override) {
    patch.overriddenByUserId = currentUserId();
    patch.overrideNote = note;
  }

  const score = await Score.findOneAndUpdate({ lineItemId, userId }, patch, {
    upsert: true, new: true, setDefaultsOnInsert: true,
  }).exec();

  if (override) {
    await AuditLog.create({
      actorUserId: currentUserId(),
      action: 'score.overridden',
      subjectType: 'Score',
      subjectId: score._id,
      meta: { lineItemId: String(lineItemId), userId: String(userId), points, was: existing?.points },
    });
  }
  return score;
}

/**
 * Compute a learner's overall grade for a course under its scheme.
 *
 * Weighted by category, with drop-lowest applied per category, normalised so the
 * category weights sum to 100 regardless of the raw numbers a tenant typed. Every
 * step is explainable — a learner who asks "why this grade?" gets an answer, not
 * a black box.
 */
async function computeForLearner({ courseId, userId, schemeSlug }) {
  const scheme = await GradeScheme.findOne({ slug: schemeSlug }).exec();
  if (!scheme) throw new ValidationError(`No such grade scheme: ${schemeSlug}`);

  const lineItems = await LineItem.find({ courseId }).exec();
  const scores = await Score.find({ userId, lineItemId: { $in: lineItems.map((l) => l._id) } }).exec();
  const scoreByItem = new Map(scores.map((s) => [String(s.lineItemId), s]));

  const totalWeight = scheme.categories.reduce((sum, c) => sum + c.weight, 0) || 1;
  const breakdown = [];
  let overall = 0;

  for (const cat of scheme.categories) {
    const items = lineItems.filter((li) => li.category === cat.key);
    let pcts = items.map((li) => {
      const s = scoreByItem.get(String(li._id));
      return s ? (s.points / (li.maxPoints || 1)) * 100 : null;
    }).filter((p) => p != null);

    // drop the N lowest in this category
    if (cat.dropLowest > 0 && pcts.length > cat.dropLowest) {
      pcts = pcts.sort((a, b) => a - b).slice(cat.dropLowest);
    }

    const catPct = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0;
    const contribution = (cat.weight / totalWeight) * catPct;
    overall += contribution;

    breakdown.push({
      category: cat.key,
      label: pick(cat.label, 'en'),
      weightPct: Math.round((cat.weight / totalWeight) * 100),
      categoryPct: Math.round(catPct * 10) / 10,
      itemsCounted: pcts.length,
    });
  }

  overall = Math.round(overall * 10) / 10;
  const band = [...scheme.bands].sort((a, b) => b.minPercent - a.minPercent).find((b) => overall >= b.minPercent);

  return {
    overallPercent: overall,
    passed: overall >= scheme.passPercent,
    band: band ? pick(band.label, 'en') : null,
    breakdown,
  };
}

/**
 * A transcript: every completed course with its final grade. The thing a learner
 * or registrar exports. Kept plain — a transcript is a record, not a dashboard.
 */
async function transcriptFor(userId) {
  const scores = await Score.find({ userId }).exec();
  const lineItemIds = scores.map((s) => s.lineItemId);
  const lineItems = await LineItem.find({ _id: { $in: lineItemIds } }).exec();
  const courseIds = [...new Set(lineItems.map((li) => String(li.courseId)))];
  const courses = await Course.find({ _id: { $in: courseIds } }).exec();

  const user = await User.findById(userId).exec();
  return {
    learner: { id: userId, name: user?.name },
    courses: courses.map((c) => ({ courseId: c._id, code: c.code, title: c.title })),
    generatedAt: new Date(),
  };
}

/* --------------------------------------------------------------- quiz roll-up */

/**
 * A quiz feeds a line item natively (LineItem.source='quiz', quizId). Ensure the
 * course gradebook has a column for this quiz, created once and lazily. Scores
 * roll up as a percentage, so the column is out of 100.
 */
async function ensureQuizLineItem(quiz) {
  let lineItem = await LineItem.findOne({ quizId: quiz._id }).exec();
  if (!lineItem) {
    lineItem = await LineItem.create({
      courseId: quiz.courseId,
      label: quiz.title,
      category: 'quizzes',
      source: 'quiz',
      quizId: quiz._id,
      maxPoints: 100,
      published: true,
    });
  }
  return lineItem;
}

/**
 * Roll a learner's quiz result into the gradebook: their BEST fully-marked
 * attempt, as a percentage, on the quiz's line item. A quiz not tied to a course
 * has no gradebook to post to. Attempts still awaiting manual marking (an essay)
 * aren't final and don't roll up until they're marked. Best-of-attempts, so a
 * weaker later attempt never lowers a stronger earlier one.
 */
async function recordQuizScore({ quiz, userId }) {
  if (!quiz.courseId) return null;
  const attempts = await QuizAttempt.find({ quizId: quiz._id, userId, status: 'marked' }).exec();
  if (!attempts.length) return null;
  // Earned = auto-marked portion + any assessor marks for essays.
  const earned = (a) =>
    (a.autoScore || 0) + Object.values(a.manualMarks || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const bestPct = Math.max(...attempts.map((a) => (a.maxScore ? (earned(a) / a.maxScore) * 100 : 0)));
  const lineItem = await ensureQuizLineItem(quiz);
  return putScore({ lineItemId: lineItem._id, userId, points: Math.round(bestPct) });
}

module.exports = {
  listSchemes, upsertScheme,
  listLineItems, createLineItem,
  putScore, computeForLearner, transcriptFor,
  ensureQuizLineItem, recordQuizScore,
};
