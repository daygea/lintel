'use strict';

/**
 * Feature registry — the single source of truth for what the platform can do.
 * Nothing may check a feature name that is not declared here.
 */
const FEATURES = {
  CURRICULUM: { key: 'curriculum', label: 'Courses and lessons', sprint: 1 },
  MEDIA: { key: 'media', label: 'Audio and video', sprint: 1 },
  ENROLMENT: { key: 'enrolment', label: 'Cohorts and enrolment', sprint: 2 },
  NOTIFICATIONS: { key: 'notifications', label: 'Email, SMS and WhatsApp', sprint: 2 },
  ELIGIBILITY: { key: 'eligibility', label: 'Attestations and access policy', sprint: 3 },
  OFFLINE: { key: 'offline', label: 'Offline lessons', sprint: 4 },
  ASSESSMENT: { key: 'assessment', label: 'Oral and written assessment', sprint: 5 },
  GRADEBOOK: { key: 'gradebook', label: 'Gradebook and transcripts', sprint: 5 },
  COMMERCE: { key: 'commerce', label: 'Fees and payments', sprint: 6 },
  CREDENTIALS: { key: 'credentials', label: 'Certificates and verification', sprint: 7 },
  SSO: { key: 'sso', label: 'Single sign-on', sprint: 8 },
  LTI: { key: 'lti', label: 'LTI 1.3 Advantage', sprint: 9 },
  DIRECTORY: { key: 'directory', label: 'Public institution page', sprint: 10 },
  CATALOG: { key: 'catalog', label: 'Public course catalog', sprint: 11 },
};

const ALL = Object.values(FEATURES).map((f) => f.key);
const isKnown = (key) => ALL.includes(key);

module.exports = { FEATURES, ALL, isKnown };
