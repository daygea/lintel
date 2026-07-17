'use strict';

const gb = require('../../services/gradebook.service');
const quiz = require('../../services/quiz.service');
const { pick } = require('../../plugins/locale-map');

const h = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

exports.gradebook = h(async (req, res) => {
  const [schemes, quizzes] = await Promise.all([gb.listSchemes(), quiz.listQuizzes()]);
  res.render('gradebook/index', { schemes, quizzes, pick, locale: req.tenant.defaultLocale });
});
