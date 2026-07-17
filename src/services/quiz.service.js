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

module.exports = { listQuizzes, getQuiz, createQuiz, presentFor, submit, mark };
