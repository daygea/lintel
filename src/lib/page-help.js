'use strict';

/**
 * Per-page help registry.
 *
 * Every admin and console page carries a "?" in its top bar that opens a short
 * panel: what this page is for, and what you can actually do on it. The copy
 * lives HERE, in one place, keyed by the page's `nav` value — so the two layout
 * heads (src/views/layouts/head.ejs for an institution's admin, and
 * src/views/console/head.ejs for the platform console) each look up their own
 * namespace and render the panel if an entry exists.
 *
 * This is distinct from the full /help and /console/help guide pages: that is a
 * searchable library you go to; this is a one-glance "what am I looking at"
 * for the page already in front of you.
 *
 * Shape of an entry:
 *   title   — the page's name, as the panel heading
 *   what    — one or two plain sentences: the purpose of the page
 *   actions — the key things a person does here (2–4 items)
 *   tip     — optional single "good to know" caveat
 *
 * Keys MUST match the `nav` value each view sets. The 'help' pages are
 * intentionally absent — a help button on the help page is noise.
 */

const tenant = {
  members: {
    title: 'Members',
    what: 'Everyone who belongs to this institution, and the standing each one holds. This is the roster you admit people into and manage from.',
    actions: [
      'Admit a new member and set the name shown on their records',
      'See each member’s role and whether their place is active, pending, or suspended',
      'Open a member to adjust their role or suspend their access',
    ],
    tip: 'The name you set here is what appears on this institution’s pages — it is kept separate from the person’s own account name.',
  },
  register: {
    title: 'Attestations',
    what: 'A standing is a verified statement about a person — "initiated", "examined", "elder-approved" — issued by a named member, never by the software or a payment.',
    actions: [
      'Define the standings this institution recognises, and who may grant each',
      'Attest a member to a standing',
      'Revoke a standing — recorded as a new entry, never erased',
    ],
    tip: 'Only a member with a standing’s required role can attest or revoke it.',
  },
  courses: {
    title: 'Courses',
    what: 'The curriculum this institution teaches — each course, its code, and the lessons inside it.',
    actions: [
      'Create a course and give it a title and code',
      'Open a course to build its lessons and order them',
      'Attach media and set which lessons are gated by standing',
    ],
  },
  media: {
    title: 'Media',
    what: 'The library of files — audio, video, documents, images — that lessons draw on. Uploading here does not publish anything on its own.',
    actions: [
      'Upload an asset to make it available to lessons',
      'See where each asset is used',
      'Replace or remove an asset',
    ],
  },
  cohorts: {
    title: 'Cohorts',
    what: 'A group of learners moving through a course together, on a shared schedule. Enrolment and attendance are managed here.',
    actions: [
      'Create a cohort and tie it to a course',
      'Enrol members into the cohort',
      'Mark attendance session by session',
    ],
  },
  policies: {
    title: 'Eligibility',
    what: 'The rules that decide who may open a gated lesson — expressed as the standing a person must hold, not as code.',
    actions: [
      'Create a policy that holds a lesson until a standing is met',
      'See which lessons each policy covers',
      'Adjust or retire a policy',
    ],
    tip: 'Eligibility checks a standing — it is never satisfied by a payment.',
  },
  accesslog: {
    title: 'Access log',
    what: 'A record of every time access to a gated lesson was granted or denied, and the standing that was checked. Read-only.',
    actions: [
      'See who was let in or turned away, and when',
      'Read the reason behind each decision',
      'Page back through older entries',
    ],
  },
  assessments: {
    title: 'Assessments',
    what: 'Work assessed by named people against a rubric — oral, written, or practical — rather than an auto-marked form. Moderation is available where a senior voice must confirm a junior one.',
    actions: [
      'Create an assessment and attach a rubric',
      'Build a rubric with criteria and described levels',
      'Open an assessment to grade its submissions',
    ],
  },
  gradebook: {
    title: 'Gradebook',
    what: 'The final grades each learner has earned across assessments, gathered in one view.',
    actions: [
      'See every learner’s standing in each assessment',
      'Confirm which results are final and which are still being moderated',
    ],
  },
  fees: {
    title: 'Fees',
    what: 'Payments recorded for this institution — what was charged, paid, waived, or refunded, with a receipt behind each one.',
    actions: [
      'Record a payment or a waiver',
      'See a member’s payment history and receipts',
      'Issue a refund against an earlier payment',
    ],
    tip: 'A payment never grants access on its own — standing does that.',
  },
  credentials: {
    title: 'Credentials',
    what: 'The awards a graduate can show the world. A credential proves an award and nothing more — never marks or standing — and carries a public code anyone can verify.',
    actions: [
      'Design a template with its title, body text, and serial format',
      'Issue a credential to a member',
      'Revoke a credential — recorded and permanent',
    ],
  },
  directory: {
    title: 'Public listing',
    what: 'How this institution appears in the public directory — the page a stranger sees before they belong to anything.',
    actions: [
      'Edit the About text and public details shown to visitors',
      'Choose whether the institution is listed publicly',
      'Preview the page as a visitor sees it',
    ],
  },
};

const console_ = {
  overview: {
    title: 'Overview',
    what: 'The platform at a glance — how many institutions are running, what needs attention, and the health of the service as a whole.',
    actions: [
      'See the count and state of institutions',
      'Spot applications or reports waiting on you',
      'Jump to wherever action is needed',
    ],
  },
  institutions: {
    title: 'Institutions',
    what: 'Every institution on the platform. This is where an institution is suspended or brought back, and where you open one to inspect it.',
    actions: [
      'See each institution’s status and size',
      'Suspend an institution, or reactivate a suspended one',
      'Open one to view its details',
    ],
    tip: 'Suspending an institution locks out its members — it does not delete anything.',
  },
  applications: {
    title: 'Applications',
    what: 'Institutions that have applied to join and are waiting on a decision. Approving one provisions it and notifies the applicant.',
    actions: [
      'Review an applicant’s details',
      'Approve an application to create the institution',
      'Decline an application, with a reason',
    ],
  },
  operators: {
    title: 'Operators',
    what: 'The people who hold platform-console access — the superadmins who run the platform itself, separate from any one institution.',
    actions: [
      'See who has console access',
      'Grant or remove an operator’s access',
    ],
    tip: 'Operator access is platform-wide — grant it sparingly.',
  },
  reports: {
    title: 'Reports',
    what: 'Concerns raised about an institution or its content, filed for the platform to review and act on.',
    actions: [
      'Read each report and the context behind it',
      'Follow a report through to the institution it concerns',
      'Act on a report — up to suspending the institution',
    ],
  },
  breakglass: {
    title: 'Break-glass',
    what: 'Emergency, time-boxed access into a single institution for a stated reason — used only when something cannot be resolved any other way. Every use is fully recorded.',
    actions: [
      'Open scoped access into an institution, with a reason',
      'See what that access can and cannot reach',
      'Close the access when you are done',
    ],
    tip: 'Every break-glass action is written to the audit log and cannot be erased.',
  },
  audit: {
    title: 'Audit',
    what: 'The append-only record of consequential platform actions — who did what, and when. Nothing here can be edited or removed.',
    actions: [
      'Trace an action back to the operator who took it',
      'Filter the log to a period or kind of event',
      'Page back through the full history',
    ],
  },
};

module.exports = { tenant, console: console_ };
