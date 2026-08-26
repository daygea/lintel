'use strict';

/**
 * In-app help content — one source of truth for every surface.
 *
 *  - staff:    the tenant app (/help), role-aware. A topic shows to a member if
 *              its `roles` is empty (everyone) or intersects the member's roles.
 *  - learner:  the learner PWA (?help), served via /api/v1/help.
 *  - platform: the console (/console/help), for superadmins.
 *
 * Keep entries short and task-oriented: a one-line summary plus a few concrete
 * points. This is guidance, not a manual.
 */

module.exports = {
  staff: [
    {
      id: 'concept-standing',
      title: 'The core idea — standing, not payment',
      roles: [],
      summary: 'Why Lintel gates teaching on who a learner is.',
      points: [
        'A course opens for a learner because of their verified standing — an attestation a named person on your staff records — not merely because they enrolled or paid.',
        'Standing can be revoked; when it is, the teaching it opened closes again. Every decision is written to the record.',
        'Payment and access are separate levers: a learner can pay and still wait for standing, or hold standing without paying. You decide how they relate per course.',
      ],
    },
    {
      id: 'getting-started',
      title: 'Getting started',
      roles: ['owner', 'admin'],
      summary: 'The first things to set up after your institution goes live.',
      points: [
        'Set your name, mark, and accent colour under Settings → Branding.',
        'Invite your team from Members → Invite a member, giving each person only the roles they need.',
        'Check your plan, seats, and payouts under Settings → Billing.',
      ],
    },
    {
      id: 'members',
      title: 'Members & roles',
      roles: ['owner', 'admin', 'registrar'],
      summary: 'Add people and control what they can do.',
      points: [
        'Roles are additive — owner and admin can do most things; registrar admits people and records standing; instructor builds courses; assessor grades; elder attests.',
        'A learner who self-registers appears as “pending” until a registrar admits them — you’ll be emailed when someone is waiting.',
        'Removing a role takes effect immediately; nothing they did before is erased.',
      ],
    },
    {
      id: 'attestations',
      title: 'Recording standing (attestations)',
      roles: ['owner', 'admin', 'registrar', 'elder'],
      summary: 'How a person confers the standing that opens teaching.',
      points: [
        'Open Attestations, choose the learner and the standing, and record it in your own name — the record shows who attested and when.',
        'To withdraw standing, revoke the attestation. Access that depended on it closes automatically.',
        'Attestations are append-only: a revocation is a new entry, never an erasure, so the history stays intact.',
      ],
    },
    {
      id: 'courses',
      title: 'Building a course',
      roles: ['owner', 'admin', 'instructor'],
      summary: 'Structure, lessons, and cover images.',
      points: [
        'A course holds modules, each holding lessons; add a lesson, then open it to add content blocks (text, images, video).',
        'Set a cover image from Cover image → pick one you’ve uploaded to the media library; it appears on the learner’s card and course header.',
        'A lesson bordered in brass is open teaching; one bordered in slate is held until the learner’s standing is attested.',
      ],
    },
    {
      id: 'media',
      title: 'Uploading media',
      roles: ['owner', 'admin', 'instructor'],
      summary: 'Images and video for your lessons.',
      points: [
        'Upload under Media; images are ready immediately, video is processed before it can be attached.',
        'Media is private by default and served over expiring links — a learner only sees it inside a lesson they may open.',
      ],
    },
    {
      id: 'eligibility',
      title: 'Eligibility policies',
      roles: ['owner', 'admin'],
      summary: 'The rules that decide who may open a course.',
      points: [
        'A policy is a set of rules (required standing, cohort membership, payment state, and so on); a learner opens the course only when the rules are satisfied.',
        'Add a payment-state rule if you want a course held until fees are paid — otherwise paying and access stay independent.',
        'The Access log shows every open and every refusal, with the reason.',
      ],
    },
    {
      id: 'assessment',
      title: 'Assessments & grading',
      roles: ['owner', 'admin', 'instructor', 'assessor'],
      summary: 'Quizzes, rubrics, and the gradebook.',
      points: [
        'Build assessments against a course; grade written and oral work by rubric in the Gradebook.',
        'A junior mark can be moderated by a senior voice; when a mark is overruled, both remain in the record.',
      ],
    },
    {
      id: 'fees',
      title: 'Fees & payments',
      roles: ['owner', 'admin', 'registrar'],
      summary: 'Invoices, payments, and refunds.',
      points: [
        'Enrolling a learner into a paid cohort raises an invoice automatically; learners can pay online or you can record a bank transfer.',
        'A refund is recorded as a permanent negative entry — the ledger keeps both the charge and the reversal; you move the money by your usual means.',
        'To receive fees directly to your own account, add a Paystack subaccount under Settings → Billing → Payouts.',
      ],
    },
    {
      id: 'credentials',
      title: 'Credentials',
      roles: ['owner', 'admin'],
      summary: 'Issue and verify what a learner has earned.',
      points: [
        'Issue a credential once its requirements are met; each carries a public verification link a third party can check.',
        'Credentials are part of the permanent record — revoking one is a new entry, not a deletion.',
      ],
    },
    {
      id: 'directory',
      title: 'Your public listing',
      roles: ['owner', 'admin'],
      summary: 'How your institution appears in the public directory.',
      points: [
        'Publish a listing under Public listing to appear in the Lintel directory at a handle you choose.',
        'A listing only shows while your institution is active — it’s hidden automatically if the account is suspended.',
      ],
    },
    {
      id: 'billing',
      title: 'Plan & billing',
      roles: ['owner', 'admin'],
      summary: 'Your Lintel subscription.',
      points: [
        'This is separate from any fees your learners pay you — it’s what your institution pays Lintel.',
        'Choose or change a plan under Settings → Billing; if a paid period lapses the account is suspended until you renew, and no data is lost.',
      ],
    },
  ],

  learner: [
    {
      id: 'start',
      title: 'Starting a course',
      summary: 'Find your courses and begin.',
      points: [
        'Your enrolled courses are on your home screen — tap one to see its lessons, then tap a lesson to begin.',
        'Use “Browse open programmes” to apply to something new.',
      ],
    },
    {
      id: 'resume',
      title: 'Picking up where you left off',
      summary: 'Continue learning quickly.',
      points: [
        'The “Continue learning” card on your home screen jumps you straight to your next lesson.',
        'Each course shows your progress so you can see what’s left.',
      ],
    },
    {
      id: 'held',
      title: 'Why is a lesson locked?',
      summary: 'Held lessons and standing.',
      points: [
        'A lesson marked as held is waiting on your standing — a member of the institution needs to confirm you’re eligible before it opens.',
        'If you think it should be open, contact your institution; opening it isn’t something the app decides on its own.',
      ],
    },
    {
      id: 'offline',
      title: 'Using Lintel offline',
      summary: 'Learn without a connection.',
      points: [
        'Lessons you’ve opened are kept for offline reading; you can add Lintel to your home screen like an app.',
        'Anything you complete offline syncs the next time you’re connected.',
      ],
    },
    {
      id: 'fees',
      title: 'Fees & payments',
      summary: 'Paying for a course.',
      points: [
        'Open “Fees & payments” to see what you owe and pay securely online.',
        'A receipt is recorded against your account for every payment.',
      ],
    },
    {
      id: 'credentials',
      title: 'Your credentials',
      summary: 'What you’ve earned.',
      points: [
        'Credentials you earn carry a link others can use to verify them.',
      ],
    },
  ],

  platform: [
    {
      id: 'applications',
      title: 'Reviewing institution applications',
      summary: 'From request to live tenant.',
      points: [
        'New requests arrive under Applications and email the superadmins; approve to provision the institution and email its owner a set-up link, or decline.',
        'With auto-provisioning on, requests go live immediately; otherwise they wait here for review.',
      ],
    },
    {
      id: 'lifecycle',
      title: 'Suspend, close, delete, restore',
      summary: 'Managing an institution’s standing.',
      points: [
        'Suspend locks an institution out temporarily (e.g. a lapsed plan); close is terminal but keeps records; delete hides it from the console and stops it resolving.',
        'Deleted institutions are hidden but retained — restore them from “Show archived”. Nothing here hard-deletes data.',
      ],
    },
    {
      id: 'breakglass',
      title: 'Break-glass access',
      summary: 'Seeing inside a tenant, accountably.',
      points: [
        'Tenant content is private by default. A break-glass grant lets an operator read it under a written justification, for a limited window.',
        'Opening a grant emails the institution’s owner, and every open and every read is logged. It’s read-only oversight, not impersonation.',
      ],
    },
    {
      id: 'billing',
      title: 'Plans & revenue',
      summary: 'The overview at a glance.',
      points: [
        'The Overview shows recurring monthly value from active subscriptions, recent revenue, what needs attention (trials and subscriptions lapsing, suspensions), and recent deletions.',
        'Recurring value counts active institutions only, so it reflects who is currently paying.',
      ],
    },
  ],
};
