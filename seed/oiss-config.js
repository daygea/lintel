'use strict';

/**
 * OISS configuration seed.
 *
 * This is NOT synthetic test data. It is the real, agreed configuration of the
 * Obatala Institute of Sacred Studies, expressed as rows the eligibility engine
 * reads. It encodes the six governance decisions OISS made:
 *
 *   1. Four recognised standings (initiation, priestly office, practitioner, elder)
 *   2. Three issuer roles (elder confers initiation & office; assessor confers
 *      practitioner competence; the head confers elder status)
 *   3. Denial wording — PLACEHOLDER below. OISS must replace every message marked
 *      __OISS_TO_WRITE__ with their own words, in Yorùbá and English.
 *   4. Gender / lineage gating — DEFERRED. Not built. Awaiting OISS elders.
 *   5. Traditional-medicine gating — strictest shape (standing + jurisdiction +
 *      undertaking), and BLOCKED on legal sign-off before content is authored.
 *   6. Posthumous consent — continues unless the family revokes; no code, but a
 *      family-reachable revocation path is required (archive/admin, Sprint 11).
 *
 * Run against an OISS tenant:  node seed/oiss-config.js <tenant-slug>
 * Idempotent: safe to re-run; upserts by slug.
 */

const mongoose = require('mongoose');
const { Tenant, AttestationType, EligibilityPolicy, ContentPolicy } = require('../src/models');
const { runWithTenant } = require('../src/lib/context');
const { mongoUri } = require('../src/config/env');

const PLACEHOLDER = '__OISS_TO_WRITE__';

/* ----------------------------------------------------------------- standings */

const STANDINGS = [
  {
    slug: 'itefa-standing',
    label: { en: 'Ìtẹ̀fá standing', yo: 'Ìtẹ̀fá' },
    description: { en: 'Recognised initiation standing within the tradition.' },
    requiresIssuerRole: 'elder',
    isSensitive: true,
    // permanent — one cannot be un-initiated
  },
  {
    slug: 'priestly-office',
    label: { en: 'Priestly office', yo: 'Oyè Àwòrò' },
    description: { en: 'An office held within the tradition.' },
    requiresIssuerRole: 'elder',
    isSensitive: true,
  },
  {
    slug: 'practitioner-standing',
    label: { en: 'Practitioner standing', yo: 'Oyè Oníṣègùn' },
    description: { en: 'Assessed competence to practise traditional medicine.' },
    requiresIssuerRole: 'assessor',
    isSensitive: true,
    defaultValidityDays: 365, // renewable — the one standing tied to third-party safety
  },
  {
    slug: 'elder-status',
    label: { en: 'Elder / custodian', yo: 'Àgbà' },
    description: { en: 'The most senior custodial status, conferred by the head of the Institute.' },
    requiresIssuerRole: 'owner',
    isSensitive: true,
  },
];

/* ------------------------------------------------------------------ policies */

const POLICIES = [
  {
    slug: 'initiation-tier',
    label: { en: 'Held pending initiation standing' },
    combinator: 'all',
    rules: [
      { type: 'enrolled' },
      { type: 'attestation', params: { typeSlug: 'itefa-standing' } },
    ],
    // OISS must replace this with their own words, Yorùbá + English.
    denialMessage: {
      en: PLACEHOLDER,
      yo: PLACEHOLDER,
    },
  },
  {
    slug: 'priestly-tier',
    label: { en: 'Held pending priestly office' },
    combinator: 'all',
    rules: [
      { type: 'enrolled' },
      { type: 'attestation', params: { typeSlug: 'priestly-office' } },
    ],
    denialMessage: { en: PLACEHOLDER, yo: PLACEHOLDER },
  },
  {
    // Decision #5 — strictest shape. Practitioner standing AND a signed undertaking.
    // Jurisdiction is enforced at the content/enrolment layer (a tenant setting),
    // not as an eligibility rule, since it is about where the learner is, not who
    // they are. BLOCKED: no dosage/preparation content may be authored against
    // this policy until legal sign-off is recorded.
    slug: 'tmr-practitioner-only',
    label: { en: 'Held pending practitioner standing (medicine)' },
    combinator: 'all',
    rules: [
      { type: 'enrolled' },
      { type: 'attestation', params: { typeSlug: 'practitioner-standing', mustBeUnexpired: true } },
      { type: 'attestation', params: { typeSlug: 'safety-undertaking' } },
    ],
    denialMessage: { en: PLACEHOLDER, yo: PLACEHOLDER },
  },
];

// The signed-undertaking standing that the medicine policy depends on.
const UNDERTAKING = {
  slug: 'safety-undertaking',
  label: { en: 'Signed safety undertaking' },
  description: { en: 'A recorded undertaking to study responsibly, not to self-treat or treat others without competence.' },
  requiresIssuerRole: 'registrar', // recorded by the registrar when the learner signs
  isSensitive: false,
};

/* ------------------------------------------------------------ content policy */

const CONTENT_POLICIES = [
  {
    slug: 'sacred-tier-3',
    label: { en: 'Sacred, restricted' },
    streamOnly: true,     // forces downloadable + offlineCacheable false
    watermark: true,
    sessionBound: true,
    logAccess: true,
  },
  {
    slug: 'open-teaching',
    label: { en: 'Open teaching' },
    downloadable: true,
    offlineCacheable: true,
    watermark: false,
    logAccess: false,
  },
];

/* --------------------------------------------------------------------- run */

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: node seed/oiss-config.js <tenant-slug>');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  const tenant = await Tenant.findOne({ slug }).exec();
  if (!tenant) {
    console.error(`No tenant with slug "${slug}". Provision it first.`);
    process.exit(1);
  }

  await runWithTenant(tenant._id, null, async () => {
    for (const t of [...STANDINGS, UNDERTAKING]) {
      await AttestationType.findOneAndUpdate({ slug: t.slug }, t, {
        upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true,
      }).exec();
    }
    for (const p of POLICIES) {
      await EligibilityPolicy.findOneAndUpdate({ slug: p.slug }, p, {
        upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true,
      }).exec();
    }
    for (const c of CONTENT_POLICIES) {
      await ContentPolicy.findOneAndUpdate({ slug: c.slug }, c, {
        upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true,
      }).exec();
    }
  });

  const placeholders = POLICIES.filter((p) => p.denialMessage.en === PLACEHOLDER).length;

  console.log(`\nConfigured "${tenant.name}" (${slug}):`);
  console.log(`  ${STANDINGS.length + 1} attestation types`);
  console.log(`  ${POLICIES.length} eligibility policies`);
  console.log(`  ${CONTENT_POLICIES.length} content policies`);
  console.log(`\n⚠  ${placeholders} policies still carry PLACEHOLDER denial text.`);
  console.log('   OISS must replace every __OISS_TO_WRITE__ with their own words,');
  console.log('   in Yorùbá and English, before any gated lesson is shown to a learner.\n');
  console.log('Still open (OISS governance, not code):');
  console.log('  • Denial wording for every policy above');
  console.log('  • Gender / lineage gating — deferred, awaiting elders');
  console.log('  • Legal sign-off before any traditional-medicine dosage content');
  console.log('  • A family-reachable posthumous revocation path (archive-side)\n');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
