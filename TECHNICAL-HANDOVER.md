# Lintel — Technical Handover

**A multi-tenant learning platform for institutions whose access to teaching is conditional on who the learner is, not merely whether they paid.**

> A lintel is the stone that bears the weight above a doorway. Every screen in this product is about a door: opened, held, and who holds the key.

---

**Document status:** living. Updated as the build progresses.
**Covers:** Sprints 0–5b (the sellable MVP), complete and green.
**Last verified against the codebase:** Sprint 5b — 121 tests, 9 checkers, 97 routes, 36 models.
**Audience:** an engineer inheriting this codebase who has never spoken to the author. Read Part I in full before opening the repo.

---

# Part I — Read this before you write any code

## 1. What this product is

A multi-tenant learning platform. What distinguishes it from a commodity LMS is three capabilities, and everything else is table stakes:

1. **An eligibility engine** — access to a teaching is gated on verified, revocable, human-issued attestations about the learner, not merely on payment or enrolment.
2. **Content policy** — per-item sensitivity drives watermarking, stream-only delivery, download prohibition, and mandatory access logging.
3. **Human performance assessment** — audio/video submissions, rubric-graded by named assessors, with moderation where both the junior and senior judgement survive in the record.

The first design partner is the **Obatala Institute of Sacred Studies (OISS)**, a Yorùbá sacred-studies institution. **OISS is not the product.** It is the hardest tenant, chosen deliberately because it forces the primitives above into existence. A school of midwifery gating a drug-administration module on a professional licence uses the identical machinery — and that generality is a hard requirement, not an aspiration (see invariant 1).

## 2. The ten invariants

These are not preferences. Several of them are the entire reason the product exists. Each is enforced by an automated checker (Part IV) or a plugin; where it is, the enforcement is named.

1. **No tenant-specific term appears in the codebase.** Nothing named after a tradition, profession, or institution appears in code, schema, or enum. OISS's rules are *rows* in `AttestationType` and `EligibilityPolicy`, never branches in an `if`. If you find yourself writing a conditional about a tenant, stop. → `check-no-tenant-terms`
2. **Every tenant-owned document carries `tenantId`, enforced at the driver level** — not by developer attention. → `tenant-guard` plugin + `check-tenant-guard`
3. **A query with no tenant context throws rather than leaking.** This is the desired failure mode. Do not "fix" it by defaulting the tenant. → `lib/context.js`
4. **`Attestation`, `Grade`, `AccessLog`, and `AuditLog` are append-only.** A revocation is a *write*. A moderated grade is a *new* grade. When an elder overrules a junior assessor, both judgements survive. → `append-only` plugin + `check-append-only`
5. **Publication is an act, never a flag.** Nothing reaches a public surface except by an explicit act of a named human that the policy engine cleared. → visibility defaults; catalog deferred to Sprint 11
6. **Fail closed.** `visibility` defaults to `private` on every course and block, forever. An unknown or erroring eligibility rule withholds. New content is never public.
7. **Money is `{ amount: Int (minor units), currency }`.** Never a float, never a bare number. → `check-money` (exempts `*Points` fields, which are rubric scores)
8. **Every learner-visible content field is a locale map**, not a string. → `locale-map` plugin + `check-locale-fields`
9. **Controllers contain no business logic.** The EJS (web) and JSON (api) controllers both call the same service. → `check-api-parity`
10. **No real restricted material enters any environment before the eligibility engine ships.** Synthetic content only. This is the invariant most likely to be broken under demo pressure, and the one that matters most.

## 3. Glossary

A new engineer will misread the domain without this.

| Term | Meaning |
|---|---|
| **Tenant** | An institution. Own branding, courses, learners, rules, payment config. |
| **Membership** | A person's standing *within* one institution. Roles live here, never on `User` — a person may be a learner at one institution and an assessor at another. |
| **Attestation** | A verified, revocable statement about a learner, issued by a named authorised person. Never issued by the software, never by a payment. |
| **AttestationType** | A tenant-defined *kind* of attestation (`itefa-standing`, `practitioner-standing`). Tenant data, not code. |
| **EligibilityPolicy** | A named, reusable set of rules deciding who may receive a teaching. Composed of rule types from the registry. |
| **Rule registry** | The plugin system the evaluator uses. Rule types register themselves; the evaluator is written once and never modified (ADR-008). |
| **ContentPolicy** | Per-item delivery rules: downloadable, watermarked, stream-only, logged. |
| **Consent tier** | 0–5, set by the *archive*, reflecting what a depositor agreed to. Availability (`archiveRef.available`) is separate — the tier is what they agreed to; availability is whether that agreement still stands. |
| **Held** | A teaching the learner is not (yet) eligible to receive. **Not an error.** Rendered in the tenant's own words. |
| **Line item** | A gradable entry in a course gradebook. Named deliberately: LTI Advantage's grade service posts against line items (Sprint 9). |
| **Archive** | A separate system holding deposited recordings and their consent. Lintel is an ordinary API consumer of it, referencing material, never copying bytes. |

## 4. Stack

| Layer | Choice | Note |
|---|---|---|
| Runtime | Node.js 22 (CommonJS) | |
| Web | Express 4 | |
| Admin UI | EJS, server-rendered | |
| Learner UI | PWA — service worker, IndexedDB, vanilla JS | `public/app/`, `public/sw.js` |
| DB | MongoDB Atlas, Mongoose 8 | Shared DB, shared schema, `tenantId` everywhere |
| Object storage | Cloudflare R2 (S3-compatible) | Zero egress. Private bucket, signed URLs only. |
| Media | ffmpeg in a worker | Audio & video ladders + HLS |
| Job queue | **MongoDB-backed** (`Job` model + `lib/queue.js`) | Not BullMQ — see ADR-005. Swappable behind a narrow interface. |
| Auth | `express-session` + `connect-mongo`, bcrypt, TOTP MFA, double-submit CSRF | |
| Notifications | Email + SMS + Web Push behind one interface; WhatsApp stubbed (ADR-013) | |
| Payments | *Not built yet* — Sprint 6 (Paystack behind a `PaymentProvider` interface) | |
| Logging | pino, structured, `tenantId` on every line | |
| Tests | Vitest + `mongodb-memory-server` | |

Dependencies actually installed: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `bcryptjs`, `connect-mongo`, `dotenv`, `ejs`, `express`, `express-session`, `mongoose`, `otplib`, `pino`, `pino-http`, `web-push`.

## 5. Running it

```bash
cp .env.example .env          # fill in the values below
npm install
npm run indexes               # build/sync all indexes — do this after any index change
npm run seed                  # two synthetic tenants (alpha, beta)
npm run dev                   # web, on PORT (default 3001)
npm run worker                # transcode worker, separate process
```

Development runs on `*.localhost` (auto-resolves in Chrome/Firefox; **Safari does not** — add `/etc/hosts` entries for Safari). Visit e.g. `http://alpha.localhost:3001`. The learner PWA is at `/app/`.

**Required `.env`:** `MONGODB_URI` (must include a DB name before `?`), `SESSION_SECRET` (≥32 chars), `ROOT_DOMAIN`.
**Media (R2):** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`. Bucket must be **private**, and its CORS must `ExposeHeaders: ["ETag"]` or chunked uploads fail at part one.
**Web Push:** `VAPID_PUBLIC`, `VAPID_PRIVATE` (generate with `npx web-push generate-vapid-keys`).

### The scripts

| Command | Does |
|---|---|
| `npm run dev` | Web server, watch mode |
| `npm run worker` | Transcode worker (must be a separate process) |
| `npm run check` | The nine checkers — a red checker blocks merge |
| `npm test` | Full Vitest suite |
| `npm run test:isolation` | Just the tenant-isolation suite — the one that matters most |
| `npm run indexes` | Sync every model's indexes to the code (see §11 gotcha) |
| `npm run seed` | Two synthetic tenants |

## 6. Tenant isolation — how it actually works

The single highest-risk failure is one tenant reading another's data. It is mitigated *structurally*, not by careful querying.

**Request context** (`src/lib/context.js`). On every request and every worker job, the tenant is resolved and stored in `AsyncLocalStorage`:
- `runWithTenant(tenantId, userId, fn)` — run inside a tenant's context.
- `runAsPlatform(reason, fn)` — cross-tenant operations. The `reason` is mandatory and greppable; every use must justify itself.
- `currentTenantId()` — throws `NoTenantContextError` if there is no context. **That throw is a feature.**

**The guard plugin** (`src/plugins/tenant-guard.js`), registered by every tenant-scoped schema:
- Adds `tenantId` (required, indexed, immutable).
- Injects `{ tenantId }` into every find/count/update/delete filter and every aggregation.
- Stamps `tenantId` on `pre('validate')` — **not `pre('save')`**, because Mongoose validates before save hooks and `tenantId` is required (this was a real Sprint 0 bug).
- Re-asserts on `pre('save')` as a second gate.
- Throws `CrossTenantWriteError` if a document or filter names a foreign tenant.

**A subtlety that will bite you at boundaries:** a Mongoose `Query` is lazy. A callback that *returns* an unexecuted query lets it run after the context has unwound. `runWithTenant`/`runAsPlatform` detect this and throw an actionable message. In tests, seeds, and workers, always `.exec()`. Inside a request this never arises — `tenantResolver` wraps `next()`, so the whole async chain inherits the context.

**Platform-scoped models** (`Tenant`, `User`) do not use the guard and are allowlisted in `check-tenant-guard.js`.

## 7. The append-only discipline

`Attestation`, `Grade`, `AccessLog`, `AuditLog` use the `append-only` plugin, which throws on any update or delete. The pattern:
- **Revocation** of an attestation = a new `Attestation` with `status: 'revoked'` and `revokesAttestationId` pointing at the grant. Both survive.
- **Moderation** of a grade = a new `Grade` with `moderatedFromGradeId`. The provisional grade stays readable with its author's name.
- `check-append-only` also scans services and controllers for forbidden mutators on these models, so the discipline can't be bypassed by a convenience method.

**Contrast — `Score` (gradebook) is deliberately mutable.** A gradebook tally is not a judgement of record; a correction should just update it. But an *override* stamps who and when and writes to `AuditLog`. Accountability without immutability, each applied where it fits.

---

# Part II — The data model

36 models. Grouped by the sprint that introduced them. All tenant-scoped unless marked **platform-scoped**.

## Foundation (Sprint 0)
- **Tenant** *(platform)* — slug, domains, branding, plan, features, locales, currency.
- **User** *(platform)* — a person. Email, password hash, MFA. No roles here.
- **Membership** — a person's roles within one tenant. `{owner, admin, registrar, instructor, assessor, elder, learner}`.
- **AuditLog** — append-only. Every consequential action.

## Curriculum (Sprint 1)
- **Program → Course → Module → Lesson → ContentBlock** — the teaching tree. Locale-mapped titles/bodies with diacritic-folded search shadow fields.
- **Course** carries `eligibilityPolicyId` (Sprint 3 hangs policy here), `copiedFromCourseId`, `version`.
- **ContentBlock** — types: `rich_text, audio, video, pdf, image, embed, archive_ref`. `visibility` defaults `private`. An `archive_ref` block above consent tier 1 physically cannot be marked `previewable` (a `pre('validate')` refusal).
- **Asset** — an uploaded file. `storageKey` (tenant-scoped R2 key), `derivatives[]` (the transcode ladder), `transcript`, `captions`, `status`.
- **Job** — the Mongo-backed queue row.

## Enrolment (Sprint 2)
- **Cohort** — a dated run of a programme/course, with an application window.
- **Application** — a request to join, awaiting a human decision. Unique per `(user, cohort)`.
- **Enrollment** — an active place. Carries `paymentState` (read by the engine in Sprint 6, *not* enforced here).
- **LessonProgress**, **Group**, **Session** (link-out only — no conferencing), **Attendance** (idempotent), **Notification** (a record of every send).

## Eligibility — the keystone (Sprint 3)
- **AttestationType** — tenant-defined standing. `requiresIssuerRole`, `isSensitive`, `defaultValidityDays`.
- **Attestation** — append-only. Issue and revoke are both writes.
- **EligibilityPolicy** — `combinator: all|any`, `rules[]` (type + params), `denialMessage` (locale-mapped, the institution's own words).
- **ContentPolicy** — `downloadable`, `offlineCacheable` (honoured only if downloadable), `watermark`, `streamOnly`, `logAccess`. A `pre('validate')` hook reconciles these (stream-only forces download off).
- **AccessLog** — append-only. Every evaluation, granted or withheld.

## Learner PWA (Sprint 4)
- **PushSubscription** — one row per device.

## Assessment (Sprint 5a)
- **Rubric** — criteria × levels, each level with points. `maxScore` virtual.
- **Assessment** — `type: oral|written|practical|quiz`, `requiresModeration`, `moderatorRole`.
- **Submission** — a learner attempt; `assetIds` reuse the Sprint 1 resumable upload.
- **AssessorAssignment** — who marks, in what role (`primary|second|moderator`).
- **Grade** — **append-only**. `totalPoints`, `criterionScores[]`, `feedback` (locale), `feedbackAssetId` (spoken feedback, first-class), `isFinal`, `moderatedFromGradeId`.

## Gradebook & quiz (Sprint 5b)
- **GradeScheme** — weighted categories (with drop-lowest), bands, pass mark.
- **LineItem** — *the* gradebook abstraction. `source: assessment|quiz|manual|lti`, `maxPoints`, `ltiResourceId`. Built LTI-native so Sprint 9 is a feature, not a migration.
- **Score** — mutable; an override is attributed and audited.
- **Quiz** / **QuizAttempt** — question bank (`mcq, multi, matching, cloze, numeric, short, essay`), pools, shuffle, timing, auto-marking with partial credit.

---

# Part III — Module map

```
src/
  config/       env (fail-fast), features (registry), plans
  lib/          context (AsyncLocalStorage), errors, logger, money, roles,
                storage (R2), queue (Mongo-backed jobs)
  plugins/      tenant-guard, append-only, locale-map
  models/       36 schemas — Mongoose only, no logic
  middleware/   tenant-resolver, auth (loadSession/requireUser/requireMember/
                requireRole), csrf, error-handler
  services/     ALL business logic. Notable:
    eligibility/  registry.js, evaluator.js (WRITE ONCE), rules/index.js
    notification/ index.js + channels/{email,sms,whatsapp,base}
    …             auth, tenant, membership, curriculum, course-copy, search,
                  media, enrolment, attestation, eligibility, archive, learner,
                  push, assessment, quiz, gradebook
  controllers/
    web/          EJS. Thin.
    api/          JSON. Thin. Parity enforced.
  routes/index.js 97 routes
  views/          19 EJS templates
  workers/        transcode.js, index.js (separate process)
public/
  sw.js           service worker — BUILD version MUST bump every deploy
  app/            learner PWA (index.html, app.js, app.css, pack.js, push.js)
  js/upload.js    resumable chunked uploader
scripts/
  checkers/       9 checkers + run-all
  sync-indexes.js
seed/
  synthetic.js        two fake tenants (guarded against prod)
  provision-oiss.js   provision an OISS-shaped tenant (arg: slug, default test-oiss)
  oiss-config.js      the six OISS governance decisions as rows
tests/              18 files, 121 tests
```

## The eligibility engine (the part to understand deeply)

`services/eligibility/`:
- **`registry.js`** — rule types register `{ slug, evaluate(params, ctx) }`.
- **`evaluator.js`** — pure: `evaluate(policy, ctx) → { allowed, failedRules, message }`. Written once. **Never edit it to add a rule type.** It asks the registry; it knows no rule by name. Unknown or erroring rules fail closed. A test reads this file and asserts it contains no rule-type string literal.
- **`rules/index.js`** — the rule files. Registered: `enrolled`, `attestation`, `membership_role`, `course_completed`, `manual_approval`, `assessment_score`. **Not yet registered:** `payment_state` (Sprint 6). Requiring the evaluator loads all rules.

The flow: `eligibility.service.canAccessLesson()` resolves the policy (lesson override → course → none), evaluates, and **writes the verdict to `AccessLog`** — granted or withheld. `learner.service.lessonFor()` calls it and returns held teachings as the institution's words, never as an error.

---

# Part IV — The checkers

Run by `npm run check` and the pre-commit hook. A red checker blocks merge. These exist because each has bitten the author before.

| Checker | Fails when |
|---|---|
| `check-tenant-guard` | A model lacks the guard plugin and isn't allowlisted as platform-scoped. |
| `check-tenant-indexes` | An index on a tenant-scoped model doesn't lead with `tenantId`. |
| `check-append-only` | Code calls a mutator on `Attestation`, `Grade`, `AccessLog`, or `AuditLog`. |
| `check-no-tenant-terms` | A banned domain term appears in `src/` (comments are stripped before scanning — comments may cite examples, code may not). |
| `check-money` | A `*price/fee/amount/cost/total*` field is typed `Number` (exempts `*Points`). |
| `check-locale-fields` | A learner-visible content field is typed `String` instead of a locale map. |
| `check-api-parity` | A service method is reachable from web controllers but not api, or vice versa, without `@parity-exempt`. |
| `check-route-handlers` | A route references a handler that doesn't exist. |
| `check-ejs-syntax` | An EJS template fails to parse. |

---

# Part V — Testing

121 tests across 18 files. **The tenant-isolation suite (`tests/isolation/`, 15 tests) is the one that matters most** — if it goes red, a tenant can read another's data, and nothing else matters until it's green.

DB-backed suites use `mongodb-memory-server`. Logic that needs no DB (the evaluator, quiz marking, diacritic folding, the context layer, the SW versioning mechanism, ADR-008) is proven in `tests/unit/` and runs anywhere.

Notable golden-path suites:
- `tests/eligibility/golden-path.test.js` — withheld → attested → visible → revoked → withheld, every step logged.
- `tests/assessment/assessment.test.js` — moderation writes a new grade; both survive.
- `tests/gradebook/gradebook.test.js` — weighted compute matches hand arithmetic; drop-lowest; override auditing.
- `tests/unit/adr008.test.js` — the evaluator names no rule type; `assessment_score` is registered, `payment_state` is not.

**Delivery discipline:** the author builds in a sandbox, runs `npm run check`, proves no-DB logic, and packages a sprint as a zip + a manifest of files to add/replace. DB tests run on the author's machine. When only a few files change, they're delivered individually rather than zipped. `package.json` is delivered as deltas, never a full-file replace (a full replace once silently reverted a hand-installed dependency).

---

# Part VI — Architecture Decision Records

| ADR | Decision | Why |
|---|---|---|
| 001 | Standalone repo | Not a plugin of an existing LMS; the invariants require control of the core. |
| 002 | Shared DB, shared schema, `tenantId` everywhere | Simplest model that a driver-level guard can make safe. |
| 004 | Archive material referenced, never copied | Copying breaks consent-revocation propagation; it would make the platform a consent-laundering machine. |
| 005 | Mongo-backed job queue, not BullMQ | Redis is another service to run and pay for; at this volume Mongo suffices. Interface is narrow, so swapping later is a driver change. |
| 008 | Rule registry; evaluator written once | Adding a rule (e.g. `assessment_score` in 5a) must not touch the code that runs rules. Proven mechanically by a test. |
| 010 | Peer review permanently prohibited | It exposes one learner's submission to another; above consent tier 2 that is a consent violation, and a peer's entitlement can't be verified. |
| 011 | Publication is an act, not a flag | Fail closed; no code path from content to a public surface without a named human + the policy engine. |
| 013 | WhatsApp deferred to a stub | Meta approval is the only external gatekeeper that can idle a solo builder for a whole sprint. Replaced by SMS + Web Push. |
| 014 | Web Push as the third channel | Free, no gatekeeper, reaches installed learners. iOS requires the PWA be added to the home screen. |

---

# Part VII — Build status

| Sprint | Scope | Status |
|---|---|---|
| 0 | Foundation, tenancy, auth, the guard, the checkers | ✅ |
| 1 | Curriculum tree, locale maps + diacritic search, course copy, R2 media pipeline, transcode worker | ✅ |
| 2 | Cohorts, applications, enrolment, progress, attendance, notifications (email/SMS/WhatsApp-stub) | ✅ |
| 3 | **Eligibility engine** — attestations, policies, content policy, access log, archive consent revocation | ✅ |
| 4 | Learner PWA — offline packs, watermarked HLS, Web Push | ✅ |
| 5a | Assessment — recording, rubrics, multi-assessor moderation, spoken feedback, `assessment_score` rule | ✅ |
| 5b | Gradebook (line-item-native), weighted compute, quiz engine | ✅ |
| — | **Sellable MVP complete** | ✅ |
| 6 | Commerce — Paystack behind `PaymentProvider`, instalments, `payment_state` rule | ▢ |
| 7 | Credentials — certificates, QR verification, tenant data export | ▢ |
| 8 | Institutional readiness — SSO (SAML/OIDC), SIS import, WCAG audit | ▢ |
| 9 | LTI 1.3 Advantage — reads the line items already built | ▢ |
| 10 | Institution directory — public pages, no course content | ▢ |
| 11 | Catalog / marketplace — only when supply justifies it | ▢ |

## Known limitations at MVP

- **Learner PWA is a minimal shell** — lessons opened via `?lesson=<id>`, no client-side course browser yet. The load-bearing parts (engine-gated assembly, watermarking, offline refusal, push) are complete and tested; navigation is polish.
- **In-browser recording UI is thin** — the `Submission` model and resumable upload path are real and tested; the MediaRecorder capture surface is a stub.
- **Notification templates are built-in**, not yet tenant-authored.
- **The archive client transport is stubbed** — the consent-revocation *behaviour* is real and tested; the HTTP calls to a live archive are placeholders awaiting an endpoint.

## OISS — open governance items (not code)

The engine is built and configured against `test-oiss` via `seed/oiss-config.js`. Four items remain, and all are OISS's to decide, not the engineer's:
1. **Denial wording** — every policy carries `__OISS_TO_WRITE__` placeholders. Replace with OISS's own words, Yorùbá and English. Highest-value, lowest-effort.
2. **Gender / lineage gating** — deferred, awaiting elders. If adopted, it's one more `AttestationType` + a rule param; no rebuild.
3. **Traditional-medicine content** — the `tmr-practitioner-only` policy exists (strictest shape). **No dosage content may be authored until legal sign-off is recorded.** Hard gate.
4. **Posthumous consent** — "continues unless family revokes"; no code, but the deposit consent form must state it and a family must have a reachable revocation path (archive-side, Sprint 11).

---

# Part VIII — Things that will bite you

1. **Stale Atlas indexes silently don't enforce.** Mongoose won't retrofit a unique constraint onto a collection that predates the declaration. Run `npm run indexes` after any index change, and in the deploy step. A "duplicate" that should've been rejected but wasn't is this.
2. **Atlas rejects a non-allowlisted IP by failing the TLS handshake** (alert 80), not by timing out. It looks like a certificate error and is a firewall problem. Nigerian ISPs hand out dynamic IPs — re-add periodically.
3. **The service worker BUILD version must bump every deploy** (`public/sw.js`). A stale SW serves old code and looks like a failed deploy. The versioning *mechanism* is tested; remembering to bump is on you.
4. **A Mongoose Query escapes the tenant scope at boundaries.** In tests, seeds, and workers, `.exec()` inside the context callback. The context layer throws an actionable error if you forget.
5. **R2 bucket CORS must expose `ETag`** or chunked uploads fail at part one with an opaque error.
6. **Never wholesale-replace `package.json`** — deliver deltas. A full replace once reverted a hand-installed dependency.
7. **Abuja↔Atlas latency is ~200ms/round-trip; four round trips per request ≈ 800ms.** Develop against a local `mongod` if it drags; co-locate app and cluster region in production. Do **not** add a tenant cache — it trades a latency problem you can fix (distance) for a correctness problem you can't (staleness).
8. **Someone will propose peer review as a cost saving.** It's a permanent non-goal (ADR-010). Say no, point here.
9. **Someone will propose caching archive audio "for speed."** It converts the platform into a consent-laundering machine (ADR-004). Permanent non-goal.
10. **Under demo pressure, someone will want real elder recordings in a pre-engine database.** This is invariant 10, it is the one that will actually be attempted, and it is the one that matters most. Synthetic content only.

---

*If you are inheriting this codebase: the invariants in Part I are not style preferences. Several of them are the entire reason the product exists. Read them, then read `src/plugins/tenant-guard.js` and `src/services/eligibility/evaluator.js` — those two files are the spine.*
