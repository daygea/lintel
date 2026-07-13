# Engineering Plan & Handover
## Lintel — multi-tenant learning platform — v1.1

**Audience:** the engineer building this, whether that is the founder or someone who has never met him.
**Status:** **Sprint 0 shipped and green** (15/15 isolation tests, 9/9 checkers). Sprint 1 is next.

**Changes since v1.0**
- Product named: **Lintel**.
- **WhatsApp deferred** (ADR-013). The `NotificationChannel` interface ships; the WhatsApp adapter does not. An external approval gate that can idle a solo builder for weeks is not an acceptable dependency. Replaced by SMS (Sprint 2) and Web Push (Sprint 4, free, no gatekeeper).
- Sprint 0 marked complete, with the three bugs it surfaced recorded in Part III so they are not repeated.
**Companion documents:** `LMS-architecture-data-model-v0.2.md` (data model, ADRs), `OISS-presentation-brief.md` (first tenant, governance decisions outstanding).

---

# Part I — Read this before you write any code

## 1. What this product is

A multi-tenant learning platform for institutions **whose access to teaching is conditional on who the learner is, not merely on whether they paid.**

Three capabilities define it. Everything else is table stakes.

1. **Eligibility engine** — access gated on verified, revocable, human-issued attributes of the learner.
2. **Content policy** — per-item sensitivity driving watermarking, stream-only delivery, download prohibition, and mandatory access logging.
3. **Human performance assessment** — audio/video submissions, rubric-graded by named assessors, with second-marking and moderation.

The first design partner is the Obatala Institute of Sacred Studies (OISS), a Yorùbá sacred-studies institution. **OISS is not the product.** It is the hardest tenant, chosen deliberately because it forces the primitives above into existence. A school of midwifery gating a drug-administration module on a professional licence uses the identical machinery.

## 2. The ten invariants

If you break one of these, you have broken the product. They are not preferences.

1. **No tenant term in the codebase.** Nothing named Yorùbá, Ifá, Òrìṣà, initiation, midwifery, or licence appears in code, schema, or enum. Those are rows in `AttestationType` and `EligibilityPolicy`. If you find yourself writing an `if` about a tenant, stop.
2. **Every tenant-owned document carries `tenantId`, enforced at the driver level.** Not by discipline. See §6.
3. **Archive material is referenced, never copied.** No media bytes from an external archive are ever persisted in our storage. See §8.
4. **`Attestation`, `Grade`, and `AccessLog` are append-only.** Revocation is a *write*, not a delete. Moderation is a *second Grade*, not an update. Enforced by pre-hooks that throw on `update`/`delete`.
5. **Publication is an act, never a flag.** The public catalog reads `CatalogListing`, which only exists because a named human published and the policy engine cleared it. There is no code path from content to catalog.
6. **Fail closed.** `visibility` defaults to `private` on every course and block, forever. New content is never public.
7. **Money is `{ amount: Int (minor units), currency: 'NGN' }`.** Never a float, never a bare number.
8. **Every learner-visible content field is a locale map**, not a string.
9. **Controllers contain no business logic.** EJS controllers and JSON API handlers both call the same service. Enforced by `check-api-parity`.
10. **No real restricted material enters any environment before Sprint 3 ships.** Not for testing. Not for a demo. Synthetic content only. An elder's recording sitting in a database with no access log and no policy engine is precisely the harm this architecture exists to prevent.

## 3. Glossary

A new engineer will misread the domain without this.

| Term | Meaning |
|---|---|
| **Tenant** | An institution. Has its own branding, courses, learners, rules, and payment config. |
| **Attestation** | A verified, revocable statement about a learner, issued by a named authorised person. *"Babalọ́lá attests that Adéọlá holds Ìtẹ̀fá standing."* Never issued by the software. Never issued by a payment. |
| **AttestationType** | A tenant-defined kind of attestation. `itefa-standing`, `nmcn-licence`, `practitioner`. Tenant data, not code. |
| **EligibilityPolicy** | A named, reusable set of rules deciding who may receive a teaching. Composed of rule types from the registry. |
| **Rule registry** | The plugin system the eligibility evaluator uses. Rule types register themselves; the evaluator is written once and never modified. |
| **ContentPolicy** | Per-item delivery rules: downloadable, watermarked, stream-only, logged. |
| **Consent tier** | 0–5. Set by the *archive*, not by us, reflecting what a depositor agreed to. Tier 3+ means teaching-only, no publication, no download. |
| **TK Label** | Traditional Knowledge label. Attribution and use terms travelling with archive material. Must render to the learner; never stripped. |
| **Held** | A teaching the learner is not (yet) eligible to receive. **Not an error.** Rendered with the tenant's own words. |
| **Line item** | A gradable entry in a course gradebook. Named this way deliberately: LTI Advantage's grade service posts against line items. |
| **Olùkọ́** | Yorùbá for teacher. Appears in *tenant content*, never in code. |
| **Archive** | A separate OISS system holding deposited recordings and their consent. We are an API consumer of it, with no privileged access. |

## 4. Stack

| Layer | Choice | Note |
|---|---|---|
| Runtime | Node.js 22 LTS | |
| Web | Express 5 | |
| Admin UI | EJS, server-rendered | Fast to build; the founder is fluent |
| Learner UI | PWA (vanilla or light framework), service worker, IndexedDB | Offline packs, in-browser recording |
| DB | MongoDB Atlas, Mongoose 8 | Shared DB, shared schema, `tenantId` everywhere |
| Cache / queue | Redis + BullMQ | Transcode, notifications, webhook retries |
| Object storage | Cloudflare R2 (S3-compatible) | **Zero egress fees** — decisive for video in Africa |
| Media | ffmpeg in a worker | Bitrate ladder, HLS for stream-only content |
| Payments | Paystack first, behind a `PaymentProvider` interface | Flutterwave and Stripe as later adapters |
| Notifications | Email + SMS + Web Push behind `NotificationChannel` | Email deliverability is poor in Nigeria. SMS is transactional-only (DND regime). **WhatsApp is a stub — see ADR-013.** |
| Auth | Session cookie (`express-session` + `connect-mongo`) + CSRF | Same-origin for both surfaces. SAML/OIDC in Sprint 8 |
| Logging | pino, structured, `requestId` + `tenantId` on every line | |
| Errors | Sentry | |
| Tests | Vitest + supertest | |
| Hosting | Render (app + workers), Atlas (DB), R2 (media) | |

## 5. Repository layout

```
src/
  config/
    features.js          feature registry — single source of truth
    env.js               validated env (fail fast on boot)
    plans.js             subscription tiers
  models/                Mongoose schemas only. No logic.
  plugins/
    tenant-guard.js      THE most important file in the repo
    append-only.js       blocks update/delete on immutable collections
    locale-map.js        i18n field type + normalised search shadow field
  services/              ALL business logic lives here
    eligibility/
      evaluator.js       written once in Sprint 3, never modified
      registry.js        rule types register here
      rules/             one file per rule type
    content/
    assessment/
    commerce/
    notification/
    archive/             external archive API client
  controllers/
    web/                 EJS. Thin. Calls services.
    api/                 JSON. Thin. Calls services.
  routes/
  views/                 EJS templates
  workers/               BullMQ processors
  lib/
    context.js           AsyncLocalStorage tenant context
    money.js             minor-units arithmetic. Never use raw numbers.
    errors.js            error taxonomy
public/                  PWA, service worker, offline shell
scripts/
  checkers/              the seven checkers (§7)
  migrations/            forward-only, numbered
tests/
  isolation/             tenant isolation suite — MUST pass to merge
  eligibility/           the golden-path suite for Sprint 3
seed/
  synthetic/             fake tenants and content. NEVER real material.
```

## 6. Tenant isolation — how it actually works

The single highest-risk failure in this product is one tenant reading another's data. It is not mitigated by careful querying; it is mitigated structurally.

**Request context.** On every request (web, API, and worker job), resolve the tenant and store it in `AsyncLocalStorage`:

```js
// lib/context.js
const { AsyncLocalStorage } = require('node:async_hooks');
const als = new AsyncLocalStorage();

const runWithTenant = (tenantId, userId, fn) =>
  als.run({ tenantId, userId }, fn);

const currentTenantId = () => {
  const ctx = als.getStore();
  if (!ctx?.tenantId) throw new NoTenantContextError();
  return ctx.tenantId;
};
```

**The guard plugin.** Every tenant-scoped schema registers `tenant-guard`. It:

- adds `tenantId` (required, indexed) to the schema;
- on `pre` for every find/count/update/delete hook, injects `{ tenantId: currentTenantId() }` into the filter;
- on `pre('save')`, stamps `tenantId` from context if absent, and **throws if the document's `tenantId` differs from the context**;
- throws `NoTenantContextError` if there is no context.

Deliberate consequence: **a query written without tenant context crashes rather than leaking.** That is the desired failure mode.

**Escape hatch.** Platform-level operations (superadmin, cross-tenant jobs) use an explicit `runAsPlatform()` wrapper that sets a sentinel. It is greppable, auditable, and must never appear in `controllers/` or `services/` outside `services/platform/`.

**Indexes.** Every index is compound and leads with `tenantId`. A non-leading index is a bug — `check-tenant-indexes` fails the build.

## 7. The checkers

Run in CI and in a pre-commit hook. A red checker blocks merge. These exist because the founder has been bitten by every one of them before.

| Checker | Fails when |
|---|---|
| `check-tenant-guard` | A schema in `models/` lacks the `tenant-guard` plugin and is not in the platform allowlist. |
| `check-tenant-indexes` | Any index on a tenant-scoped collection does not lead with `tenantId`. |
| `check-append-only` | Code calls `updateOne`/`deleteOne`/`findOneAndUpdate` on `Attestation`, `Grade`, or `AccessLog`. |
| `check-api-parity` | A service method is reachable from `controllers/web` but not `controllers/api`, or vice versa, without an explicit `@parity-exempt` annotation. |
| `check-no-tenant-terms` | A banned domain term (maintained wordlist: `ifa`, `orisha`, `itefa`, `midwif`, `nmcn`, …) appears anywhere in `src/`. |
| `check-money` | A field named `*price*`, `*fee*`, `*amount*` is typed `Number` rather than the `Money` sub-schema. |
| `check-locale-fields` | A learner-visible content field is typed `String` rather than `LocaleMap`. |
| `check-ejs-syntax` | An EJS template fails to parse. |
| `check-route-handlers` | A route references a handler that does not exist. |

## 8. Archive integration contract

The LMS is an ordinary external API consumer against a whitelisted publication set.

```
GET  /api/v1/publication-sets/:setId/items      → metadata only
GET  /api/v1/items/:accession                   → metadata, tkLabels, consentTier
POST /api/v1/items/:accession/access-url        → { url, expiresAt }  TTL ≤ 300s
     body: { learnerRef, tenantRef, purpose: 'lesson_render' }
```

Webhooks in (signed, idempotent, retried):

```
item.consent_revoked   → mark referencing ContentBlocks unavailable,
                          purge cached metadata,
                          UNPUBLISH any CatalogListing that references them,
                          notify tenant admin
item.tier_changed      → re-evaluate; may render, may withhold
item.metadata_updated  → refresh cache
```

**Invariants.** Cache metadata only, never bytes. The archive performs its *own* tier check on every access-url request — our eligibility engine saying "allowed" is not sufficient authority for the archive to release restricted media. Every issuance is logged **in the archive**, against the learner reference. TK Labels and accession numbers render to the learner.

## 9. Definition of done (every sprint, no exceptions)

- [ ] All checkers green
- [ ] Tenant isolation suite passes
- [ ] Unit tests on every service method with a branch
- [ ] At least one integration test per user-visible flow
- [ ] Keyboard-navigable; visible focus; screen-reader labels on all controls
- [ ] Works on a 360px viewport
- [ ] Works on a throttled 3G connection (Chrome DevTools "Slow 3G")
- [ ] Structured logs carry `requestId` and `tenantId`
- [ ] Migration written and reversible-by-forward-fix
- [ ] `docs/` updated if a decision changed

## 10. Estimating

Estimates below are in **focused engineering weeks** — uninterrupted, one competent engineer. The founder holds a day job at the NCC; calendar time will run **2–3×** these figures. Plan accordingly and tell OISS the truth about dates.

**MVP (Sprints 0–5b): ~26 focused weeks.**
**Sellable (through Sprint 7): ~34 focused weeks.**

---

# Part II — The sprints

## Sprint 0 — Foundation and tenancy ✅ SHIPPED
**Actual: ~1 week · 15/15 isolation tests green · 9/9 checkers green**

**Goal.** A second tenant can be provisioned and provably cannot see the first tenant's data.

**Build**
- `Tenant`, `User`, `Membership` models. Roles: `owner`, `admin`, `registrar`, `instructor`, `assessor`, `learner`. Roles live on `Membership`, never on `User` — a person may be a learner at one institution and an assessor at another.
- `plugins/tenant-guard.js` and `lib/context.js` (§6). **Build this before any other model exists.**
- `plugins/append-only.js`.
- Auth: register, login, session, MFA (TOTP), password reset, invite flow.
- Tenant onboarding: create tenant, set slug/domain/branding/locales/currency/timezone.
- `config/features.js` feature registry; `TenantPlan` for database-driven plan features.
- Subdomain and custom-domain routing → tenant resolution middleware.
- All nine checkers, CI, pre-commit hook.
- `seed/synthetic/` — two fake tenants with fake everything.

**Exit criteria**
- A test that provisions Tenant A and Tenant B, creates documents in each, then attempts every read/update/delete of B's documents while in A's context — and **fails every attempt**.
- A query executed with no tenant context **throws**, and the test asserts the throw.
- `npm run check` is green.

**Not in this sprint.** Any content model. Any UI beyond auth and tenant setup. Resist this.

**Risks.** Getting the guard plugin wrong here is unrecoverable — every later sprint sits on it. Spend the extra two days. Write the isolation suite *first*.

### What Sprint 0 actually taught us

Three bugs, all caught by the suite rather than by a customer. Recorded so they are not repeated.

**1. Mongoose runs validation BEFORE `pre('save')`.** Since `tenantId` is `required`, stamping it in `pre('save')` is too late — validation has already rejected the document. The stamp happens in `pre('validate')`; `pre('save')` is retained as a second gate that asserts rather than stamps. Do not "tidy" this away.

**2. A Mongoose Query is lazy, and can escape the tenant scope.** `runWithTenant(id, uid, () => Model.find({}))` builds the query inside the context, returns it, and then executes it *outside* — throwing `NoTenantContextError` from code that visibly has a context. This does not affect request handling (`tenantResolver` wraps `next()`, so the whole async chain inherits the context and a plain `await Model.find()` in a controller is safe). It bites at boundaries: **tests, seeds, workers.** `runWithTenant` and `runAsPlatform` now detect an unexecuted Query and throw an actionable message. At boundaries, always `.exec()`.

**3. A destructive seed script pointed at a cloud cluster is a loaded gun.** `seed/synthetic.js` refuses to run unless the database is unmistakably a development one. If the guard refuses, do not weaken it — point it somewhere else.

Also worth knowing: MongoDB Atlas rejects a non-allowlisted IP by **failing the TLS handshake with alert 80**, not by timing out. It looks like a certificate problem and is a firewall problem. Add your IP under Network Access.

---

## Sprint 1 — Curriculum and media
**~4 weeks · depends on: 0**

**Goal.** An admin builds a course in two languages with audio and video; a learner preview renders it.

**Build**
- Models: `Program`, `Course`, `Module`, `Lesson`, `ContentBlock`, `Asset`.
- `plugins/locale-map.js`: a `LocaleMap` field type (`{ en: '…', yo: '…' }`) that maintains a **normalised shadow field** with diacritics folded, so search is diacritic-insensitive while display is diacritic-correct. The founder already owns a Yorùbá normaliser (`mark_yoruba.py`) — port its logic.
- Media pipeline: chunked resumable upload → R2 → BullMQ job → ffmpeg bitrate ladder + HLS → transcript and caption storage (locale-keyed).
- `visibility` field on `Course` and `ContentBlock`, **defaulting to `private`**. Not used yet. Build it now (invariant 6).
- Course copy and versioning: clone a course into a new session. Cheap now, hellish later — OISS re-runs every programme annually.
- Authoring UI (EJS): rich text, media upload, block reordering.
- Content search across a tenant's own material.

**Exit criteria**
- A course authored in English and Yorùbá, with a 40-minute video, renders in learner preview.
- Searching `oriki` (no diacritics) finds a lesson titled `Oríkì`.
- Cloning a course into cohort 2027/2028 produces an independent copy.
- A new `ContentBlock` is `private` without anyone setting it.

**Not in this sprint.** Access control of any kind. Everything is visible to anyone enrolled. That is correct for now.

**Risks.** Transcoding cost and time. Test with a real 1-hour video early, not a 30-second clip.

---

## Sprint 2 — Enrolment, cohorts, and notifications
**~3 weeks · depends on: 1**

**Goal.** A cohort opens, a learner applies, a registrar admits, progress persists, and a reminder reaches the learner.

**Build**
- Models: `Cohort`, `Application`, `Enrollment`, `LessonProgress`, `Group`, `Session`, `Attendance`.
- Admissions review queue.
- Scheduled live sessions with attendance capture (the video call itself is Zoom/Meet — **do not build conferencing**).
- Groups within a cohort (tutorial groups, study circles).
- `NotificationChannel` interface + adapters: **email**, **SMS** (Termii or Africa's Talking). Templates are locale-mapped and tenant-authored.
- **WhatsApp adapter is a stub that throws `NotImplemented`.** Keep the seam; do not build behind it (ADR-013). The day a tenant pays for WhatsApp it is a week of work, not a re-architecture.
- SMS is **transactional only** — "your assessment is due Friday", never "see our new course". Nigeria's DND regime filters anything that reads as promotional, and a filtered sender reputation is hard to recover.
- Learner dashboard, instructor roster.

**Exit criteria**
- Full lifecycle: cohort opens → learner applies → registrar admits → learner progresses → progress persists across sessions.
- A due-date reminder is delivered by email **and** SMS, and both deliveries are logged.
- Calling the WhatsApp adapter throws `NotImplemented` — loudly, not silently.
- Attendance at a live session is recorded against an `Enrollment`.

**Not in this sprint.** Payment. Enrolment is free and manual for now.

**Risks.** SMS deliverability, not availability. Nigerian networks filter aggressively; get a registered sender ID early and test against all four major networks before you promise a tenant that reminders work.

**Known weakness, stated honestly.** Reminder delivery in Sprint 2 is weaker than v1.0 promised. For OISS — 147 students, an olùkọ́ who knows every one of them, announcements already made by voice on Saturdays — this is survivable. For a tenant like a public-health trainer with thousands of learners across a region, it is not. **That is the tenant who forces the WhatsApp adapter back onto the roadmap**, and it is not the first one.

---

## Sprint 3 — The eligibility engine ⚠️ KEYSTONE
**~5 weeks · depends on: 2 · blocked on: six OISS governance decisions**

> **This is the sprint that cannot be rushed.** Every later sprint assumes it is correct. If something must slip, let it be 6 or 7. If you are the engineer inheriting this project and you have time for exactly one sprint, make it this one.

**Goal.** A gated lesson is invisible without the attestation, visible when an assessor issues it, invisible again within one request of revocation — and all three evaluations appear in the access log.

**Build**

*Attestations*
- `AttestationType` (tenant-defined: slug, label, `requiresIssuerRole`, `isSensitive`, `defaultValidityDays`).
- `Attestation` — **append-only**. Fields: subject, type, value, issuer, issuedAt, expiresAt, evidence, note, revokedAt, revokedBy, revocationReason. Revocation writes a new state; nothing is deleted, ever.
- Issuance UI, restricted to the role named on the `AttestationType`.
- Attestation register (registrar view), including withdrawn ones with reasons.

*The engine*
- `services/eligibility/registry.js` — rule types register `{ slug, paramsSchema, evaluate(params, ctx) }`.
- `services/eligibility/evaluator.js` — **written once, never modified.** Pure function: `evaluate(policy, learnerContext) → { allowed, failedRules[], message }`. Memoised per request; invalidated on any `Attestation`, `Enrollment`, `Grade`, or `Payment` write.
- Rules shipped in this sprint: `enrolled`, `course_completed`, `attestation`, `membership_role`, `manual_approval`.
  Rules registered later: `assessment_score` (5a), `payment_state` (6).
- `EligibilityPolicy` model + policy builder UI + the locale-mapped `denialMessage`.
- Resolution order: Lesson → Course → Program. Absent all three, enrolment alone suffices.

*Content policy*
- `ContentPolicy`: `downloadable`, `offlineCacheable`, `watermark`, `streamOnly`, `sessionBound`, `maxConcurrentSessions`, `logAccess`.
- **`offlineCacheable` is only honoured when `downloadable` is true.** State this in code and in a test. It is not a bug to be discovered later.
- Signed, short-TTL, session-bound media URLs.
- Watermarking: learner name + timestamp burned into playback.

*The record*
- `AccessLog` — **append-only**. Every evaluation, granted or withheld, with policy slug, learner, content, IP, session.

*Archive*
- `services/archive/` client. `archive_ref` content blocks. Consent-revocation webhook handler.

**Exit criteria**
1. A tier-3 lesson is invisible to a learner without the attestation. The `denialMessage` renders in the learner's locale, in the tenant's words.
2. An assessor issues the attestation. The lesson becomes visible **on the next request**.
3. The attestation is revoked. The lesson becomes invisible **on the next request**.
4. All three evaluations appear in `AccessLog` with the policy slug.
5. Attempting `Attestation.updateOne()` **throws**.
6. A tier-3 block refuses to be marked `offlineCacheable`.
7. An archive `consent_revoked` webhook makes the referencing block unavailable within one request.
8. `check-no-tenant-terms` is green — nothing about Ìtẹ̀fá is in the code.

**Not in this sprint.** The catalog. Payment rules. Quizzes.

**Risks.**
- **Governance, not engineering.** Six decisions are outstanding from OISS (see the presentation brief): which standings exist and who may grant them; whether restriction by gender or lineage applies and who adjudicates; the exact denial wording; whether traditional-medicine dosage may be taught at all; posthumous consent. **The engine cannot be configured without these, though it can be built.** Chase them from day one of Sprint 2.
- Cache invalidation. A stale eligibility decision is a security incident, not a performance bug. Prefer correctness; memoise per-request only.

---

## Sprint 4 — Learner PWA and Web Push
**~4 weeks · depends on: 3**

**Goal.** A learner on 3G completes a downloadable lesson offline; a tier-3 lesson refuses to cache; a reminder arrives without Meta's permission.

**Build**
- Service worker with the BUILD-version discipline (the founder has been burned by stale service workers on Orírùn — carry that lesson over).
- Offline lesson packs in IndexedDB, honouring `offlineCacheable`.
- HLS streaming for `streamOnly` content; no direct asset URL ever issued.
- Audio-first low-bandwidth mode.
- Install prompt, offline shell, sync-on-reconnect.
- **Web Push** (ADR-014): VAPID keys, `PushSubscription` model, permission prompt, delivery worker. Registers as a `NotificationChannel` adapter alongside email and SMS.

**Why Web Push belongs here.** It is free, needs approval from nobody, works on Android Chrome and on iOS 16.4+ once the PWA is installed, and reaches precisely the learner who cared enough to install the app. The infrastructure was being built anyway. It is the honest replacement for WhatsApp, not a consolation prize.

**Exit criteria**
- Aeroplane mode: a downloaded lesson plays; a tier-3 lesson is absent from the cache entirely (not present-but-locked).
- Chrome "Slow 3G": a lesson is usable.
- Deploying a new build does not serve stale JS.
- A due-date reminder arrives as a push notification on an installed PWA, and the delivery is logged like any other channel.

**Risks.** iOS Safari service-worker and IndexedDB quirks. Budget a week for iOS alone. iOS Web Push requires the PWA to be added to the home screen — it does not work in the browser tab, and learners must be told so.

---

## Sprint 5a — Assessment
**~4 weeks · depends on: 4**

**Goal.** A 6-minute recitation survives two dropped uploads, is graded, is moderated by an elder, and **both judgements persist**.

**Build**
- Models: `Assessment`, `Rubric`, `Submission`, `AssessorAssignment`, `Grade` (**append-only**).
- In-browser recording (MediaRecorder), chunked resumable upload. **Assume the upload will be interrupted. Assume the learner is on 3G.**
- Rubric grading UI: criteria × levels.
- Multi-assessor: primary, second, moderator. Moderation writes a **new `Grade`** with `moderatedFromGradeId`. The provisional grade is never overwritten.
- **Spoken feedback** (`feedbackAssetId`) as a first-class field, not an afterthought. In an oral tradition, written marginalia is the wrong instrument, and a learner who reads slowly is not a learner who learns slowly.
- Registers the `assessment_score` rule type.

**Exit criteria**
- Kill the network twice mid-upload; the submission still completes.
- An elder's moderating grade becomes final; the primary grade is still readable in the record with its author's name.
- `Grade.updateOne()` throws.

**Risks.** MediaRecorder codec support differs across browsers. Normalise server-side; do not trust the client.

---

## Sprint 5b — Gradebook and quiz engine
**~4 weeks · depends on: 5a**

**Goal.** A weighted final grade computes correctly, an override carries a name, and a transcript exports.

**Build**
- **Line-item gradebook.** Every gradable thing is a `LineItem` with a category and weight. This naming is deliberate: LTI Advantage's grade service posts against line items, so a gradebook built without them makes Sprint 9 a migration rather than a feature.
- Grading schemes, weighted categories, drop-lowest, overrides (attributed to a named person), transcripts.
- Quiz engine: question bank, question types (MCQ, multi-select, matching, cloze, numeric, short answer, essay), pools, randomisation, timing, attempts, partial credit, auto-marking.

**Exit criteria**
- A weighted overall grade matches a hand-computed figure.
- An override shows who overrode it and when.
- A transcript exports for a completed programme.

**Not in this sprint.** Proctoring, plagiarism detection. Those are LTI tools in Sprint 9.

---

## Sprint 6 — Commerce
**~4 weeks · depends on: 5b**

**Goal.** A learner part-pays, keeps access, misses an instalment, loses access — **enforced by the eligibility engine, not by bespoke payment code.**

**Build**
- Models: `FeeSchedule`, `PaymentPlan`, `Invoice`, `Payment`. `Money` sub-schema used throughout.
- `PaymentProvider` interface + Paystack adapter. Flutterwave and Stripe adapters stubbed against the same interface so nobody hardcodes Paystack later.
- Instalments. **Bank transfer with manual confirmation is a first-class method**, not a fallback — this is Nigeria.
- Waivers and scholarships as `paymentState: 'waived'` with an audit trail, not a zero-priced invoice.
- **Free is first-class.** A `FeeSchedule` with no items is valid; a tenant may charge nothing for everything. Free ≠ open — an unpriced course can still be gated by attestation. Do not conflate these.
- `platformFee` and split-payout fields on the money model, **set to zero**. Retrofitting revenue share into a settled ledger is genuinely painful; anticipating it is one field.
- Registers the `payment_state` rule type.

**Exit criteria**
- Part-payment grants access; a missed instalment withdraws it, and the withdrawal is visible as a *failed eligibility rule*, not a payment error.
- A fully-free tenant works end to end with no payment provider configured at all.

**Risks.** Paystack webhooks are not idempotent by default. Store `providerRef`, deduplicate, and replay safely.

---

## Sprint 7 — Credentials and export
**~3 weeks · depends on: 6**

**Goal.** A stranger scans a certificate and it verifies — revealing the award and nothing else.

**Build**
- `CredentialTemplate`, `Credential`. Serial format per tenant (`OISS/YIS/2026/00114`).
- Public verification endpoint + QR. The founder built exactly this at the NCC — reuse the pattern, but backed by the platform DB, not a spreadsheet.
- Revocation.
- **Tenant data export.** Full export of content, records, and archive references. Say this to prospects *before* they ask; given the content, "can we leave with our material?" is an ethical requirement, not a sales objection.
- Instructor and registrar analytics.

**Exit criteria**
- Public verification shows name and award only. Never marks. Never standings. Never what they were taught.
- A tenant export round-trips into a fresh instance.

---

## Sprint 8 — Institutional readiness
**~4 weeks · depends on: 7**

**Goal.** An institution's IT department onboards 300 learners without creating a single password.

**Build**
- SSO: SAML 2.0 and OIDC (Azure AD, Google Workspace). **Every institutional buyer above ~200 seats requires this.**
- SIS import: CSV and OneRoster.
- WCAG 2.1 AA audit and remediation; publish a VPAT.

**Exit criteria**
- A learner signs in through Azure AD and lands in the right tenant with the right role.
- Screen-reader walkthrough of the learner flow, end to end.

**Note.** Accessibility is *not* this sprint's invention — it is a standing requirement in every sprint's definition of done (§9). This sprint is where it is audited and certified.

---

## Sprint 9 — LTI 1.3 Advantage
**~4 weeks · depends on: 8**

**Goal.** A university's Canvas launches a course from this platform, and scores flow back.

**Build**
- OIDC launch, Deep Linking 2.0, Names and Roles, Assignment and Grade Services against the Sprint 5b line-item gradebook.
- Both roles: platform (we consume tools) and tool (we are consumed by a university LMS).
- 1EdTech conformance certification.

**Note.** This is deferrable precisely *because* the gradebook was built line-item-native in 5b. If someone changed that, this sprint becomes a migration. Guard it.

---

## Sprint 10 — Institution directory
**~2 weeks · depends on: 7**

**Goal.** A researcher searching for an institution finds it. No teaching material is exposed.

**Build**
- Public institution page per tenant: identity, programmes, how to apply. **Zero course content.**
- Platform-level directory index and search.

**Why here.** Discovery ships as a *directory* long before it ships as a *catalog*, because a directory leaks nothing and is useful from tenant one. It also serves OISS's own stated aim of scholarly dialogue.

---

## Sprint 11+ — Catalog and marketplace
**Only when supply justifies it**

**Do not build this early.** A catalog with nine courses looks like a failed startup. The first fifteen tenants will be institutions that chose this platform *because* it lets them keep things private, and they will publish almost nothing. The catalog is not hard to build; it is hard to *fill*.

**When the time comes**
- `CatalogListing` (the model was built in Sprint 1/3 and has sat unused — deliberately).
- Publish flow: explicit act by a named user → **consent gate** → listing. The gate refuses any block above consent tier 1 or bearing a restrictive TK Label, **even if the tenant insists.**
- Preview is a per-block opt-in that the engine may refuse. "Watch lesson 1 free" is the industry's standard leak vector; do not reproduce it.
- Revocation **unpublishes** the listing, not merely the lesson.
- Cross-tenant learner accounts (already supported: `User` is global, `Membership` is per-tenant — no migration needed).

**And only then, only if a paying tenant asks:** ratings, reviews, revenue share, recommendations. Note that publicly listing content makes **content moderation the platform's liability** — a content policy, a takedown process, and the willingness to de-list a paying tenant. That is a business decision, not an engineering one.

---

# Part III — Things that will bite you

1. **A tenant will eventually need WhatsApp**, and the day they do, the Meta approval clock starts then — not now. That is the deliberate trade in ADR-013: no gatekeeper on the critical path, at the cost of a slower start when the need arrives. Do not let anyone quietly build a direct WhatsApp call to route around the stub.
2. **A stale service worker will convince you the deploy failed.** Version the build; the founder has lost a day to this on Orírùn already.
3. **Cache invalidation on eligibility is a security boundary, not a performance concern.** When in doubt, recompute.
4. **Transcoding a 90-minute lecture is not like transcoding a 30-second test clip.** Find out in Sprint 1, not Sprint 4.
5. **Paystack webhooks arrive more than once.** Deduplicate on `providerRef`.
6. **iOS Safari will cost you a week** on the PWA. Budget it rather than discovering it.
7. **Someone will propose peer review as a cost saving.** It exposes one learner's submission to another; above consent tier 2 that is a consent violation, and the platform cannot verify a peer's entitlement. It is a **permanent non-goal** (ADR-010). Say no, and point here.
8. **Someone will propose "just cache the archive audio, it's faster."** That converts the platform into a consent-laundering machine and no policy document fixes it. Permanent non-goal (ADR-004).
9. **The traditional-medicine content needs a legal opinion before it is authored**, not after. Blocking Sprint 1 content, not Sprint 6.
10. **Do not let a demo deadline put real elder recordings into a pre-Sprint-3 database.** This is the one that will actually happen, under pressure, and it is the one that matters most.

---

# Part IV — Open decisions

| # | Decision | Blocks | Owner |
|---|---|---|---|
| ~~1~~ | ~~Product name~~ — **resolved: Lintel** | — | — |
| 2 | Which attestation types OISS recognises; who may grant each | Sprint 3 config | OISS governance |
| 3 | Whether restriction by gender or lineage applies; who adjudicates | Sprint 3 config | OISS governance |
| 4 | Exact denial wording, Yorùbá and English | Sprint 3 config | OISS governance |
| 5 | Whether traditional-medicine dosage may be taught, and to whom | Sprint 1 content | OISS + legal counsel |
| 6 | Posthumous consent — what happens to an elder's recording after they pass | Sprint 3 | OISS governance (open since the archive work) |
| 7 | Whether OISS seeks external accreditation | Sprint 5b/7 scope | OISS |
| 8 | Do assessors exist as platform users, or sync from the archive? *(Recommend: in-platform; archive is system of record for deposit consent only.)* | Sprint 3 | Founder |
| 9 | Nonprofit / grant pricing tier — a free-to-learner tenant still costs money to host | Sprint 6 | Founder |
| 10 | Data-residency trigger for an EU or US tenant | Sprint 8+ | Founder |

---

*If you are inheriting this codebase: read Part I in full before opening the repo. The invariants are not style preferences — several of them are the entire reason this product exists.*
