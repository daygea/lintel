# Multi-tenant LMS — Architecture & Data Model v0.2

**Changes since v0.1:** competitive gap audit added (§8); sprints reordered — the eligibility engine now follows enrollment, because it cannot evaluate `enrolled` or `course_completed` rules against models that do not exist. A **rule registry** replaces the fixed rule list, so later sprints register new rule types without touching the evaluator. Gradebook, quiz engine, SSO, LTI, accessibility and data export added after audit against Moodle and Canvas.

**Status:** Draft for review
**Author:** Adedeji (solo founder / architect)
**Design partner tenant:** Obatala Institute of Sacred Studies (OISS)
**Working name:** TBD — referred to here as *the platform*
**Repo (proposed):** `daygea/<name>` (private)

---

## 1. Positioning

A multi-tenant learning management platform for institutions whose teaching cannot be delivered by a generic LMS, because **access to their material is conditional on who the learner is, not merely on whether they paid.**

The three capabilities that define the product and that Moodle, Canvas, Thinkific and Teachable do not have:

1. **An eligibility engine** — access gated on verified, revocable attributes of the learner (attestations), not just prior course completion.
2. **Content-access policy** — per-item sensitivity classification driving watermarking, stream-only delivery, download prohibition, and mandatory access logging.
3. **Human, performance-based assessment** — audio/video submissions graded against rubrics by named assessors, with second-marking and moderation.

OISS is the design partner because it exercises all three at maximum severity. It is **not** the product. No term specific to Yorùbá, Ifá, Orisha, initiation, or any tenant's tradition appears in the codebase. Such terms exist only as tenant-authored rows in `AttestationType`, `EligibilityPolicy`, and content.

---

## 2. Architecture decisions

### ADR-001 — Standalone application, not a Reaxis module
Different domain, different buyer, different scaling curve. Coupling would mean an LMS migration can endanger a proptech tenant's ledger.
**Consequence:** Reaxis patterns are copied, not imported — tenant-guard plugin, payment routing, fee resolver, feature registry, repo checkers.
**Revisit:** at ~10 paying tenants, evaluate extracting a shared platform kernel. Not before.

### ADR-002 — Shared database, shared schema, enforced tenant isolation
Single MongoDB database. Every tenant-owned document carries `tenantId`. Isolation is enforced by a **mandatory Mongoose plugin** that injects `tenantId` into every query, update, and delete at the driver level and throws if the request context has no tenant. Isolation is not a matter of developer discipline.
**Rejected:** database-per-tenant. Operationally unaffordable for a solo founder at this stage.
**Escape hatch:** `Tenant.region` + zero cross-tenant joins means any tenant can later be lifted to a dedicated cluster without a schema change.

### ADR-003 — EJS admin, PWA learner, one service layer
Learner surface is a PWA: offline lesson packs, in-browser recording, resumable chunked upload, low-bandwidth resilience.
Admin/registrar/instructor surface is server-rendered EJS: forms and tables, fastest to build.
**Both call the same service layer.** Controllers contain no business logic. A repo checker (`check-api-parity`) fails the build if a service method is reachable from one transport but not the other.
**Rationale:** the mobile/web logic drift seen in Reaxis must not recur.

### ADR-004 — Archive material is referenced, never copied
Content sourced from an external archive (OISS or any future institutional archive) is stored as a `ContentBlock` of `type: 'archive_ref'` holding metadata and an accession number only. Media bytes are fetched at render time via a signed, short-TTL URL issued by the archive.
**Rationale:** if the LMS copies restricted media into its own bucket, depositor consent revocation cannot propagate, and the platform becomes a consent-laundering mechanism. No policy document fixes that. This mirrors the existing Orírùn ↔ OISS boundary: external API consumer against a whitelisted publication set.

### ADR-005 — Money is minor units plus currency code
`{ amount: <Int>, currency: <ISO-4217> }`. Never a float. Never a bare number. Tenant declares `baseCurrency`.

### ADR-006 — Locale maps, not strings
Every learner-visible content field is `Map<localeCode, String>`. Search normalises diacritics (search is diacritic-insensitive; display is diacritic-correct). Retrofitting i18n is a rewrite; it is cheap now and expensive later.

### ADR-007 — Payment providers are an interface
`PaymentProvider { initialize, verify, refund, handleWebhook }`. Adapters: `paystack`, `flutterwave`, `stripe`. Tenant selects provider per currency/country. No provider SDK is imported outside its adapter.

### ADR-008 — The eligibility engine uses a rule registry
The evaluator does not know the rule types. Each rule type is a registered plugin exposing `{ slug, paramsSchema, evaluate(params, learnerContext) }`. `assessment_score` is registered when assessment ships; `payment_state` when commerce ships. The evaluator is written once, in Sprint 3, and never modified again.
**Consequence:** the engine can ship before the models its later rules depend on.

### ADR-009 — The gradebook is line-item-native
Every gradable thing is a **line item** on a course gradebook, with a category, weight, and a score. This is not aesthetic: LTI Advantage's Assignment and Grade Service posts scores against line items. A gradebook built without them makes LTI a migration rather than a feature.
**Consequence:** LTI 1.3 is deferrable to Sprint 9 at no architectural cost.

### ADR-010 — Peer review is prohibited, permanently
Peer review exposes one learner's submission to another. For any content above consent tier 2 this is a consent violation, and the platform cannot verify that a peer is entitled to see what they are being asked to mark. This is recorded as a permanent non-goal so that it is not proposed in year two as an obvious saving.

---

## 3. Tenancy model

```
Tenant
  _id
  slug                  unique, subdomain-safe
  name
  domains[]             custom domains
  region                'af-west' | 'eu' | 'us'   (future partitioning key)
  baseCurrency          'NGN'
  defaultLocale         'en'
  locales[]             ['en', 'yo']
  timezone              'Africa/Lagos'
  branding              { logoAssetId, primaryColor, wordmark }
  features              { ... }   // feature registry flags
  paymentProviders[]    [{ provider, currencies[], config, isDefault }]
  archiveIntegrations[] [{ archiveId, baseUrl, publicationSetId, apiKeyRef }]
  plan                  subscription tier
  status                'trial' | 'active' | 'suspended'
```

**Roles** are per-tenant, held on `Membership`, never on `User`:
`owner`, `admin`, `registrar`, `instructor`, `assessor`, `learner`.
A person may hold several. `assessor` is deliberately separate from `instructor` — an external elder or examiner grades without being able to author or administer.

```
User                    // global identity, tenant-agnostic
  _id, email, phone, passwordHash, mfa, locale, timezone, status

Membership
  tenantId, userId, roles[], status, joinedAt, invitedBy
```

---

## 4. Core domain model

### Curriculum
```
Program        tenantId, code, title{}, description{}, admissionPolicyId?,
               credentialTemplateId?, courseIds[], status

Course         tenantId, programId?, code, title{}, summary{},
               eligibilityPolicyId?, instructorIds[], version, status

Module         tenantId, courseId, title{}, order

Lesson         tenantId, moduleId, title{}, order, estimatedMinutes,
               eligibilityPolicyId?      // lesson-level override

ContentBlock   tenantId, lessonId, order,
               type: 'rich_text' | 'audio' | 'video' | 'pdf' | 'image'
                   | 'archive_ref' | 'embed' | 'assessment_ref',
               body{}?, assetId?, assessmentId?,
               archiveRef?: {
                 archiveId, accessionNumber, tkLabels[], consentTier,
                 cachedTitle{}, cachedDuration, lastVerifiedAt
               },
               contentPolicyId
```

`eligibilityPolicyId` resolves at the most specific level present: Lesson → Course → Program. Absent all three, enrollment alone is sufficient.

### Media
```
Asset          tenantId, storageKey, mime, bytes, checksum,
               durationMs?, derivatives[]        // bitrate ladder
               transcript{}?, captions[]?,       // locale-keyed
               uploadedBy, createdAt
```
Transcripts matter more than usual here: oral-tradition content is unsearchable without them, and low-bandwidth learners fall back to text.

### The eligibility engine  *(differentiator 1)*
```
AttestationType tenantId, slug, label{}, description{},
                requiresIssuerRole,     // e.g. 'assessor'
                isSensitive,            // controls visibility + retention
                defaultValidityDays?

Attestation     tenantId, subjectUserId, typeSlug, value,
                issuedByUserId, issuedAt, expiresAt?,
                evidenceAssetId?, note,
                revokedAt?, revokedByUserId?, revocationReason
                // append-only: never hard-deleted; revocation is a write
```

```
EligibilityPolicy
  tenantId, slug, label{},
  combinator: 'all' | 'any',
  rules[]: {
    type: 'enrolled'
        | 'course_completed'    { courseId, minGrade? }
        | 'assessment_score'    { assessmentId, minScore }
        | 'attestation'         { typeSlug, valueIn[], mustBeUnexpired }
        | 'membership_role'     { role }
        | 'manual_approval'     { approverRole }
        | 'payment_state'       { minimum: 'deposit' | 'full' }
  },
  denialMessage{}            // shown to learner; must be dignified, not "access denied"
```

Evaluation is a pure function: `evaluate(policy, learnerContext) → { allowed, failedRules[], message }`. It is memoised per request and invalidated on any `Attestation`, `Enrollment`, `Grade`, or `Payment` write.

**This is the heart of the product.** It is what lets OISS gate initiation-stage material on an elder's attestation — and equally lets a nursing school gate a clinical module on a signed waiver, or a bar association gate CPD on jurisdiction of admission.

### Content-access policy  *(differentiator 2)*
```
ContentPolicy  tenantId, slug, label{},
               downloadable          bool
               offlineCacheable      bool     // PWA lesson packs
               watermark             bool     // learner name + timestamp burned in
               streamOnly            bool     // no direct asset URL ever issued
               sessionBound          bool     // URL tied to session, single use
               maxConcurrentSessions int?
               logAccess             bool
               screenshotDeterrent   bool     // best-effort only; documented as such

AccessLog      tenantId, userId, contentBlockId, assetId?,
               action: 'view'|'stream'|'download'|'denied',
               policySlug, ip, userAgent, sessionId, at
               // append-only, no update path, retention per tenant
```

**Known conflict, resolved by policy:** offline PWA packs and restricted content are mutually exclusive. `offlineCacheable` is only honoured when `downloadable` is true. Restricted material is streamed or not delivered. This is stated explicitly so it is not "discovered" as a bug later.

### Assessment  *(differentiator 3)*
```
Assessment     tenantId, courseId, title{}, instructions{},
               type: 'quiz' | 'written' | 'oral' | 'practical' | 'attendance',
               submissionTypes[]: ['text','audio','video','file'],
               rubricId?, weight, dueAt?, attemptsAllowed,
               requiresModeration bool, moderatorRole

Rubric         tenantId, title{},
               criteria[]: {
                 label{}, weight,
                 levels[]: { label{}, points, descriptor{} }
               },
               maxScore

Submission     tenantId, assessmentId, userId, attemptNo,
               text?, assetIds[], submittedAt,
               status: 'draft'|'submitted'|'under_review'|'returned'|'graded'

AssessorAssignment
               tenantId, submissionId, assessorUserId,
               role: 'primary' | 'second' | 'moderator',
               status, assignedAt, completedAt

Grade          tenantId, submissionId, assessorUserId,
               criterionScores[]: { criterionId, levelId, points, comment },
               total, feedback{}, feedbackAssetId?,   // spoken feedback
               isProvisional, isFinal, moderatedFromGradeId?
```

Design notes that matter:
- **Recording happens in-browser** (MediaRecorder), chunked and uploaded resumably. Assume the upload will be interrupted; assume the learner is on 3G.
- **Spoken feedback** (`feedbackAssetId`) is first-class. In an oral tradition, written marginalia is the wrong medium, and a low-literacy learner is not a hypothetical.
- **Moderation is a second `Grade` document**, not a mutation of the first. The provisional grade survives.

### Enrollment and progress
```
Cohort         tenantId, programId?|courseId?, session ('2026/2027'),
               title{}, startsAt, endsAt, capacity,
               mode: 'online'|'hybrid'|'residency'

Application    tenantId, userId, programId, cohortId,
               answers{}, assetIds[], status, reviewedBy, decidedAt

Enrollment     tenantId, userId, courseId?|programId?, cohortId,
               status: 'applied'|'admitted'|'active'|'paused'
                     |'completed'|'withdrawn'|'expired',
               paymentState: 'unpaid'|'deposit'|'part'|'full'|'waived',
               enrolledAt, completedAt

LessonProgress tenantId, enrollmentId, lessonId,
               state: 'not_started'|'in_progress'|'complete',
               secondsSpent, completedAt
```

### Credentials
```
CredentialTemplate  tenantId, title{}, serialFormat, signatories[], designAssetId
Credential          tenantId, userId, programId, cohortId,
                    serial,               // e.g. OISS/YIS/2026/00114
                    verificationCode,     // public, unguessable
                    issuedAt, issuedByUserId,
                    revokedAt?, revocationReason
```
Public verification endpoint + QR — reuse the pattern already proven in the NCC certificate registry (`NCC/PROC/CERT/XXXXXL`), but backed by the platform DB, not a spreadsheet.

### Commerce
```
FeeSchedule    tenantId, programId?|courseId?, cohortId?,
               items[]: { label{}, money, mandatory, dueOffsetDays }
PaymentPlan    tenantId, feeScheduleId, installments[]: { label, money, dueAt },
               accessRule: minimum paymentState required to keep enrollment active
Invoice        tenantId, userId, enrollmentId, lines[], total, currency,
               status, dueAt
Payment        tenantId, invoiceId, provider, providerRef, money,
               status, paidAt, raw
```
Nigerian and pan-African reality that must be modelled, not patched:
- Part-payment is normal. Enrollment access is gated on `paymentState`, expressed as an `EligibilityPolicy` rule (`payment_state`), so it composes with everything else.
- Bank transfer with manual confirmation is a first-class payment method, not a fallback.
- Scholarships and waivers are a `paymentState: 'waived'` with an audit trail, not a zero-priced invoice.

### Community
```
Announcement, Thread, Post, Notification
```
Deliberately thin in v1. Discussion boards are a well-understood commodity; they are not why anyone buys this.

---

## 5. Archive integration contract

The LMS is an **external API consumer** against a whitelisted publication set. It has no database access to the archive and no privileged position.

**LMS → Archive**
```
GET  /api/v1/publication-sets/:setId/items         list available items (metadata only)
GET  /api/v1/items/:accessionNumber                metadata, tkLabels, consentTier
POST /api/v1/items/:accessionNumber/access-url     → signed URL, TTL ≤ 300s
     body: { learnerRef, tenantRef, purpose: 'lesson_render' }
```

**Archive → LMS (webhook)**
```
item.consent_revoked      → LMS marks every referencing ContentBlock unavailable,
                            purges cached metadata, notifies tenant admin
item.tier_changed         → LMS re-evaluates; may render, may withhold
item.metadata_updated     → LMS refreshes cache
```

**Invariants**
- The LMS caches **metadata only** (title, duration, labels, accession number). Never media bytes.
- The archive performs its **own** tier check on every access-url request. Defence in depth: the LMS's eligibility engine deciding "allowed" is not sufficient authority for the archive to release restricted media.
- Every access-url issuance is logged **in the archive**, against the learner reference, satisfying the archive's own consent-audit obligations.
- TK Labels and accession numbers **render to the learner**. Attribution is not stripped at import. This is non-negotiable and should be enforced by a checker.

---

## 6. Scale posture

| Concern | Decision now | Cost of deferring |
|---|---|---|
| Currency | minor units + ISO code | Rewrite of every money path |
| Payments | provider interface + adapters | Hardcoded Paystack blocks expansion |
| i18n | locale maps on all content fields | Full schema migration |
| Time | UTC storage, per-user render | Cohort scheduling bugs across timezones |
| Residency | `Tenant.region`, no cross-tenant joins | GDPR/NDPR forces emergency re-architecture |
| Media | region-local object storage, bitrate ladder | Unusable outside the origin region |

---

## 7. Publication, catalog, and the marketplace question

The platform is **marketplace-capable but ships as white-label SaaS.** Consent is the primitive that makes a catalog safe; the catalog itself is deferred until supply justifies it.

### ADR-011 — Publication is an act, not a flag
The public catalog never queries content collections. It reads `CatalogListing` — a denormalised document created only by an explicit publish action by a named user, cleared by the policy engine. There is no code path from content to catalog that a bug can open.

```
CatalogListing  tenantId, courseId, publishedByUserId, publishedAt,
                title{}, summary{}, priceMoney, previewBlockIds[],
                clearedAt, clearedRules[]      // what the engine checked
                unpublishedAt?, unpublishReason?
```

**Fail closed.** `Course.visibility` and `ContentBlock.visibility` default to `private`, permanently. Publishing a course does not publish its blocks.

**Preview is the sharpest knife.** Preview is a per-block opt-in that the engine *refuses* unless consent tier ≤ 1 and no restrictive TK label is present. A tenant cannot preview restricted material even if they want to. The engine says no to the tenant. This is the single most important rule in this section: "watch lesson 1 free" is the standard industry leak vector.

**Revocation unpublishes.** The archive's `item.consent_revoked` webhook must take down the `CatalogListing`, not merely stop the lesson rendering.

### ADR-012 — Discovery ships as a directory before it ships as a catalog
A public **institution page** (who the tenant is, what they teach, how to apply — zero course content) leaks nothing and is useful from tenant one. A **course catalog** requires supply density; the first fifteen tenants will be institutions that chose the platform *because* it lets them keep things private, and will publish almost nothing. A catalog with nine courses is worse than no catalog.

### The real costs, none of them code
- **Content moderation becomes ours.** Publicly listed content is published under the platform's brand and indexed. This requires a content policy, a takedown process, and the willingness to de-list a paying tenant.
- **Marketplace economics.** Revenue share means platform fees, split payouts, refunds, chargebacks, and money disputes with tenants. Paystack supports splits and the Reaxis payment-routing pattern applies — but the disputes, not the code, are the cost.
- **The empty-catalog problem.** Discovery only works at density.

### Sequencing
| When | What |
|---|---|
| Sprints 1 & 3 (near-zero cost) | `visibility` fields, `CatalogListing` model, publish-as-projection, consent gate on publish, unpublish-on-revocation. Nothing user-facing ships. |
| Sprint 6 | Money model carries a `platformFee` and split-payout concept, set to zero. Retrofitting revenue share into a settled ledger is painful; anticipating it is a field. |
| Sprint 10 | Institution directory. Safe, useful, fills immediately. |
| Sprint 11+ | Course catalog, cross-tenant learner accounts, enrolment from catalog — **only when supply justifies it**. |
| On demand | Ratings, reviews, revenue share, recommendations. Pulled by a paying tenant, never pushed by ambition. |

Cross-tenant learner identity is already supported: `User` is global, `Membership` is per-tenant. No migration is required to turn the catalog on.

---

## 8. Competitive gap audit

Benchmarked against Moodle and Canvas (institutional LMS), Open edX, and Docebo. **Not** Coursera — Coursera is a marketplace with an LMS inside it; its hard problems (catalog, conversion, degree partnerships) are not ours.

### Where the platform wins
| Capability | Us | Moodle / Canvas | Coursera | Thinkific |
|---|---|---|---|---|
| Eligibility on attested attributes | yes | no — prerequisites only | no | no |
| Consent revocation propagates to content | yes | no | no | no |
| Provenance / TK labels rendered to learner | yes | no | no | no |
| Oral assessment, rubric, elder moderation | yes | partial | partial | no |
| Offline-first, low-bandwidth, African payments | yes | partial | partial | no |

No comparator has the first three. That is the defensible position.

### Gaps that must close
| Gap | Severity | Sprint |
|---|---|---|
| Gradebook (weighting, schemes, overrides, transcripts) | blocking | 5b |
| Quiz engine (question bank, types, pools, auto-marking) | blocking | 5b |
| SSO — SAML / Azure AD / Google Workspace | blocking | 8 |
| Course copy and versioning across sessions | high | 1 |
| Notifications by SMS and WhatsApp, not just email | high | 2 |
| Scheduled sessions and attendance capture | high | 2 |
| Groups within a cohort | medium | 2 |
| Accessibility — WCAG 2.1 AA, VPAT | medium | every sprint; audited in 8 |
| Tenant data export and offboarding | medium | 7 |
| SIS import (CSV, OneRoster) | medium | 8 |
| LTI 1.3 Advantage (platform and tool) | strategic | 9 |

---

## 8. Non-goals

**Permanent:**
- **Peer review** — see ADR-010.
- **AI tutoring or generation over tenant content.** For OISS this would violate the archive's AI boundary policy. More generally it is a promise the platform cannot yet keep responsibly.
- **Marketplace / public catalog / recommendation engine.** That is Coursera's business, not ours.

**Deferred, not rejected:**
- SCORM import; xAPI / Caliper event emission to an external LRS
- Live video conferencing — link out to Zoom or Meet; capture attendance, not video
- Native mobile apps — the PWA is the mobile strategy

---

## 9. Sprint plan

| Sprint | Delivers | Exit condition |
|---|---|---|
| **0** — Foundation | Tenant, User, Membership, roles. Auth + MFA + invites. `tenant-guard` Mongoose plugin. Feature registry. Tenant onboarding. Six checkers. | A second tenant is provisioned and provably cannot read the first tenant's documents — demonstrated by a test that tries and fails. |
| **1** — Curriculum | Program → Course → Module → Lesson → ContentBlock. Locale maps throughout, diacritic-insensitive search. Asset pipeline: upload, checksum, transcode ladder, transcripts, captions. Course copy and versioning. Authoring UI. | An admin builds a course in English and Yorùbá with audio, clones it into next session, and a learner preview renders it. |
| **2** — Enrollment | Cohort, Application, Enrollment, LessonProgress. Groups. Scheduled sessions and attendance. Multi-channel notifications behind one `NotificationChannel` interface (email, SMS, WhatsApp). | A cohort opens, a learner applies, a registrar admits, progress persists, and a reminder arrives by WhatsApp. |
| **3** — Eligibility ⚠️ | **The keystone.** AttestationType, Attestation (append-only; revocation is a write). EligibilityPolicy + rule registry + evaluator. ContentPolicy. AccessLog (append-only). Policy builder UI. `denialMessage` rendering. | A gated lesson is invisible without the attestation, visible when an assessor issues it, and invisible again within one request of revocation — and all three evaluations appear in the access log. |
| **4** — Learner PWA | Offline lesson packs honouring `offlineCacheable`. Streaming-only for restricted tiers. Watermarking. Service worker with the BUILD-version discipline. Audio-first low-bandwidth mode. | A learner on 3G completes a downloadable lesson offline; a tier-3 lesson refuses to cache. |
| **5a** — Assessment | Assessment, Rubric, Submission, AssessorAssignment, Grade. In-browser recording, chunked resumable upload. Rubric grading. Second-marking and moderation (a second `Grade`, never an overwrite). Spoken feedback. Registers `assessment_score`. | A 6-minute recitation survives two dropped uploads, is graded, is moderated by an elder, and both judgements persist. |
| **5b** — Gradebook & quiz | Line-item gradebook: categories, weights, schemes, overrides, transcripts. Quiz engine: question bank, question types, pools, randomisation, timing, partial credit, auto-marking. | A weighted final grade computes correctly, an override is attributed to a named person, and a transcript exports. |
| **6** — Commerce | FeeSchedule, PaymentPlan, Invoice, Payment. `PaymentProvider` interface + Paystack adapter (Flutterwave, Stripe stubbed). Installments, bank transfer with manual confirmation, waivers. Registers `payment_state`. | A learner part-pays, keeps access, misses an installment, loses access — enforced by the eligibility engine, not by bespoke payment code. |
| **7** — Credentials | CredentialTemplate, Credential, serial format, public QR verification, transcripts. Instructor and registrar analytics. Tenant data export. | A stranger scans a certificate and it verifies against the public endpoint, revealing the award and nothing else. |
| **8** — Institutional readiness | SSO (SAML / OIDC). SIS and CSV import. WCAG 2.1 AA audit + VPAT. | An institution's IT department can onboard 300 learners without creating a single password. |
| **9** — LTI 1.3 Advantage | Platform and tool roles: OIDC launch, Deep Linking 2.0, Names and Roles, Assignment and Grade Services against the line-item gradebook. | A university's Canvas can launch a course from this platform, and scores flow back. |

**MVP = Sprints 0–5b.** Sprints 6–7 make it sellable. Sprint 8 is what unlocks tenants two and three — without SSO and a gradebook, the eligibility engine will not save a deal.

### Sequencing rules
1. **No real restricted material enters the system before Sprint 3 ships.** Not for testing. Not for a demo. Synthetic content only. A genuine elder recording sitting in a database with no access log and no policy engine is precisely the harm the architecture exists to prevent.
2. **Sprint 3 cannot be rushed.** Everything after it assumes it is correct. If something must slip, let it be 6 or 7.
3. **Commerce is late on purpose.** Manual invoicing for the first tenant is survivable. A broken access model is not.
4. **Accessibility is not a sprint.** It is a standing requirement in every sprint, audited in Sprint 8.

---

## 10. Open decisions

1. **Product name and domain.** Blocking repo creation.
2. **Do elders/assessors exist as platform users, or only in the archive?** Recommend in-platform, with the archive as system of record for *deposit* consent only.
3. **Gendered and lineage-based restriction.** The platform provides the mechanism. Whether and how OISS uses it is tenant governance, unresolved in the archive work and inherited here. The platform must not encode an opinion.
4. **Traditional medicine liability.** Needs legal input *before* Sprint 1 content authoring, not after.
5. **Posthumous consent.** Still open from the archive work. It will not resolve itself.
6. **Data residency trigger.** At what point does an EU or US tenant force regional deployment?
7. **Free tier?** Affects onboarding funnel and abuse surface.

---

## 11. Next artefact

Sprint 0 scaffold: repo layout, `tenant-guard` Mongoose plugin, auth + membership, and the six checkers — delivered as a file manifest.
