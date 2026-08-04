'use strict';

const gb = require('../../services/gradebook.service');
const quiz = require('../../services/quiz.service');

const h = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

/* schemes */
exports.listSchemes = h(async (req, res) => res.json({ schemes: await gb.listSchemes() }));
exports.upsertScheme = h(async (req, res) => res.status(201).json({ scheme: await gb.upsertScheme(req.body) }));

/* line items */
exports.listLineItems = h(async (req, res) => res.json({ lineItems: await gb.listLineItems(req.params.courseId) }));
exports.createLineItem = h(async (req, res) => res.status(201).json({ lineItem: await gb.createLineItem(req.body) }));

/* scores */
exports.putScore = h(async (req, res) => res.json({ score: await gb.putScore(req.body) }));
exports.compute = h(async (req, res) => res.json(await gb.computeForLearner({ courseId: req.params.courseId, userId: req.query.userId || req.user._id, schemeSlug: req.query.scheme })));
exports.transcript = h(async (req, res) => res.json(await gb.transcriptFor(req.params.userId || req.user._id)));

/* quizzes */
exports.listQuizzes = h(async (req, res) => res.json({ quizzes: await quiz.listQuizzes(req.query.courseId ? { courseId: req.query.courseId } : {}) }));
exports.createQuiz = h(async (req, res) => res.status(201).json({ quiz: await quiz.createQuiz(req.body) }));
exports.presentQuiz = h(async (req, res) => res.json({ ...await quiz.presentFor(req.params.id), csrfToken: req.session.csrfToken }));
exports.submitQuiz = h(async (req, res) => res.status(201).json({ attempt: await quiz.submit({ ...req.body, quizId: req.params.id, userId: req.user._id }) }));
