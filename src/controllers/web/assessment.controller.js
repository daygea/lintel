'use strict';

const svc = require('../../services/assessment.service');
const curriculum = require('../../services/curriculum.service');
const { pick } = require('../../plugins/locale-map');

const h = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

exports.list = h(async (req, res) => {
  const [assessments, rubrics, courses] = await Promise.all([
    svc.listAssessments(),
    svc.listRubrics(),
    curriculum.listCourses().catch(() => []),
  ]);
  res.render('assessment/list', { assessments, rubrics, courses, pick, locale: req.tenant.defaultLocale, error: null });
});

exports.show = h(async (req, res) => {
  const [assessment, submissions] = await Promise.all([
    svc.getAssessment(req.params.id),
    svc.listSubmissions(req.params.id),
  ]);
  res.render('assessment/show', { assessment, submissions, pick, locale: req.tenant.defaultLocale });
});

exports.createRubric = h(async (req, res) => {
  // Criteria come as parallel arrays: criterion label + up to N levels each.
  const critLabels = [].concat(req.body.criterion_label || []).filter(function (x) { return x && x.trim(); });
  const criteria = critLabels.map(function (label, i) {
    const levelLabels = [].concat(req.body['level_label_' + i] || []);
    const levelPoints = [].concat(req.body['level_points_' + i] || []);
    const levels = levelLabels
      .map(function (ll, j) { return { label: locObj(ll, req.tenant), points: Number(levelPoints[j] || 0) }; })
      .filter(function (l) { return l.label && Object.keys(l.label).length; });
    return { label: locObj(label, req.tenant), levels: levels };
  });
  await svc.createRubric({ title: locObj(req.body.title, req.tenant), criteria: criteria });
  res.redirect('/assessments');
});

exports.createAssessment = h(async (req, res) => {
  await svc.createAssessment({
    title: localeFromForm(req.body, 'title', req.tenant.locales),
    courseId: req.body.courseId || undefined,
    type: req.body.type || 'oral',
    rubricId: req.body.rubricId || undefined,
    requiresModeration: req.body.requiresModeration === 'on',
  });
  res.redirect('/assessments');
});

exports.submitGrade = h(async (req, res) => {
  // criterionScores: parallel arrays of criterionId / levelId / points
  const critIds = [].concat(req.body.criterionId || []);
  const levelIds = [].concat(req.body.levelId || []);
  const points = [].concat(req.body.points || []);
  const criterionScores = critIds.map(function (cid, i) {
    return { criterionId: cid, levelId: levelIds[i], points: Number(points[i] || 0) };
  }).filter(function (cs) { return cs.criterionId && cs.levelId; });
  await svc.grade({ submissionId: req.params.submissionId, criterionScores: criterionScores, feedback: req.body.feedback });
  res.redirect(`/assessments/${req.body.assessmentId}`);
});

exports.gradeView = h(async (req, res) => {
  const submission = await svc.getSubmission(req.params.submissionId);
  const assessment = submission ? await svc.getAssessment(submission.assessmentId) : null;
  const rubric = assessment && assessment.rubricId ? await svc.getRubric(assessment.rubricId) : null;
  const grades = await svc.gradesFor(req.params.submissionId);
  const final = await svc.finalGrade(req.params.submissionId);
  res.render('assessment/grade', {
    submissionId: req.params.submissionId,
    assessmentId: assessment ? assessment._id : null,
    rubric, grades, final, pick, locale: req.tenant.defaultLocale,
  });
});

function localeFromForm(body, base, locales) {
  const map = {};
  for (const loc of locales) { const v = body[`${base}_${loc}`]; if (v) map[loc] = v; }
  return map;
}
/** Wrap a single plain string as a locale map under the tenant's default locale. */
function locObj(str, tenant) {
  if (!str || !str.trim()) return {};
  return { [tenant.defaultLocale]: str.trim() };
}
