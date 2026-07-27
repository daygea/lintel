'use strict';

const gb = require('../../services/gradebook.service');
const { ValidationError } = require('../../lib/errors');
const curriculum = require('../../services/curriculum.service');
const quiz = require('../../services/quiz.service');
const { pick } = require('../../plugins/locale-map');

const h = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

exports.gradebook = h(async (req, res) => {
  const [schemes, quizzes, courses, lineItems] = await Promise.all([
    gb.listSchemes(),
    quiz.listQuizzes(),
    curriculum.listCourses().catch(() => []),
    gb.listLineItems ? gb.listLineItems() : [],
  ]);
  res.render('gradebook/index', { schemes, quizzes, courses, lineItems, pick, locale: req.tenant.defaultLocale, error: null });
});

exports.createScheme = h(async (req, res) => {
  const loc = req.tenant.defaultLocale;
  // Categories: the weighted buckets (recitation, oral-exam, ...).
  const catKeys = [].concat(req.body.cat_key || []);
  const catLabels = [].concat(req.body.cat_label || []);
  const catWeights = [].concat(req.body.cat_weight || []);
  const categories = catKeys
    .map((key, i) => ({ key, label: { [loc]: catLabels[i] || key }, weight: Number(catWeights[i] || 1) }))
    .filter((c) => c.key && c.key.trim());
  // Bands: grade thresholds (Distinction >= 70, ...). No key, no weight.
  const bandLabels = [].concat(req.body.band_label || []);
  const bandMins = [].concat(req.body.band_min || []);
  const bands = bandLabels
    .map((label, i) => ({ label: { [loc]: label }, minPercent: Number(bandMins[i] || 0) }))
    .filter((b) => b.label[loc] && b.label[loc].trim());
  await gb.upsertScheme({
    slug: req.body.slug,
    label: { [loc]: req.body.label },
    categories,
    bands,
    passPercent: req.body.passPercent ? Number(req.body.passPercent) : 50,
  });
  res.redirect('/gradebook');
});

exports.createLineItem = h(async (req, res) => {
  await gb.createLineItem({
    courseId: req.body.courseId,
    label: { [req.tenant.defaultLocale]: req.body.label },
    category: req.body.category,
    maxPoints: req.body.maxPoints ? Number(req.body.maxPoints) : 100,
  });
  res.redirect('/gradebook');
});

exports.putScore = h(async (req, res) => {
  const points = Number(req.body.points);
  if (!Number.isFinite(points)) throw new ValidationError('Enter a valid score.');
  await gb.putScore({
    lineItemId: req.body.lineItemId,
    userId: req.body.userId,
    points,
  });
  res.redirect('/gradebook');
});
