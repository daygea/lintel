'use strict';

const { Quiz, QuizAttempt, AuditLog } = require('../models');
const { ValidationError } = require('../lib/errors');
const { currentUserId } = require('../lib/context');

const listQuizzes = (filter = {}) => Quiz.find(filter).sort({ createdAt: -1 }).exec();
const getQuiz = (id) => Quiz.findById(id).exec();

async function createQuiz(data) {
  if (!data.title) throw new ValidationError('A quiz needs a title');
  return Quiz.create(data);
}

const toArray = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

/**
 * Normalise a raw form/question payload into a QuestionSchema subdocument, per
 * type — validating here (once), never in a controller. Writes exactly the
 * fields mark() reads: options[].correct (by _id), numericAnswer+tolerance,
 * answers+caseSensitive, pairs.
 */
function buildQuestion(raw) {
  const type = raw.type;
  const prompt = String(raw.prompt || '').trim();
  if (!prompt) throw new ValidationError('A question needs a prompt');
  const q = { type, prompt: { en: prompt }, points: Number(raw.points) > 0 ? Number(raw.points) : 1 };

  if (type === 'mcq' || type === 'multi') {
    const texts = toArray(raw.optionText).map((t) => String(t).trim());
    const correct = (type === 'mcq' ? [String(raw.correct)] : toArray(raw.correct).map(String));
    q.options = texts
      .map((t, i) => ({ text: { en: t }, correct: correct.includes(String(i)) }))
      .filter((o) => o.text.en);
    if (q.options.length < 2) throw new ValidationError('Add at least two options');
    if (!q.options.some((o) => o.correct)) throw new ValidationError('Mark at least one correct option');
  } else if (type === 'matching') {
    const lefts = toArray(raw.left).map((s) => String(s).trim());
    const rights = toArray(raw.right).map((s) => String(s).trim());
    q.pairs = lefts.map((left, i) => ({ left, right: rights[i] || '' })).filter((p) => p.left && p.right);
    if (!q.pairs.length) throw new ValidationError('Add at least one complete pair');
  } else if (type === 'cloze' || type === 'short') {
    q.answers = String(raw.answers || '').split('\n').map((s) => s.trim()).filter(Boolean);
    q.caseSensitive = raw.caseSensitive === 'on' || raw.caseSensitive === 'true';
    if (!q.answers.length) throw new ValidationError('Add at least one accepted answer');
  } else if (type === 'numeric') {
    q.numericAnswer = Number(raw.numericAnswer);
    q.tolerance = Number(raw.tolerance) || 0;
    if (Number.isNaN(q.numericAnswer)) throw new ValidationError('Enter the numeric answer');
  } else if (type !== 'essay') {
    throw new ValidationError('Unknown question type');
  }
  return q;
}

async function addQuestion(quizId, raw) {
  const quiz = await Quiz.findById(quizId).exec();
  if (!quiz) throw new ValidationError('No such quiz');
  quiz.questions.push(buildQuestion(raw));
  await quiz.save();
  await AuditLog.create({
    actorUserId: currentUserId(), action: 'quiz.question_added',
    subjectType: 'Quiz', subjectId: quiz._id, meta: { type: raw.type },
  });
  return quiz;
}

async function removeQuestion(quizId, questionId) {
  const quiz = await Quiz.findById(quizId).exec();
  if (!quiz) throw new ValidationError('No such quiz');
  quiz.questions = quiz.questions.filter((q) => String(q._id) !== String(questionId));
  await quiz.save();
  return quiz;
}

/** Open / close / return-to-draft. A quiz can't be OPENED with no questions. */
async function setStatus(quizId, status) {
  if (!['draft', 'open', 'closed'].includes(status)) throw new ValidationError('Invalid status');
  const quiz = await Quiz.findById(quizId).exec();
  if (!quiz) throw new ValidationError('No such quiz');
  if (status === 'open' && !quiz.questions.length) {
    throw new ValidationError('Add at least one question before opening the quiz');
  }
  quiz.status = status;
  await quiz.save();
  await AuditLog.create({
    actorUserId: currentUserId(), action: 'quiz.status_changed',
    subjectType: 'Quiz', subjectId: quiz._id, meta: { status },
  });
  return quiz;
}

/**
 * Present a quiz to a learner: draw the pool, shuffle if asked, and STRIP the
 * answers before it leaves the server. A quiz whose correct answers travel to the
 * browser is a quiz whose answers are in the page source.
 */
async function presentFor(quizId) {
  const quiz = await Quiz.findById(quizId).exec();
  if (!quiz) throw new ValidationError('No such quiz');

  let questions = [...quiz.questions];
  if (quiz.shuffle) questions = shuffle(questions);
  if (quiz.drawCount && quiz.drawCount < questions.length) questions = questions.slice(0, quiz.drawCount);

  return {
    id: quiz._id,
    title: quiz.title,
    timeLimitMinutes: quiz.timeLimitMinutes,
    questions: questions.map(stripAnswers),
  };
}

/**
 * Auto-mark a submission. Returns { autoScore, maxScore, needsManualMarking }.
 * The marking logic lives here, once, per type — never in a controller.
 */
async function submit({ quizId, userId, responses }) {
  const quiz = await Quiz.findById(quizId).exec();
  if (!quiz) throw new ValidationError('No such quiz');
  if (quiz.status === 'closed') throw new ValidationError('This quiz is closed');

  const prior = await QuizAttempt.countDocuments({ quizId, userId }).exec();
  if (prior >= quiz.attemptsAllowed) throw new ValidationError('No attempts remaining');

  let autoScore = 0;
  let maxScore = 0;
  let needsManual = false;

  for (const q of quiz.questions) {
    maxScore += q.points || 1;
    const given = responses?.[String(q._id)];
    if (q.type === 'essay') { needsManual = true; continue; }
    autoScore += mark(q, given);
  }

  const attempt = await QuizAttempt.create({
    quizId,
    userId,
    attemptNo: prior + 1,
    responses,
    autoScore,
    maxScore,
    needsManualMarking: needsManual,
    submittedAt: new Date(),
    status: needsManual ? 'submitted' : 'marked',
  });

  await AuditLog.create({
    actorUserId: currentUserId(),
    action: 'quiz.submitted',
    subjectType: 'QuizAttempt',
    subjectId: attempt._id,
    meta: { autoScore, maxScore, needsManual },
  });

  // Roll the result into the course gradebook — best-effort, so a gradebook
  // hiccup never fails a submission the learner has already made. Lazy require
  // keeps the dependency one-way (gradebook doesn't know about quizzes).
  try {
    await require('./gradebook.service').recordQuizScore({ quiz, userId });
  } catch (err) {
    require('../lib/logger').warn({ quizId: String(quizId), err: err.message }, 'quiz gradebook roll-up failed');
  }

  return attempt;
}

/* ------------------------------------------------------------- marking logic */

function mark(q, given) {
  if (given == null) return 0;
  const pts = q.points || 1;

  switch (q.type) {
    case 'mcq': {
      const correct = q.options.find((o) => o.correct);
      return correct && String(given) === String(correct._id) ? pts : 0;
    }
    case 'multi': {
      // Partial credit: +1 per correct selected, -1 per wrong selected, floored at 0.
      const correctIds = q.options.filter((o) => o.correct).map((o) => String(o._id));
      const given_ = Array.isArray(given) ? given.map(String) : [String(given)];
      const rightCount = correctIds.length || 1;
      let raw = 0;
      for (const id of given_) raw += correctIds.includes(id) ? 1 : -1;
      return Math.max(0, (raw / rightCount) * pts);
    }
    case 'numeric': {
      const n = Number(given);
      if (Number.isNaN(n)) return 0;
      return Math.abs(n - q.numericAnswer) <= (q.tolerance || 0) ? pts : 0;
    }
    case 'short':
    case 'cloze': {
      const norm = (s) => (q.caseSensitive ? String(s) : String(s).toLowerCase()).trim();
      const accepted = (q.answers || []).map(norm);
      return accepted.includes(norm(given)) ? pts : 0;
    }
    case 'matching': {
      // given: { left: right }. Full marks only if every pair is right.
      const correct = Object.fromEntries((q.pairs || []).map((p) => [p.left, p.right]));
      const ok = Object.entries(given || {}).every(([l, r]) => correct[l] === r);
      const complete = Object.keys(given || {}).length === (q.pairs || []).length;
      return ok && complete ? pts : 0;
    }
    default:
      return 0;
  }
}

/* ------------------------------------------------------------------- helpers */

function stripAnswers(q) {
  const base = { id: q._id, type: q.type, prompt: q.prompt, points: q.points };
  if (q.type === 'mcq' || q.type === 'multi') {
    base.options = q.options.map((o) => ({ id: o._id, text: o.text }));
  }
  if (q.type === 'matching') {
    base.lefts = q.pairs.map((p) => p.left);
    base.rights = shuffle(q.pairs.map((p) => p.right));
  }
  return base;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ------------------------------------------------------------- manual marking */

const essayTotal = (marks) => Object.values(marks || {}).reduce((s, v) => s + (Number(v) || 0), 0);

/** Attempts on this quiz that still need an assessor to mark a written answer. */
function listAttemptsToMark(quizId) {
  return QuizAttempt.find({ quizId, needsManualMarking: true, status: 'submitted' })
    .populate('userId', 'name email').sort({ submittedAt: 1 }).exec();
}

/** One attempt plus its quiz, for the marking screen. */
async function getAttemptForMarking(attemptId) {
  const attempt = await QuizAttempt.findById(attemptId).populate('userId', 'name email').exec();
  if (!attempt) return null;
  const quiz = await Quiz.findById(attempt.quizId).exec();
  return { attempt, quiz };
}

/**
 * Record an assessor's marks for an attempt's essay questions, finalise it, and
 * roll the result into the gradebook. Points are clamped to each question's max.
 * autoScore (the auto portion) is left untouched; essay marks live in manualMarks,
 * so re-marking replaces rather than double-counts.
 */
async function markEssays(attemptId, rawMarks) {
  const attempt = await QuizAttempt.findById(attemptId).exec();
  if (!attempt) throw new ValidationError('No such attempt');
  const quiz = await Quiz.findById(attempt.quizId).exec();
  if (!quiz) throw new ValidationError('No such quiz');

  const marks = {};
  for (const q of quiz.questions) {
    if (q.type !== 'essay') continue;
    const raw = Number(rawMarks?.[String(q._id)]);
    marks[String(q._id)] = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), q.points || 1) : 0;
  }

  attempt.manualMarks = marks;
  attempt.needsManualMarking = false;
  attempt.status = 'marked';
  await attempt.save();

  await AuditLog.create({
    actorUserId: currentUserId(), action: 'quiz.marked',
    subjectType: 'QuizAttempt', subjectId: attempt._id,
    meta: { manualTotal: essayTotal(marks) },
  });

  try {
    await require('./gradebook.service').recordQuizScore({ quiz, userId: attempt.userId });
  } catch (err) {
    require('../lib/logger').warn({ attemptId: String(attempt._id), err: err.message }, 'quiz gradebook roll-up failed');
  }

  return attempt;
}

module.exports = {
  listQuizzes, getQuiz, createQuiz, buildQuestion, addQuestion, removeQuestion, setStatus,
  presentFor, submit, mark, listAttemptsToMark, getAttemptForMarking, markEssays,
};
