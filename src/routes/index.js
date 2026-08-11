'use strict';

const express = require('express');

const webAuth = require('../controllers/web/auth.controller');
const webTenant = require('../controllers/web/tenant.controller');
const webInvite = require('../controllers/web/invite.controller');
const webSecurity = require('../controllers/web/security.controller');
const webSettings = require('../controllers/web/settings.controller');
const webBilling = require('../controllers/web/billing.controller');
const webApply = require('../controllers/web/apply.controller');
const webFees = require('../controllers/web/fees.controller');
const webReport = require('../controllers/web/report.controller');
const apiInvite = require('../controllers/api/invite.controller');
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
const webQuiz = require('../controllers/web/quiz.controller');
const apiCommerce = require('../controllers/api/commerce.controller');
const apiCredential = require('../controllers/api/credential.controller');
const webCredential = require('../controllers/web/credential.controller');
const webSignup = require('../controllers/web/signup.controller');
const webDirectoryAdmin = require('../controllers/web/directory-admin.controller');
const apiSso = require('../controllers/api/sso.controller');
const apiLti = require('../controllers/api/lti.controller');
const apiDirectory = require('../controllers/api/directory.controller');
const webCommerce = require('../controllers/web/commerce.controller');
const express2 = require('express');
const commerceService = require('../services/commerce');

const { requireUser, requireMember, requireRole } = require('../middleware/auth');
const { requireFeature } = require('../middleware/require-feature');
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
const assessor = [requireUser, requireMember, requireRole(ROLES.OWNER, ROLES.ADMIN, ROLES.INSTRUCTOR, ROLES.ASSESSOR, ROLES.ELDER)];

/* ------------------------------------------------------------------- people */
router.get('/', requireUser, requireMember, webTenant.dashboard);
router.get('/api/v1/members', ...staff, apiMembership.list);
router.post('/members/:id/admit', ...staff, webTenant.admit);
router.post('/api/v1/members/:id/admit', ...staff, apiMembership.admit);
router.get('/members/invite', ...staff, webInvite.showInvite);
router.post('/members/invite', ...staff, webInvite.submitInvite);
router.post('/api/v1/members/invite', ...staff, apiInvite.invite);
router.get('/security', requireUser, webSecurity.show);
router.post('/security/mfa/begin', requireUser, webSecurity.beginMfa);
router.post('/security/mfa/confirm', requireUser, webSecurity.confirmMfa);
router.post('/security/mfa/disable', requireUser, webSecurity.disableMfa);
router.get('/settings/branding', ...staff, webSettings.showBranding);
router.post('/settings/branding', ...staff, webSettings.saveBranding);
router.get('/settings/billing', ...staff, webBilling.show);
router.post('/settings/billing/subscribe', ...staff, webBilling.subscribe);
router.post('/settings/billing/payouts', ...staff, webBilling.savePayouts);
router.get('/report', requireUser, requireMember, webReport.show);
router.post('/report', requireUser, requireMember, webReport.submit);
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
router.post('/courses/:id/modules', ...author, webCurriculum.createModule);
router.post('/courses/:id/cover', ...author, webCurriculum.setCover);
router.post('/courses/:id/modules/:moduleId/delete', ...author, webCurriculum.deleteModule);
router.post('/courses/:id/delete', ...author, webCurriculum.deleteCourse);
router.post('/courses/:id/lessons', ...author, webCurriculum.createLesson);
router.get('/courses/:id/lessons/:lessonId', ...author, webCurriculum.showLesson);
router.post('/courses/:id/lessons/:lessonId/blocks', ...author, webCurriculum.createBlock);
router.post('/courses/:id/lessons/:lessonId/policy', ...author, webCurriculum.setLessonPolicy);
router.post('/courses/:id/lessons/:lessonId/delete', ...author, webCurriculum.deleteLesson);
router.get('/courses/:id/quizzes', ...assessor, requireFeature('assessment'), webQuiz.list);
router.post('/courses/:id/quizzes', ...assessor, requireFeature('assessment'), webQuiz.create);
router.get('/courses/:id/quizzes/:quizId', ...assessor, requireFeature('assessment'), webQuiz.edit);
router.post('/courses/:id/quizzes/:quizId/questions', ...assessor, requireFeature('assessment'), webQuiz.addQuestion);
router.post('/courses/:id/quizzes/:quizId/questions/:qid/delete', ...assessor, requireFeature('assessment'), webQuiz.removeQuestion);
router.post('/courses/:id/quizzes/:quizId/delete', ...assessor, requireFeature('assessment'), webQuiz.deleteQuiz);
router.post('/courses/:id/quizzes/:quizId/status', ...assessor, requireFeature('assessment'), webQuiz.setStatus);
router.get('/courses/:id/quizzes/:quizId/marking', ...assessor, requireFeature('assessment'), webQuiz.marking);
router.get('/courses/:id/quizzes/:quizId/attempts/:attemptId', ...assessor, requireFeature('assessment'), webQuiz.markAttempt);
router.post('/courses/:id/quizzes/:quizId/attempts/:attemptId/mark', ...assessor, requireFeature('assessment'), webQuiz.submitMarking);

router.get('/api/v1/programs', ...author, apiCurriculum.listPrograms);
router.post('/api/v1/programs', ...author, apiCurriculum.createProgram);

router.get('/api/v1/courses', ...author, apiCurriculum.listCourses);
router.post('/api/v1/courses', ...author, apiCurriculum.createCourse);
router.get('/api/v1/courses/search', ...author, apiCurriculum.search);
router.get('/api/v1/courses/:id', ...author, apiCurriculum.showCourse);
router.patch('/api/v1/courses/:id', ...author, apiCurriculum.updateCourse);
router.post('/api/v1/courses/:id/copy', ...author, apiCurriculum.copyCourse);

router.post('/api/v1/modules', ...author, apiCurriculum.createModule);
router.delete('/api/v1/modules/:id', ...author, apiCurriculum.deleteModule);
router.delete('/api/v1/courses/:id', ...author, apiCurriculum.deleteCourse);
router.post('/api/v1/lessons', ...author, apiCurriculum.createLesson);
router.post('/api/v1/blocks', ...author, apiCurriculum.createBlock);
router.get('/api/v1/lessons/:lessonId', ...author, apiCurriculum.showLesson);
router.post('/api/v1/lessons/:lessonId/policy', ...author, apiCurriculum.setLessonPolicy);
router.delete('/api/v1/lessons/:lessonId', ...author, apiCurriculum.deleteLesson);
router.post('/api/v1/reorder', ...author, apiCurriculum.reorder);

/* -------------------------------------------------------------------- media */
router.get('/media', ...author, webMedia.listAssets);
router.get('/media/upload', ...author, webMedia.uploadPage);
router.get('/media/:id', ...author, webMedia.getAsset);
router.post('/media/:id/rename', ...author, webMedia.rename);
router.post('/media/:id/delete', ...author, webMedia.remove);

router.get('/api/v1/assets', ...author, apiMedia.listAssets);
router.post('/api/v1/assets/upload', ...author, apiMedia.beginUpload);
router.post('/api/v1/assets/:id/complete', ...author, apiMedia.completeUpload);
router.delete('/api/v1/assets/:id/upload', ...author, apiMedia.abandonUpload);
router.get('/api/v1/assets/:id', ...author, apiMedia.getAsset);
router.get('/api/v1/assets/:id/playback', ...author, apiMedia.playbackUrl);
router.patch('/api/v1/assets/:id/transcript', ...author, apiMedia.setTranscript);
router.patch('/api/v1/assets/:id/rename', ...author, apiMedia.rename);
router.delete('/api/v1/assets/:id', ...author, apiMedia.deleteAsset);

/* -------------------------------------------------------------- enrolment */
router.get('/cohorts', ...staff, webEnrolment.listCohorts);
router.get('/cohorts/:id', ...staff, webEnrolment.showCohort);
router.post('/cohorts', ...staff, webEnrolment.createCohort);
router.post('/cohorts/:id/open', ...staff, webEnrolment.openCohort);
router.post('/cohorts/:id/close', ...staff, webEnrolment.closeCohort);
router.post('/cohorts/:id/delete', ...staff, webEnrolment.deleteCohort);
router.post('/cohorts/:id/sessions', ...staff, webEnrolment.createSession);
router.post('/cohorts/:id/attendance', ...staff, webEnrolment.markAttendance);
router.post('/applications/:id/decide', ...staff, webEnrolment.decideApplication);
router.post('/cohorts/:id/enrol', ...staff, webEnrolment.enrolMember);

router.get('/api/v1/cohorts', ...staff, apiEnrolment.listCohorts);
router.post('/api/v1/cohorts', ...staff, apiEnrolment.createCohort);
router.delete('/api/v1/cohorts/:id', ...staff, apiEnrolment.deleteCohort);
router.post('/api/v1/cohorts/:id/open', ...staff, apiEnrolment.openCohort);
router.post('/api/v1/cohorts/:id/close', ...staff, apiEnrolment.closeCohort);

// Applying is done by the applicant themselves; admitted status not required.
router.post('/api/v1/applications', requireUser, requireMember, apiEnrolment.apply);
router.get('/apply', requireUser, requireMember, webApply.show);
router.post('/apply', requireUser, requireMember, webApply.submit);
router.get('/my/fees', requireUser, requireMember, webFees.mine);
router.post('/my/fees/:invoiceId/pay', requireUser, requireMember, requireFeature('commerce'), webFees.pay);
router.get('/api/v1/cohorts/:cohortId/applications', ...staff, apiEnrolment.listApplications);
router.post('/api/v1/applications/:id/decide', ...staff, apiEnrolment.decideApplication);
router.post('/api/v1/cohorts/:id/enrol', ...staff, apiEnrolment.enrol);

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
router.post('/register/standings', ...staff, webEligibility.createStanding);
router.post('/register/attestations', ...staff, webEligibility.issueAttestation);
router.post('/register/attestations/:id/revoke', ...staff, webEligibility.revokeAttestation);
router.get('/policies', ...staff, webEligibility.policies);
router.post('/policies', ...staff, webEligibility.createPolicy);
router.get('/access-log', ...staff, webEligibility.accessLog);

router.get('/api/v1/attestation-types', ...staff, apiEligibility.listTypes);
router.post('/api/v1/attestation-types', ...staff, apiEligibility.createType);

router.post('/api/v1/attestations', ...issuer, apiEligibility.issue);
router.post('/api/v1/attestations/:id/revoke', ...issuer, apiEligibility.revoke);
router.get('/api/v1/attestations', ...staff, apiEligibility.listAttestations);
router.get('/api/v1/users/:userId/standings', ...staff, apiEligibility.currentFor);

router.get('/api/v1/policies', ...staff, requireFeature('eligibility'), apiEligibility.listPolicies);
router.post('/api/v1/policies', ...staff, requireFeature('eligibility'), apiEligibility.upsertPolicy);

router.get('/api/v1/lessons/:lessonId/access', requireUser, requireMember, apiEligibility.canAccess);
router.get('/api/v1/access-log', ...staff, apiEligibility.accessLog);

// Archive webhook. In production this must verify a signature; open in dev.
router.post('/api/v1/archive/consent-revoked', ...staff, apiEligibility.consentRevoked);

/* --------------------------------------------------------- learner (Sprint 4) */
const asLearner = [requireUser, requireMember];

router.get('/api/v1/me/learning', ...asLearner, apiLearner.myLearning);

router.get('/api/v1/lessons/:lessonId/view', ...asLearner, apiLearner.lesson);
router.get('/api/v1/lessons/:lessonId/pack', ...asLearner, apiLearner.pack);

router.get('/api/v1/push/key', ...asLearner, apiLearner.pushKey);
router.post('/api/v1/push/subscribe', ...asLearner, apiLearner.pushSubscribe);

/* ------------------------------------------------------ assessment (Sprint 5a) */

router.get('/assessments', ...assessor, webAssessment.list);
router.get('/assessments/:id', ...assessor, webAssessment.show);
router.post('/rubrics', ...assessor, webAssessment.createRubric);
router.post('/assessments', ...assessor, webAssessment.createAssessment);
router.get('/submissions/:submissionId/grade', ...assessor, webAssessment.gradeView);
router.post('/submissions/:submissionId/grade', ...assessor, webAssessment.submitGrade);

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
router.post('/gradebook/schemes', ...assessor, webGradebook.createScheme);
router.post('/gradebook/line-items', ...assessor, webGradebook.createLineItem);
router.post('/gradebook/scores', ...assessor, webGradebook.putScore);

router.get('/api/v1/grade-schemes', ...assessor, apiGradebook.listSchemes);
router.post('/api/v1/grade-schemes', ...assessor, apiGradebook.upsertScheme);

router.get('/api/v1/courses/:courseId/line-items', ...assessor, apiGradebook.listLineItems);
router.post('/api/v1/line-items', ...assessor, apiGradebook.createLineItem);
router.put('/api/v1/scores', ...assessor, apiGradebook.putScore);
router.get('/api/v1/courses/:courseId/grade', ...assessor, apiGradebook.compute);
router.get('/api/v1/users/:userId/transcript', ...assessor, apiGradebook.transcript);

router.get('/api/v1/quizzes', ...assessor, requireFeature('assessment'), apiGradebook.listQuizzes);
router.post('/api/v1/quizzes', ...assessor, requireFeature('assessment'), apiGradebook.createQuiz);
router.delete('/api/v1/quizzes/:id', ...assessor, requireFeature('assessment'), apiGradebook.deleteQuiz);
router.get('/api/v1/quizzes/:id/present', requireUser, requireMember, requireFeature('assessment'), apiGradebook.presentQuiz);
router.post('/api/v1/quizzes/:id/submit', requireUser, requireMember, requireFeature('assessment'), apiGradebook.submitQuiz);

/* ------------------------------------------------------- commerce (Sprint 6) */
router.get('/fees', ...staff, requireFeature('commerce'), webCommerce.fees);
router.post('/fees/schedules', ...staff, requireFeature('commerce'), webCommerce.createSchedule);
router.post('/fees/payments', ...staff, requireFeature('commerce'), webCommerce.recordPayment);
router.post('/invoices', ...staff, webCommerce.raiseInvoice);
router.get('/invoices/:id', ...staff, webCommerce.showInvoice);
router.post('/invoices/:id/payments', ...staff, webCommerce.recordInvoicePayment);
router.post('/invoices/:id/pay', ...staff, webCommerce.payInvoice);
router.post('/invoices/:id/waive', ...staff, webCommerce.waiveInvoice);
router.post('/invoices/:id/refund', ...staff, webCommerce.refundInvoice);

router.get('/api/v1/fee-schedules', ...staff, apiCommerce.listSchedules);
router.post('/api/v1/fee-schedules', ...staff, apiCommerce.createSchedule);
router.post('/api/v1/invoices', ...staff, requireFeature('commerce'), apiCommerce.raiseInvoice);
router.get('/api/v1/enrollments/:enrollmentId/invoice', ...staff, requireFeature('commerce'), apiCommerce.invoice);
router.post('/api/v1/payments/begin', requireUser, requireMember, requireFeature('commerce'), apiCommerce.beginPayment);
router.post('/api/v1/payments/confirm-transfer', ...staff, requireFeature('commerce'), apiCommerce.confirmTransfer);
router.post('/api/v1/invoices/waive', ...staff, requireFeature('commerce'), apiCommerce.waive);
router.get('/api/v1/invoices/:invoiceId/payments', ...staff, requireFeature('commerce'), apiCommerce.payments);

/*
 * Paystack webhook. Public (no session), signature-verified, and needs the RAW
 * body — so it mounts its own raw parser BEFORE the JSON body is consumed. The
 * signature check is the auth; do not add requireUser here.
 */
router.post(
  '/api/v1/webhooks/paystack',
  express2.raw({ type: '*/*' }),
  async (req, res, next) => {
    try {
      const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);
      const parsed = JSON.parse(rawBody);
      // A webhook has no tenant context from a session; the reference carries the
      // tenantId, and recordPayment resolves the invoice within that tenant.
      const { runWithTenant } = require('../lib/context');
      const tenantId = String(parsed.data?.reference || '').split('_')[0];
      if (!tenantId) return res.status(400).json({ error: 'bad reference' });
      const result = await runWithTenant(tenantId, null, () =>
        commerceService.handleWebhook({
          providerKey: 'paystack',
          rawBody,
          signature: req.get('x-paystack-signature'),
          body: parsed,
        })
      );
      res.json({ ok: true, ...result, payment: undefined, invoice: undefined });
    } catch (err) {
      next(err);
    }
  }
);

/* ----------------------------------------------------- credentials (Sprint 7) */
router.get('/credentials', ...staff, requireFeature('credentials'), webCredential.index);
router.post('/credentials/templates', ...staff, requireFeature('credentials'), webCredential.createTemplate);
router.post('/credentials/issue', ...staff, requireFeature('credentials'), webCredential.issue);
router.post('/credentials/:id/revoke', ...staff, requireFeature('credentials'), webCredential.revoke);
router.get('/api/v1/credential-templates', ...staff, apiCredential.listTemplates);
router.post('/api/v1/credential-templates', ...staff, apiCredential.createTemplate);
router.post('/api/v1/credentials', ...staff, apiCredential.issue);
router.post('/api/v1/credentials/:id/revoke', ...staff, apiCredential.revoke);
router.get('/api/v1/users/:userId/credentials', ...staff, apiCredential.listFor);

// Full tenant data export — "can we leave with our material?" answered yes.
router.get('/api/v1/export', ...staff, apiCredential.exportTenant);

/* --------------------------------------- institutional integration (Sprint 8) */
router.get('/api/v1/sso/connections', ...staff, apiSso.listConnections);
router.post('/api/v1/sso/connections', ...staff, apiSso.createConnection);
// begin + callback are public-ish: the user is not yet logged in. They resolve a
// connection by id and rely on the adapter's verification, not a session.
router.get('/api/v1/sso/:id/begin', apiSso.begin);
router.post('/api/v1/sso/:id/callback', apiSso.callback);

router.post('/api/v1/sis/import', ...staff, apiSso.sisImport);

/* ------------------------------------------------ LTI 1.3 Advantage (Sprint 9) */
router.get('/api/v1/lti/tools', ...staff, apiLti.listTools);
router.post('/api/v1/lti/tools', ...staff, apiLti.registerTool);
router.post('/api/v1/lti/:toolId/launch', requireUser, requireMember, apiLti.launch);

// Advantage service callbacks — the TOOL calls these, authed by its bearer token
// (verify.js checks it), not by a session. Public at the route layer by design.
router.post('/api/v1/lti/:toolId/lineitems/:lineItemId/scores', apiLti.receiveScore);
router.get('/api/v1/lti/:toolId/lineitems/:lineItemId/results', apiLti.readResults);
router.get('/api/v1/lti/:toolId/courses/:courseId/members', apiLti.membership);

/* ------------------------------------------------ institution directory (Sprint 10) */
router.get('/api/v1/directory-listing', ...staff, requireFeature('directory'), apiDirectory.get);
router.put('/api/v1/directory-listing', ...staff, requireFeature('directory'), apiDirectory.upsert);
router.post('/api/v1/directory-listing/publish', ...staff, requireFeature('directory'), apiDirectory.publish);
router.post('/api/v1/directory-listing/unpublish', ...staff, requireFeature('directory'), apiDirectory.unpublish);

/* ---- Directory listing management (the institution's own public presence) ---- */
router.get('/directory-listing', ...staff, requireFeature('directory'), webDirectoryAdmin.show);
router.post('/directory-listing', ...staff, requireFeature('directory'), webDirectoryAdmin.save);
router.post('/directory-listing/publish', ...staff, requireFeature('directory'), webDirectoryAdmin.publish);
router.post('/directory-listing/unpublish', ...staff, requireFeature('directory'), webDirectoryAdmin.unpublish);

/* ---- Learner self-registration into this institution (Sprint 12) ---- */
router.get('/join', webSignup.registerForm);
router.post('/join', webSignup.registerSubmit);

/* A signed-in user whose membership is still pending admission lands here —
   a truthful "awaiting admission" page, not a 403 that says they aren't a member. */
router.get('/pending', requireUser, webAuth.pending);

module.exports = router;
