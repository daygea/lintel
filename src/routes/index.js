'use strict';

const express = require('express');

const webAuth = require('../controllers/web/auth.controller');
const webTenant = require('../controllers/web/tenant.controller');
const webCurriculum = require('../controllers/web/curriculum.controller');

const apiAuth = require('../controllers/api/auth.controller');
const apiMembership = require('../controllers/api/membership.controller');
const apiCurriculum = require('../controllers/api/curriculum.controller');
const apiMedia = require('../controllers/api/media.controller');
const webMedia = require('../controllers/web/media.controller');
const apiEnrolment = require('../controllers/api/enrolment.controller');
const webEnrolment = require('../controllers/web/enrolment.controller');
const apiEligibility = require('../controllers/api/eligibility.controller');
const webEligibility = require('../controllers/web/eligibility.controller');
const apiLearner = require('../controllers/api/learner.controller');
const apiAssessment = require('../controllers/api/assessment.controller');
const webAssessment = require('../controllers/web/assessment.controller');
const apiGradebook = require('../controllers/api/gradebook.controller');
const webGradebook = require('../controllers/web/gradebook.controller');

const { requireUser, requireMember, requireRole } = require('../middleware/auth');
const { ROLES } = require('../lib/roles');

const router = express.Router();

/* ------------------------------------------------------------------ session */
router.get('/login', webAuth.showLogin);
router.post('/login', webAuth.login);
router.post('/logout', webAuth.logout);

router.post('/api/v1/auth/login', apiAuth.login);
router.post('/api/v1/auth/logout', apiAuth.logout);

/* --------------------------------------------------------------------- gates */
const staff = [requireUser, requireMember, requireRole(ROLES.OWNER, ROLES.ADMIN, ROLES.REGISTRAR)];
const author = [
  requireUser,
  requireMember,
  requireRole(ROLES.OWNER, ROLES.ADMIN, ROLES.INSTRUCTOR),
];

/* ------------------------------------------------------------------- people */
router.get('/', ...staff, webTenant.dashboard);
router.get('/api/v1/members', ...staff, apiMembership.list);
router.patch(
  '/api/v1/members/:id/roles',
  requireUser,
  requireMember,
  requireRole(ROLES.OWNER, ROLES.ADMIN),
  apiMembership.setRoles
);

/* --------------------------------------------------------------- curriculum */
router.get('/courses', ...author, webCurriculum.listCourses);
router.post('/courses', ...author, webCurriculum.createCourse);
router.get('/courses/search', ...author, webCurriculum.search);
router.get('/courses/:id', ...author, webCurriculum.showCourse);
router.post('/courses/:id/copy', ...author, webCurriculum.copyCourse);

router.get('/api/v1/programs', ...author, apiCurriculum.listPrograms);
router.post('/api/v1/programs', ...author, apiCurriculum.createProgram);

router.get('/api/v1/courses', ...author, apiCurriculum.listCourses);
router.post('/api/v1/courses', ...author, apiCurriculum.createCourse);
router.get('/api/v1/courses/search', ...author, apiCurriculum.search);
router.get('/api/v1/courses/:id', ...author, apiCurriculum.showCourse);
router.patch('/api/v1/courses/:id', ...author, apiCurriculum.updateCourse);
router.post('/api/v1/courses/:id/copy', ...author, apiCurriculum.copyCourse);

router.post('/api/v1/modules', ...author, apiCurriculum.createModule);
router.post('/api/v1/lessons', ...author, apiCurriculum.createLesson);
router.post('/api/v1/blocks', ...author, apiCurriculum.createBlock);
router.post('/api/v1/reorder', ...author, apiCurriculum.reorder);

/* -------------------------------------------------------------------- media */
router.get('/media', ...author, webMedia.listAssets);
router.get('/media/:id', ...author, webMedia.getAsset);

router.get('/api/v1/assets', ...author, apiMedia.listAssets);
router.post('/api/v1/assets/upload', ...author, apiMedia.beginUpload);
router.post('/api/v1/assets/:id/complete', ...author, apiMedia.completeUpload);
router.delete('/api/v1/assets/:id/upload', ...author, apiMedia.abandonUpload);
router.get('/api/v1/assets/:id', ...author, apiMedia.getAsset);
router.get('/api/v1/assets/:id/playback', ...author, apiMedia.playbackUrl);
router.patch('/api/v1/assets/:id/transcript', ...author, apiMedia.setTranscript);

/* -------------------------------------------------------------- enrolment */
router.get('/cohorts', ...staff, webEnrolment.listCohorts);
router.get('/cohorts/:id', ...staff, webEnrolment.showCohort);
router.post('/applications/:id/decide', ...staff, webEnrolment.decideApplication);

router.get('/api/v1/cohorts', ...staff, apiEnrolment.listCohorts);
router.post('/api/v1/cohorts', ...staff, apiEnrolment.createCohort);
router.post('/api/v1/cohorts/:id/open', ...staff, apiEnrolment.openCohort);
router.post('/api/v1/cohorts/:id/close', ...staff, apiEnrolment.closeCohort);

// Applying is done by the applicant themselves; admitted status not required.
router.post('/api/v1/applications', requireUser, requireMember, apiEnrolment.apply);
router.get('/api/v1/cohorts/:cohortId/applications', ...staff, apiEnrolment.listApplications);
router.post('/api/v1/applications/:id/decide', ...staff, apiEnrolment.decideApplication);

router.get('/api/v1/cohorts/:cohortId/enrollments', ...staff, apiEnrolment.listEnrollments);
router.patch('/api/v1/enrollments/:id/payment', ...staff, apiEnrolment.setPaymentState);

router.post('/api/v1/progress', requireUser, requireMember, apiEnrolment.markLesson);
router.get('/api/v1/enrollments/:enrollmentId/progress', requireUser, requireMember, apiEnrolment.progress);

router.get('/api/v1/cohorts/:cohortId/sessions', ...staff, apiEnrolment.listSessions);
router.post('/api/v1/sessions', ...staff, apiEnrolment.createSession);
router.post('/api/v1/attendance', ...staff, apiEnrolment.markAttendance);
router.get('/api/v1/sessions/:sessionId/attendance', ...staff, apiEnrolment.attendance);

router.get('/api/v1/notifications', ...staff, apiEnrolment.notifications);

/* --------------------------------------------------- eligibility (keystone) */
const issuer = [requireUser, requireMember, requireRole(ROLES.OWNER, ROLES.ADMIN, ROLES.REGISTRAR, ROLES.INSTRUCTOR, ROLES.ASSESSOR)];

router.get('/register', ...staff, webEligibility.register);
router.get('/policies', ...staff, webEligibility.policies);
router.get('/access-log', ...staff, webEligibility.accessLog);

router.get('/api/v1/attestation-types', ...staff, apiEligibility.listTypes);
router.post('/api/v1/attestation-types', ...staff, apiEligibility.createType);

router.post('/api/v1/attestations', ...issuer, apiEligibility.issue);
router.post('/api/v1/attestations/:id/revoke', ...issuer, apiEligibility.revoke);
router.get('/api/v1/attestations', ...staff, apiEligibility.listAttestations);
router.get('/api/v1/users/:userId/standings', ...staff, apiEligibility.currentFor);

router.get('/api/v1/policies', ...staff, apiEligibility.listPolicies);
router.post('/api/v1/policies', ...staff, apiEligibility.upsertPolicy);

router.get('/api/v1/lessons/:lessonId/access', requireUser, requireMember, apiEligibility.canAccess);
router.get('/api/v1/access-log', ...staff, apiEligibility.accessLog);

// Archive webhook. In production this must verify a signature; open in dev.
router.post('/api/v1/archive/consent-revoked', ...staff, apiEligibility.consentRevoked);

/* --------------------------------------------------------- learner (Sprint 4) */
const asLearner = [requireUser, requireMember];

router.get('/api/v1/lessons/:lessonId/view', ...asLearner, apiLearner.lesson);
router.get('/api/v1/lessons/:lessonId/pack', ...asLearner, apiLearner.pack);

router.get('/api/v1/push/key', ...asLearner, apiLearner.pushKey);
router.post('/api/v1/push/subscribe', ...asLearner, apiLearner.pushSubscribe);

/* ------------------------------------------------------ assessment (Sprint 5a) */
const assessor = [requireUser, requireMember, requireRole(ROLES.OWNER, ROLES.ADMIN, ROLES.INSTRUCTOR, ROLES.ASSESSOR, ROLES.ELDER)];

router.get('/assessments', ...assessor, webAssessment.list);
router.get('/assessments/:id', ...assessor, webAssessment.show);
router.get('/submissions/:submissionId/grade', ...assessor, webAssessment.gradeView);

router.get('/api/v1/rubrics', ...assessor, apiAssessment.listRubrics);
router.post('/api/v1/rubrics', ...assessor, apiAssessment.createRubric);

router.get('/api/v1/assessments', ...assessor, apiAssessment.listAssessments);
router.post('/api/v1/assessments', ...assessor, apiAssessment.createAssessment);
router.get('/api/v1/assessments/:id', ...assessor, apiAssessment.getAssessment);

// A learner submits their own work.
router.post('/api/v1/submissions', requireUser, requireMember, apiAssessment.submit);
router.get('/api/v1/assessments/:assessmentId/submissions', ...assessor, apiAssessment.listSubmissions);

router.post('/api/v1/assessor-assignments', ...assessor, apiAssessment.assignAssessor);
router.post('/api/v1/grades', ...assessor, apiAssessment.grade);
router.post('/api/v1/grades/moderate', ...assessor, apiAssessment.moderate);
router.get('/api/v1/submissions/:submissionId/grades', ...assessor, apiAssessment.grades);

/* ------------------------------------------------- gradebook & quiz (Sprint 5b) */
router.get('/gradebook', ...assessor, webGradebook.gradebook);

router.get('/api/v1/grade-schemes', ...assessor, apiGradebook.listSchemes);
router.post('/api/v1/grade-schemes', ...assessor, apiGradebook.upsertScheme);

router.get('/api/v1/courses/:courseId/line-items', ...assessor, apiGradebook.listLineItems);
router.post('/api/v1/line-items', ...assessor, apiGradebook.createLineItem);
router.put('/api/v1/scores', ...assessor, apiGradebook.putScore);
router.get('/api/v1/courses/:courseId/grade', ...assessor, apiGradebook.compute);
router.get('/api/v1/users/:userId/transcript', ...assessor, apiGradebook.transcript);

router.get('/api/v1/quizzes', ...assessor, apiGradebook.listQuizzes);
router.post('/api/v1/quizzes', ...assessor, apiGradebook.createQuiz);
router.get('/api/v1/quizzes/:id/present', requireUser, requireMember, apiGradebook.presentQuiz);
router.post('/api/v1/quizzes/:id/submit', requireUser, requireMember, apiGradebook.submitQuiz);

module.exports = router;
