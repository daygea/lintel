'use strict';

/**
 * Translate between our roles and the LTI 1.3 role vocabulary (IMS URNs). A tool
 * expects standard URNs, not our internal strings; a launch carries them, and a
 * roster returns them.
 *
 * Note 'elder' has no clean LTI equivalent — it is a spiritual authority, not an
 * LMS role — so it maps to Instructor for tool purposes (an elder who launches a
 * tool acts in a teaching capacity there). This is a lossy edge of the standard,
 * documented rather than hidden.
 */
const TO_LTI = {
  owner: 'http://purl.imsglobal.org/vocab/lis/v2/institution/person#Administrator',
  admin: 'http://purl.imsglobal.org/vocab/lis/v2/institution/person#Administrator',
  registrar: 'http://purl.imsglobal.org/vocab/lis/v2/institution/person#Staff',
  instructor: 'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
  assessor: 'http://purl.imsglobal.org/vocab/lis/v2/membership#Mentor',
  elder: 'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
  learner: 'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner',
};

const FROM_LTI = {
  'membership#Instructor': 'instructor',
  'membership#Learner': 'learner',
  'membership#Mentor': 'assessor',
};

const rolesToLti = (roles) => [...new Set((roles || []).map((r) => TO_LTI[r]).filter(Boolean))];

function ltiToRoles(urns) {
  const out = new Set();
  for (const urn of urns || []) {
    for (const [suffix, role] of Object.entries(FROM_LTI)) {
      if (urn.endsWith(suffix)) out.add(role);
    }
  }
  return [...out];
}

module.exports = { rolesToLti, ltiToRoles, TO_LTI };
