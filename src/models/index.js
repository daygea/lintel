'use strict';

module.exports = {
  // Platform-scoped
  Tenant: require('./tenant'),
  User: require('./user'),

  // Tenant-scoped
  Membership: require('./membership'),
  AuditLog: require('./audit-log'),

  // Curriculum (Sprint 1)
  Program: require('./program'),
  Course: require('./course'),
  Module: require('./module'),
  Lesson: require('./lesson'),
  ContentBlock: require('./content-block'),

  // Media & jobs (Sprint 1)
  Asset: require('./asset'),
  Job: require('./job'),

  // Enrolment (Sprint 2)
  Cohort: require('./cohort'),
  Application: require('./application'),
  Enrollment: require('./enrollment'),
  LessonProgress: require('./lesson-progress'),
  Group: require('./group'),
  Session: require('./session'),
  Attendance: require('./attendance'),
  Notification: require('./notification'),

  // Eligibility & access (Sprint 3 — the keystone)
  AttestationType: require('./attestation-type'),
  Attestation: require('./attestation'),
  EligibilityPolicy: require('./eligibility-policy'),
  ContentPolicy: require('./content-policy'),
  AccessLog: require('./access-log'),

  // Learner PWA (Sprint 4)
  PushSubscription: require('./push-subscription'),

  // Assessment (Sprint 5a)
  Rubric: require('./rubric'),
  Assessment: require('./assessment'),
  Submission: require('./submission'),
  AssessorAssignment: require('./assessor-assignment'),
  Grade: require('./grade'),

  // Gradebook & quiz (Sprint 5b)
  GradeScheme: require('./grade-scheme'),
  LineItem: require('./line-item'),
  Score: require('./score'),
  Quiz: require('./quiz'),
  QuizAttempt: require('./quiz-attempt'),

  // Commerce (Sprint 6)
  FeeSchedule: require('./fee-schedule'),
  Invoice: require('./invoice'),
  Payment: require('./payment'),

  // Credentials (Sprint 7)
  CredentialTemplate: require('./credential-template'),
  Credential: require('./credential'),

  // Institutional integration (Sprint 8)
  SsoConnection: require('./sso-connection'),
  ExternalIdentity: require('./external-identity'),

  // LTI 1.3 Advantage (Sprint 9)
  LtiTool: require('./lti-tool'),
  LtiLaunch: require('./lti-launch'),

  // Institution directory (Sprint 10)
  DirectoryListing: require('./directory-listing'),

  // Self-service onboarding (Sprint 12)
  OnboardingToken: require('./onboarding-token'),
  TenantApplication: require('./tenant-application'),

  // Platform console (Sprint 13)
  PlatformAuditLog: require('./platform-audit-log'),
  PlatformPayment: require('./platform-payment'),

  // Abuse response + break-glass (Sprint 14)
  AbuseReport: require('./abuse-report'),
  BreakglassGrant: require('./breakglass-grant'),
};
