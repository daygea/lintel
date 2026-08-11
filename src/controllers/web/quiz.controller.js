'use strict';

const quiz = require('../../services/quiz.service');
const curriculum = require('../../services/curriculum.service');
const { pick } = require('../../plugins/locale-map');

const h = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

exports.list = h(async (req, res) => {
  const [course, quizzes] = await Promise.all([
    curriculum.getCourse(req.params.id),
    quiz.listQuizzes({ courseId: req.params.id }),
  ]);
  res.render('quiz/list', { course, courseId: req.params.id, quizzes, pick, error: null });
});

exports.create = h(async (req, res) => {
  const created = await quiz.createQuiz({
    courseId: req.params.id,
    title: { en: (req.body.title || '').trim() },
    passPercent: Number(req.body.passPercent) || 50,
    attemptsAllowed: Number(req.body.attemptsAllowed) || 1,
    shuffle: req.body.shuffle === 'on',
    timeLimitMinutes: req.body.timeLimitMinutes ? Number(req.body.timeLimitMinutes) : undefined,
  });
  res.redirect(`/courses/${req.params.id}/quizzes/${created._id}`);
});

exports.edit = h(async (req, res) => {
  const [course, q] = await Promise.all([
    curriculum.getCourse(req.params.id),
    quiz.getQuiz(req.params.quizId),
  ]);
  if (!q) return res.status(404).render('error', { status: 404, message: 'Quiz not found' });
  res.render('quiz/edit', { course, courseId: req.params.id, quiz: q, pick, error: null });
});

exports.addQuestion = h(async (req, res) => {
  try {
    await quiz.addQuestion(req.params.quizId, req.body);
    res.redirect(`/courses/${req.params.id}/quizzes/${req.params.quizId}`);
  } catch (err) {
    if (err.status === 422 || err.name === 'ValidationError') {
      const [course, q] = await Promise.all([
        curriculum.getCourse(req.params.id),
        quiz.getQuiz(req.params.quizId),
      ]);
      return res.status(422).render('quiz/edit', { course, courseId: req.params.id, quiz: q, pick, error: err.message });
    }
    throw err;
  }
});

exports.removeQuestion = h(async (req, res) => {
  await quiz.removeQuestion(req.params.quizId, req.params.qid);
  res.redirect(`/courses/${req.params.id}/quizzes/${req.params.quizId}`);
});

exports.setStatus = h(async (req, res) => {
  try {
    await quiz.setStatus(req.params.quizId, req.body.status);
    res.redirect(`/courses/${req.params.id}/quizzes/${req.params.quizId}`);
  } catch (err) {
    if (err.status === 422 || err.name === 'ValidationError') {
      const [course, q] = await Promise.all([
        curriculum.getCourse(req.params.id),
        quiz.getQuiz(req.params.quizId),
      ]);
      return res.status(422).render('quiz/edit', { course, courseId: req.params.id, quiz: q, pick, error: err.message });
    }
    throw err;
  }
});

/* --------------------------------------------------------------- manual marking */

exports.marking = h(async (req, res) => {
  const [course, q, attempts] = await Promise.all([
    curriculum.getCourse(req.params.id),
    quiz.getQuiz(req.params.quizId),
    quiz.listAttemptsToMark(req.params.quizId),
  ]);
  res.render('quiz/marking', { course, courseId: req.params.id, quiz: q, attempts, pick });
});

exports.markAttempt = h(async (req, res) => {
  const [course, view] = await Promise.all([
    curriculum.getCourse(req.params.id),
    quiz.getAttemptForMarking(req.params.attemptId),
  ]);
  if (!view || !view.attempt) return res.status(404).render('error', { status: 404, message: 'Attempt not found' });
  res.render('quiz/mark', {
    course, courseId: req.params.id, quizId: req.params.quizId,
    attempt: view.attempt, quiz: view.quiz, pick, error: null,
  });
});

exports.submitMarking = h(async (req, res) => {
  await quiz.markEssays(req.params.attemptId, req.body.marks || {});
  res.redirect(`/courses/${req.params.id}/quizzes/${req.params.quizId}/marking`);
});

exports.deleteQuiz = h(async (req, res) => {
  await quiz.deleteQuiz(req.params.quizId);
  res.redirect(`/courses/${req.params.id}/quizzes`);
});
