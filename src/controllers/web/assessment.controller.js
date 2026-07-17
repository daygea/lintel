'use strict';

const svc = require('../../services/assessment.service');
const { pick } = require('../../plugins/locale-map');

const h = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

exports.list = h(async (req, res) => {
  const assessments = await svc.listAssessments();
  res.render('assessment/list', { assessments, pick, locale: req.tenant.defaultLocale });
});

exports.show = h(async (req, res) => {
  const [assessment, submissions] = await Promise.all([
    svc.getAssessment(req.params.id),
    svc.listSubmissions(req.params.id),
  ]);
  res.render('assessment/show', { assessment, submissions, pick, locale: req.tenant.defaultLocale });
});

exports.gradeView = h(async (req, res) => {
  const grades = await svc.gradesFor(req.params.submissionId);
  const final = await svc.finalGrade(req.params.submissionId);
  res.render('assessment/grade', { submissionId: req.params.submissionId, grades, final, pick, locale: req.tenant.defaultLocale });
});
