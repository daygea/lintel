'use strict';

const svc = require('../../services/assessment.service');

const h = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

exports.listRubrics = h(async (req, res) => res.json({ rubrics: await svc.listRubrics() }));
exports.createRubric = h(async (req, res) => res.status(201).json({ rubric: await svc.createRubric(req.body) }));

exports.listAssessments = h(async (req, res) => res.json({ assessments: await svc.listAssessments(req.query.courseId ? { courseId: req.query.courseId } : {}) }));
exports.getAssessment = h(async (req, res) => res.json({ assessment: await svc.getAssessment(req.params.id) }));
exports.createAssessment = h(async (req, res) => res.status(201).json({ assessment: await svc.createAssessment(req.body) }));

exports.submit = h(async (req, res) =>
  res.status(201).json({ submission: await svc.submit({ ...req.body, userId: req.body.userId || req.user._id }) })
);
exports.listSubmissions = h(async (req, res) => res.json({ submissions: await svc.listSubmissions(req.params.assessmentId) }));

exports.assignAssessor = h(async (req, res) => res.status(201).json({ assignment: await svc.assignAssessor(req.body) }));

exports.grade = h(async (req, res) => res.status(201).json({ grade: await svc.grade(req.body) }));
exports.moderate = h(async (req, res) => res.status(201).json({ grade: await svc.moderate(req.body) }));
exports.grades = h(async (req, res) => res.json({ grades: await svc.gradesFor(req.params.submissionId), final: await svc.finalGrade(req.params.submissionId) }));
