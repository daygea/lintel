'use strict';

/**
 * In-app help content — one source of truth for every surface.
 *
 *  - staff:    the tenant app (/help), role-aware. A topic shows to a member if
 *              its `roles` is empty (everyone) or intersects the member's roles.
 *  - learner:  the learner PWA (?help), served via /api/v1/help.
 *  - platform: the console (/console/help), for superadmins.
 *
 * Shape of a topic:
 *   id        unique within its surface (stable; used for anchors)
 *   title     short heading
 *   category  groups topics into navigable sections (see `categories` below)
 *   roles     staff only — who sees it ([] or omitted = everyone)
 *   summary   one line, shown collapsed
 *   steps     OPTIONAL ordered walkthrough ("do this, then this") — the how
 *   points    the what/why and things worth knowing
 *
 * `categories` gives each surface an ordered list of {key,label} so the help
 * page can render sections in a sensible order with headings. A topic whose
 * category isn't listed falls into a trailing "More" section, so nothing is
 * ever hidden by a typo.
 *
 * Keep entries task-oriented and concrete. Detailed, but scannable — steps are
 * imperative and short; points explain rather than instruct.
 */

const categories = {
  staff: [
    { key: 'start', label: 'Start here' },
    { key: 'people', label: 'People & roles' },
    { key: 'access', label: 'Standing & access' },
    { key: 'teaching', label: 'Courses & content' },
    { key: 'enrolment', label: 'Enrolment & cohorts' },
    { key: 'money', label: 'Fees & billing' },
    { key: 'records', label: 'Credentials & records' },
    { key: 'presence', label: 'Your public presence' },
    { key: 'account', label: 'Your account & security' },
  ],
  learner: [
    { key: 'start', label: 'Getting around' },
    { key: 'learning', label: 'Your learning' },
    { key: 'account', label: 'Account & fees' },
  ],
  platform: [
    { key: 'institutions', label: 'Institutions' },
    { key: 'oversight', label: 'Oversight & safety' },
    { key: 'platform', label: 'Platform health' },
  ],
};

module.exports = {
  categories,

  staff: [
    /* ------------------------------------------------------------- start here */
    {
      id: 'concept-standing',
      title: 'The core idea — standing, not payment',
      category: 'start',
      roles: [],
      summary: 'Why Lintel gates teaching on who a learner is.',
      points: [
        'A course opens for a learner because of their verified standing — an attestation a named person on your staff records — not merely because they enrolled or paid.',
        'Standing can be revoked; when it is, the teaching it opened closes again. Every decision is written to the record.',
        'Payment and access are separate levers: a learner can pay and still wait for standing, or hold standing without paying. You decide how they relate, per course, through an eligibility policy.',
      ],
    },
    {
      id: 'navigating',
      title: 'Finding your way around',
      category: 'start',
      roles: [],
      summary: 'The layout — where everything lives.',
      points: [
        'The left sidebar is your main menu; it only shows the areas your roles let you use, so a shorter menu means fewer permissions, not a missing feature.',
        'The dashboard (the home icon) is your starting point — recent activity, what needs attention, and quick links into each area.',
        'Your name at the bottom of the sidebar opens your account, security settings, and sign-out.',
        'On a phone the sidebar collapses behind the menu button (☰) at the top left.',
      ],
    },
    {
      id: 'getting-started',
      title: 'Getting started',
      category: 'start',
      roles: ['owner', 'admin'],
      summary: 'The first things to set up after your institution goes live.',
      steps: [
        'Open Settings → Branding and set your name, mark, and accent colour — this is what learners see.',
        'Go to Members → Invite a member and add your team, giving each person only the roles they need.',
        'Open Settings → Billing to check your plan and seats, and add payout details if you’ll collect fees.',
        'Create your first course under Courses, then a cohort under Cohorts to enrol learners into it.',
      ],
      points: [
        'You can return to any of these later — nothing here is one-time or irreversible.',
        'If a menu item is missing, your role doesn’t include it; an owner or admin can widen your roles.',
      ],
    },

    /* ----------------------------------------------------------- people & roles */
    {
      id: 'members',
      title: 'Members & roles',
      category: 'people',
      roles: ['owner', 'admin', 'registrar'],
      summary: 'Add people and control what they can do.',
      steps: [
        'Open Members → Invite a member and enter the person’s email.',
        'Tick the roles they need — you can give more than one.',
        'Send the invite; they’ll get an email with a link to set their password.',
        'To change someone later, open their row and adjust their roles — it takes effect at once.',
      ],
      points: [
        'Roles are additive: owner and admin can do most things; registrar admits people and records standing; instructor builds courses; assessor grades; elder attests.',
        'A learner who self-registers appears as “pending” until a registrar admits them — you’ll be emailed when someone is waiting.',
        'Removing a role takes effect immediately; nothing the person did before is erased.',
      ],
    },

    /* -------------------------------------------------------- standing & access */
    {
      id: 'attestations',
      title: 'Recording standing (attestations)',
      category: 'access',
      roles: ['owner', 'admin', 'registrar', 'elder'],
      summary: 'How a person confers the standing that opens teaching.',
      steps: [
        'Open Attestations and choose the learner.',
        'Pick the standing you’re conferring from the list.',
        'Record it — it’s saved in your own name, with the date.',
        'To withdraw it later, find the entry and choose Revoke.',
      ],
      points: [
        'The record always shows who attested and when — standing is never anonymous.',
        'Revoking an attestation closes any access that depended on it, automatically.',
        'Attestations are append-only: a revocation is a new entry, never an erasure, so the history stays intact.',
      ],
    },
    {
      id: 'eligibility',
      title: 'Eligibility policies',
      category: 'access',
      roles: ['owner', 'admin'],
      summary: 'The rules that decide who may open a course.',
      steps: [
        'Open Policies → New policy and give it a name and a denial message (what a blocked learner sees).',
        'Add one or more rules — required standing, cohort membership, payment state, and so on.',
        'Save, then attach the policy to a course or lesson from its settings.',
      ],
      points: [
        'A learner opens the course only when every rule is satisfied; otherwise they see your denial message.',
        'Add a payment-state rule if you want a course held until fees are paid — otherwise paying and access stay independent.',
        'Whether a lesson with no policy is open or held by default is set per institution under Settings → Access.',
        'The Access log shows every open and every refusal, with the reason.',
      ],
    },
    {
      id: 'access-log',
      title: 'The access log',
      category: 'access',
      roles: ['owner', 'admin', 'registrar'],
      summary: 'Who opened what, and who was turned away.',
      points: [
        'Every attempt to open held teaching is recorded — allowed or refused — with the rule that decided it.',
        'Use it to answer “why couldn’t this learner get in?” without guessing: the failed rule is named.',
        'The log is append-only; it’s a record of what happened, not something you edit.',
      ],
    },

    /* ------------------------------------------------------- courses & content */
    {
      id: 'courses',
      title: 'Building a course',
      category: 'teaching',
      roles: ['owner', 'admin', 'instructor'],
      summary: 'Structure, lessons, and cover images.',
      steps: [
        'Open Courses → New course and give it a code and title.',
        'Add a module (a section of the course), then add lessons inside it.',
        'Open a lesson and add content blocks — text, images, or video.',
        'Set a cover image from Cover image, choosing one you’ve uploaded to the media library.',
      ],
      points: [
        'A course holds modules, each holding lessons; this is the shape learners navigate.',
        'A lesson bordered in brass is open teaching; one bordered in slate is held until the learner’s standing is attested.',
        'The cover image appears on the learner’s course card and course header.',
        'You can reorder modules and lessons by dragging them.',
      ],
    },
    {
      id: 'media',
      title: 'Uploading media',
      category: 'teaching',
      roles: ['owner', 'admin', 'instructor'],
      summary: 'Images and video for your lessons.',
      steps: [
        'Open Media → Upload and choose your file.',
        'Wait for video to finish processing (images are ready at once).',
        'In a lesson, add an image or video block and pick the file from your library.',
      ],
      points: [
        'Media is private by default and served over expiring links — a learner only sees it inside a lesson they may open.',
        'Re-use one upload across many lessons; you don’t need to upload it again.',
      ],
    },
    {
      id: 'assessment',
      title: 'Assessments & grading',
      category: 'teaching',
      roles: ['owner', 'admin', 'instructor', 'assessor'],
      summary: 'Rubrics, written and oral work, and the gradebook.',
      points: [
        'Build assessments against a course, then grade submitted work by rubric in the Gradebook.',
        'A junior mark can be moderated by a senior voice; when a mark is overruled, both remain in the record.',
        'A grade scheme turns raw marks into a final grade — weighting categories and dropping lowest scores as you configure.',
      ],
    },
    {
      id: 'quizzes',
      title: 'Quizzes',
      category: 'teaching',
      roles: ['owner', 'admin', 'instructor', 'assessor'],
      summary: 'Auto-marked questions that feed the gradebook.',
      steps: [
        'Open a course → Quizzes → New quiz.',
        'Add questions; multiple-choice marks itself, written answers wait for an assessor.',
        'Publish the quiz so learners can attempt it.',
        'Review any written answers under Marking.',
      ],
      points: [
        'A learner’s best fully-marked attempt rolls into the course gradebook as a percentage.',
        'A weaker later attempt never lowers a stronger earlier one.',
      ],
    },

    /* --------------------------------------------------- enrolment & cohorts */
    {
      id: 'cohorts',
      title: 'Cohorts & enrolment',
      category: 'enrolment',
      roles: ['owner', 'admin', 'registrar'],
      summary: 'Run a course for a group of learners.',
      steps: [
        'Open Cohorts → New cohort and attach it to a course.',
        'Open the cohort so learners can apply or be enrolled.',
        'Enrol a member directly, or admit applicants from the applications list.',
        'Close the cohort when the run is over.',
      ],
      points: [
        'A cohort is one running of a course — a class with its own members, sessions, and fees.',
        'Enrolling into a paid cohort raises an invoice automatically (see Fees & payments).',
        'You can’t delete a course while learners are enrolled — delete its cohorts first, which unenrols them.',
      ],
    },
    {
      id: 'applications',
      title: 'Applications & attendance',
      category: 'enrolment',
      roles: ['owner', 'admin', 'registrar'],
      summary: 'Admit applicants and track who showed up.',
      steps: [
        'Open a cohort to see who has applied.',
        'Approve or decline each application; approving enrols the learner.',
        'Add sessions to the cohort for scheduled meetings.',
        'Mark attendance against a session as learners attend.',
      ],
      points: [
        'Attendance can be used as an eligibility rule — e.g. a lesson that opens only after enough sessions attended.',
        'Declining an application is recorded; it doesn’t silently disappear.',
      ],
    },

    /* ------------------------------------------------------------ fees & billing */
    {
      id: 'fees',
      title: 'Fees & payments',
      category: 'money',
      roles: ['owner', 'admin', 'registrar'],
      summary: 'Invoices, payments, and refunds.',
      steps: [
        'Set a fee schedule for a cohort so enrolment raises the right invoice.',
        'When a learner pays online it’s recorded automatically; for a bank transfer, open the invoice and Record payment.',
        'To reverse a charge, open the invoice and Refund — then move the money by your usual means.',
      ],
      points: [
        'A refund is a permanent negative entry — the ledger keeps both the charge and the reversal; nothing is overwritten.',
        'To receive fees directly to your own account, add a Paystack subaccount under Settings → Billing → Payouts.',
        'Learner fees are entirely separate from what your institution pays Lintel (see Plan & billing).',
      ],
    },
    {
      id: 'billing',
      title: 'Plan & billing',
      category: 'money',
      roles: ['owner', 'admin'],
      summary: 'Your Lintel subscription.',
      points: [
        'This is what your institution pays Lintel — separate from any fees your learners pay you.',
        'Choose or change a plan under Settings → Billing.',
        'If a paid period lapses the account is suspended until you renew — no data is lost, and you can still reach billing to reactivate.',
      ],
    },

    /* ------------------------------------------------- credentials & records */
    {
      id: 'credentials',
      title: 'Credentials',
      category: 'records',
      roles: ['owner', 'admin'],
      summary: 'Issue and verify what a learner has earned.',
      steps: [
        'Create a credential template under Credentials → Templates.',
        'Issue it to a learner once their requirements are met.',
        'Share the verification link — anyone can check it without signing in.',
      ],
      points: [
        'Each credential carries a public verification link a third party (e.g. an employer) can check.',
        'Credentials are part of the permanent record — revoking one is a new entry, not a deletion.',
      ],
    },

    /* --------------------------------------------------------- public presence */
    {
      id: 'directory',
      title: 'Your public listing',
      category: 'presence',
      roles: ['owner', 'admin'],
      summary: 'How your institution appears in the public directory.',
      steps: [
        'Open Public listing and choose a handle (your address in the directory).',
        'Add your tagline and an “about” description.',
        'Publish when you’re ready to appear; unpublish to hide it again.',
      ],
      points: [
        'A listing only shows while your institution is active — it’s hidden automatically if the account is suspended.',
        'Changes to your tagline and about take effect as soon as you save.',
      ],
    },

    /* ------------------------------------------------- your account & security */
    {
      id: 'account-security',
      title: 'Your account & security',
      category: 'account',
      roles: [],
      summary: 'Password, two-factor, and signing out everywhere.',
      steps: [
        'Open your name at the bottom of the sidebar → Security.',
        'Set up two-factor (an authenticator app) under Two-step verification for stronger protection.',
        'Change your password under Account → Password at any time.',
      ],
      points: [
        'Turning on two-step means a code from your phone is needed alongside your password.',
        'Changing your password signs out your other sessions, which is the safe default.',
        'If you were given a temporary password, you’ll be asked to set your own before doing anything else.',
      ],
    },
  ],

  learner: [
    /* ------------------------------------------------------- getting around */
    {
      id: 'start',
      title: 'Starting a course',
      category: 'start',
      summary: 'Find your courses and begin.',
      steps: [
        'Open your home screen to see the courses you’re enrolled in.',
        'Tap a course to see its lessons.',
        'Tap a lesson to begin.',
      ],
      points: [
        'Use “Browse open programmes” to apply to something new.',
        'Locked lessons show why they’re locked when you tap them.',
      ],
    },
    {
      id: 'navigating',
      title: 'Finding your way around',
      category: 'start',
      summary: 'The home screen and menu.',
      points: [
        'Your home screen is the hub — enrolled courses, a “Continue learning” card, and links to fees and help.',
        'The menu button opens links to your fees, credentials, and this help.',
        'You can install Lintel to your home screen so it opens like an app.',
      ],
    },
    {
      id: 'resume',
      title: 'Picking up where you left off',
      category: 'start',
      summary: 'Continue learning quickly.',
      points: [
        'The “Continue learning” card on your home screen jumps you straight to your next lesson.',
        'Each course shows your progress so you can see what’s left.',
      ],
    },

    /* ---------------------------------------------------------- your learning */
    {
      id: 'held',
      title: 'Why is a lesson locked?',
      category: 'learning',
      summary: 'Held lessons and standing.',
      points: [
        'A lesson marked as held is waiting on your standing — a member of the institution needs to confirm you’re eligible before it opens.',
        'Tapping a held lesson shows the reason it’s closed.',
        'If you think it should be open, contact your institution; opening it isn’t something the app decides on its own.',
      ],
    },
    {
      id: 'progress',
      title: 'Tracking your progress',
      category: 'learning',
      summary: 'See what you’ve done and what’s left.',
      points: [
        'Completing a lesson marks it done and advances your course progress.',
        'Your grades and any quiz results appear against the course once they’re marked.',
      ],
    },
    {
      id: 'offline',
      title: 'Using Lintel offline',
      category: 'learning',
      summary: 'Learn without a connection.',
      points: [
        'Lessons you’ve opened are kept for offline reading; add Lintel to your home screen to use it like an app.',
        'Anything you complete offline syncs the next time you’re connected.',
      ],
    },

    /* --------------------------------------------------------- account & fees */
    {
      id: 'fees',
      title: 'Fees & payments',
      category: 'account',
      summary: 'Paying for a course.',
      steps: [
        'Open “Fees & payments” to see what you owe.',
        'Tap to pay securely online.',
        'Check your account for the receipt afterwards.',
      ],
      points: [
        'A receipt is recorded against your account for every payment.',
        'If a course is held until fees are paid, paying opens it automatically once the payment lands.',
      ],
    },
    {
      id: 'credentials',
      title: 'Your credentials',
      category: 'account',
      summary: 'What you’ve earned.',
      points: [
        'Credentials you earn carry a link others can use to verify them — no sign-in needed to check one.',
      ],
    },
    {
      id: 'account',
      title: 'Your account',
      category: 'account',
      summary: 'Password and signing in.',
      points: [
        'You sign in at your institution’s own web address, not the main Lintel site.',
        'If you forget your password, ask your institution to reset it for you.',
      ],
    },
  ],

  platform: [
    /* ------------------------------------------------------------ institutions */
    {
      id: 'applications',
      title: 'Reviewing institution applications',
      category: 'institutions',
      summary: 'From request to live tenant.',
      steps: [
        'Open Applications to see new requests (superadmins are also emailed).',
        'Review the request, then Approve to provision the institution — or Decline.',
        'Approving emails the new owner a set-up link.',
      ],
      points: [
        'With auto-provisioning on, requests go live immediately; otherwise they wait here for review.',
        'Declining is recorded; the applicant isn’t silently dropped.',
      ],
    },
    {
      id: 'lifecycle',
      title: 'Suspend, close, delete, restore',
      category: 'institutions',
      summary: 'Managing an institution’s standing.',
      points: [
        'Suspend locks an institution out temporarily (e.g. a lapsed plan); close is terminal but keeps records; delete hides it from the console and stops it resolving.',
        'Deleted institutions are hidden but retained — restore them from “Show archived”.',
        'Nothing here hard-deletes data.',
      ],
    },

    /* --------------------------------------------------------- oversight & safety */
    {
      id: 'breakglass',
      title: 'Break-glass access',
      category: 'oversight',
      summary: 'Seeing inside a tenant, accountably.',
      steps: [
        'Open Break-glass and choose the institution.',
        'Write a justification and set the time window.',
        'Open the grant — the owner is emailed, and your reads are logged.',
        'Revoke it when you’re done, or let it expire.',
      ],
      points: [
        'Tenant content is private by default; a grant lets an operator read it under a written justification, for a limited window.',
        'It’s read-only oversight, not impersonation — every open and every read is logged.',
      ],
    },
    {
      id: 'abuse',
      title: 'Abuse reports & user actions',
      category: 'oversight',
      summary: 'Responding to reports about users.',
      points: [
        'Reports arrive under Reports; open one to see the detail and resolve it.',
        'Against a user you can suspend, reactivate, force sign-out, or reset their password.',
        'Force sign-out ends all of that user’s sessions immediately.',
      ],
    },
    {
      id: 'operators',
      title: 'Platform operators',
      category: 'oversight',
      summary: 'Who can run the console.',
      points: [
        'Operators are the people with superadmin access to this console.',
        'Grant operator access by email; revoke it when someone no longer needs it.',
        'Keep this list tight — operators can see platform-wide data and open break-glass grants.',
      ],
    },

    /* ----------------------------------------------------------- platform health */
    {
      id: 'billing',
      title: 'Plans & revenue',
      category: 'platform',
      summary: 'The overview at a glance.',
      points: [
        'The Overview shows recurring monthly value from active subscriptions, recent revenue, what needs attention (trials and subscriptions lapsing, suspensions), and recent deletions.',
        'Recurring value counts active institutions only, so it reflects who is currently paying.',
      ],
    },
  ],
};
