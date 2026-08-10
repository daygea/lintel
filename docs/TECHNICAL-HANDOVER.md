# Lintel — Technical Handover

**A multi-tenant learning platform for institutions whose access to teaching is conditional on who the learner is, not merely whether they paid.**

> A lintel is the stone that bears the weight above a doorway. Every screen in this product is about a door: opened, held, and who holds the key.

---

**Document status:** living. Updated as the build progresses.
**Covers:** Sprints 0–10 and 12–15 complete and green (11 deliberately skipped), plus the design system, apex home page, the write-UI wiring audit (every admin section made writable), and the post-audit operational fixes (media-upload CORS, transcode-worker awareness, defensive block rendering).
**Last verified against the codebase:** post-wiring-audit + operational hardening — 12 checkers, the full MVP rule set (7 rules), a complete authoring UI across all eight admin sections, and a working browser→R2 media pipeline.
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
- **Revocation** of an attestation = a new `Attestation` with `status: 'revoked'` and `revokesAttestationId` pointing at the grant. Both survive. **The original grant is never mutated — it stays `active` forever.** "Is this standing currently in force?" is therefore *derived*, not stored: `attestation.service.currentFor(userId)` walks a person's attestations newest-first, takes the latest per `typeSlug`, and reports `inForce` only if that newest row is `active` (and unexpired). Two consequences that will trip you: (a) you cannot tell if a standing is revoked by reading the grant's own `status` — you must find whether a newer tombstone supersedes it; (b) re-revoking the *grant's* id succeeds (it's still active and would just write a second tombstone) — the guard "not active" only refuses when you revoke the *tombstone's* id. Query the derived view, never a single row's status. The eligibility engine's `attestation` rule uses this derived view, so revocation propagates to access decisions for free.
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
  - **The full pipeline, end to end:** the admin upload page (`/media/upload`) calls `beginUpload` (server returns presigned R2 part URLs) → the *browser* PUTs the bytes straight to R2 → `completeUpload` finalises. For `audio`/`video`, completion sets status `processing` and enqueues `media.transcode`; the **separate** worker process (`npm run worker`) runs ffmpeg and writes `derivatives[]`. For `pdf`/`image`, completion sets status `ready` immediately — those have no renditions by design, and the asset page shows a "needs no transcoding" state, not an empty transcode table. Two operational prerequisites that are easy to miss and each have a biter (Part VIII, #17–18): the R2 bucket needs a CORS policy exposing `ETag` (`scripts/set-r2-cors.js`), and the worker must be running or videos stall at `processing`.
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

## Commerce (Sprint 6)
- **FeeSchedule** — items (Money) + instalment plans. `platformFee` present, zero. Free (empty items) is first-class and needs no provider.
- **Invoice** — `amountDue`/`amountPaid` (Money), `state` derived. One per enrolment.
- **Payment** — **append-only**. `providerRef` unique-sparse per tenant = idempotency. `method` includes `bank_transfer` (registrar-confirmed) as first-class.
- Provider interface + Paystack adapter in `services/commerce/providers/`. Webhook is HMAC-SHA512 verified, public, raw-body.

## Credentials (Sprint 7)
- **CredentialTemplate** — title, `serialFormat` tokens (`{YEAR}{SEQ}{SLUG}`), the completion it attests.
- **Credential** — `serial` (printed, unique per tenant) + `verificationCode` (public 128-bit token in the QR, unique per tenant, NOT derivable from the serial). `holderName`/`awardTitle` snapshot at issue. Revocation flips a field the public verifier reads; nothing deleted. **Must never carry marks, standings, or transcript.**

## Institutional integration (Sprint 8)
- **SsoConnection** — a tenant's IdP config. `protocol: saml|oidc`, `attributeMap` (which claim → email/name/role), `roleMap` (claim value → our role), `defaultRole`, `autoProvision`. **Secrets are held as REFERENCES** (`idpCertRef`, `clientSecretRef`) — env keys or vault paths, never the secret itself (ADR-017).
- **ExternalIdentity** — links a `User` to a stable external `subject` (IdP nameID/sub, or SIS student number). Unique per `(tenant, source, subject)`. This is what stops duplicate accounts on re-login and re-import.
- **User** gains `ssoOnly` — an SSO/SIS account has no password, and `passwordHash` is required only when `ssoOnly` is false.

## LTI 1.3 Advantage (Sprint 9)
- **LtiTool** — a registered external tool. `clientId`/`issuer`/`deploymentId`, JWKS/launch/login endpoints, `scopes` (least privilege — a tool granted only NRPS cannot post grades), signing key held as a REFERENCE (ADR-017).
- **LtiLaunch** — one launch record. Single-use `nonce` (replay rejected) and `state` tie an async AGS/NRPS callback back to the right learner/course/line item.
- Lintel is the **platform**, not the tool. AGS scores land in the **existing `Score` collection** — LTI is a writer of rows the gradebook already computes over, not a parallel store. This is the 5b `LineItem`-native decision paying off: LTI was a feature, not a migration.

## Institution directory (Sprint 10)
- **DirectoryListing** — an institution's public presence, as a SEPARATE OBJECT, not a flag on Tenant. `publishedAt` is the single source of visibility; publication is an act by a named human (ADR-011). `handle` is a deliberate GLOBAL namespace (marked `// @global-unique`, the one index that legitimately doesn't lead with tenantId). Carries the institution's chosen name, tagline, contact, and featured course IDs — **titles only** are ever shown.
- `directory.service.publicView()` is the entire public surface: runs as platform, returns null for anything unpublished (fail closed, indistinguishable from absent), and can only emit the safe fields built into its projection. A featured course is shown only if it is ALSO `visibility: directory|catalog` — two independent gates. Course content, learners, prices, and anything the engine guards can never reach it.

## Self-service onboarding (Sprint 12)
- **TenantApplication** (platform-scoped) — an institution's request to open a space. When `AUTO_PROVISION_TENANTS=true`, an application is created and approved in one step; when false (default), it waits for a superadmin to approve, and approval is what provisions the tenant and emails the owner. Kept after approval as the record of who asked for an institution.
- **OnboardingToken** (platform-scoped, TTL-indexed) — a single-use, expiring (48h) token for setting a password. We store only its **hash**; the raw 256-bit value exists exactly once, in the emailed link. This is the secure half of "credentials by email": a set-password link, never a password in cleartext. A temp-password fallback exists (flagged `User.mustChangePassword`) for when a link can't be used — it too must be changed on first login.
- **User** gains `mustChangePassword` and `platformRole` (see Sprint 13).
- **Membership** gains a `pending` status — a self-registered learner awaiting a registrar's admission. `requireMember` only loads `active` memberships, so a pending member is locked out of everything until admitted: fail closed.
- Two distinct flows, deliberately different: **Flow A** (institution signs up → creates a tenant + owner) and **Flow B** (`auth.selfRegister` — a person registers into an existing institution → creates a `learner`/`pending` membership ONLY, **role-locked**; a self-registrant can never choose a role, which would otherwise blow a hole through the eligibility engine).

## Platform console (Sprint 13)
- **PlatformAuditLog** (platform-scoped, append-only) — operator actions that happen ABOVE any tenant (suspend, plan change, application approval, superadmin grant/revoke). The tenant-scoped `AuditLog` can't hold these (they belong to no tenant), so they live here.
- **User.platformRole** (`'superadmin'`) — a Lintel operator, distinct from any tenant Membership. It gates the console and grants NO access to any tenant's contents — only system-level and tenant-metadata actions. The console can suspend an institution; it cannot browse that institution's lessons or records.
- `platform.service` is every console operation, each writing a `PlatformAuditLog` entry and each taking the acting operator's id for attribution. `runAsPlatform(reason, fn, actingUserId)` now carries the operator so `currentUserId()` resolves inside the block (for audit and the self-revoke guard). Safety rails: cannot revoke the last superadmin; cannot revoke yourself.
- The gate (`middleware/platform-auth.js`): a real authenticated session whose user carries `platformRole: 'superadmin'` — no URL secret. A non-operator gets a **404** (the console never announces its own existence). The console has its own apex login (`/console/login`), because a superadmin has no tenant subdomain to log in through.

## Abuse response + break-glass (Sprint 14)
- **AbuseReport** (platform-scoped) — a report queue. Anyone can file (learner, institution, system); an operator works it through metadata and the audit trail. It names a subject (tenant/user/resource) but never copies content.
- **BreakglassGrant** (platform-scoped) — the ONLY path from platform staff to tenant content. Time-boxed, justification-required, and it notifies the institution's owner on open (`breakglass_notice` email). There is deliberately **no silent, standing read capability** anywhere. `openBreakglass` writes the grant + platform audit + owner notice; expiry or revocation ends it.
- **User** gains `sessionEpoch` — bumped by `forceLogout` (and suspend, and password reset) to invalidate every existing session. Both session loaders compare the session's stored epoch to the user's; a stale session is dropped. Logins stamp the current epoch.
- Operator powers (`platform.service`, all audited): suspend/reactivate a user, force-logout, send a password-reset LINK (never a plaintext password — same token machinery as onboarding), file/list/resolve reports, open/revoke break-glass. The console surfaces these on the report-detail page (account actions for a user subject, break-glass for a tenant subject) and a break-glass ledger.

## Directory self-management + lifecycle (Sprint 15)
- No new models. The institution publishes and edits its **own** public directory listing (`directory-admin.controller` → `/directory-listing`): public name, tagline, about, contact, featured course titles, publish/unpublish. This is the tenant's public voice — the console never edits it (ADR-023).
- The console gains tenant **metadata** edit (name, plan, slug, locales) and **lifecycle** (suspend, reactivate, close) — `editTenantMetadata`, `closeTenant` — but never tenant content.
- Root cause of an empty public directory, fixed here: the directory only shows *published* listings (ADR-011), and there was previously no publish UI. Nothing appears until an institution publishes — by design.

## Authoring wiring — no new models (ADR-024)
The write-UI audit added **no schemas** — every model already existed and every service already had the write methods. What was missing was purely the web layer (controllers, routes, forms) reaching them. What became authorable, by section: eligibility policies + lesson-policy attachment; media upload (browser→R2 presigned multipart) + media content blocks in lessons; cohorts (create/open/close, sessions, attendance); assessments (rubrics, assessments, rubric-driven grading — gated on assessor assignment); gradebook (schemes with categories *and* bands, line items, hand-entered scores); fee schedules (money major→minor at the controller boundary); credential templates + issue/revoke; attestation standings + issue/revoke (gated on the type's `requiresIssuerRole`). Two bugs that predated the audit were fixed in passing: lesson content blocks used invalid type strings (`text` instead of `rich_text`), and the course tree was read at the wrong nesting (`m.title` vs `m.module.title`).

---

# Part III — Module map

```
src/
  config/       env (fail-fast), features (registry), plans
  lib/          context (AsyncLocalStorage), errors, logger, money, roles,
                storage (R2), queue (Mongo-backed jobs)
  plugins/      tenant-guard, append-only, locale-map
  models/       51 schemas — Mongoose only, no logic
  middleware/   tenant-resolver, auth (loadSession/requireUser/requireMember/
                requireRole), csrf, error-handler
  services/     ALL business logic. Notable:
    eligibility/  registry.js, evaluator.js (WRITE ONCE), rules/index.js
    notification/ index.js + channels/{email,sms,whatsapp,base}
    …             auth, tenant, membership, curriculum, course-copy, search,
                  media, enrolment, attestation, eligibility, archive, learner,
                  push, assessment, quiz, gradebook, credential, commerce,
                  identity, sis-import, lti, directory, onboarding, signup,
                  platform
  controllers/
    web/          EJS. Thin. Every admin section has full authoring (create/
                  edit/issue/revoke) wired to its service — see ADR-024.
    api/          JSON. Thin. Parity enforced.
  routes/index.js  tenant routes + /join
  routes/public.js public/apex routes — home, signup, onboard, verify, directory
  routes/console.js platform console — apex, superadmin-gated
  views/          51 EJS templates — tenant admin, public, signup, console
  workers/        transcode.js, index.js (separate process)
public/
  sw.js           service worker — BUILD version MUST bump every deploy
  app/            learner PWA (index.html, app.js, app.css, pack.js, push.js)
  js/upload.js    resumable chunked uploader
scripts/
  checkers/       12 checkers + run-all
  sync-indexes.js
  set-r2-cors.js      one-time: set R2 bucket CORS for browser uploads (needs admin token)
  find-bad-blocks.js  maintenance sweep: content blocks with missing/invalid type (--delete)
seed/
  synthetic.js        two fake tenants (guarded against prod)
  provision-oiss.js   provision an OISS-shaped tenant (arg: slug, default test-oiss)
  oiss-config.js      the six OISS governance decisions as rows
  grant-superadmin.js grant platform superadmin by email (bootstrapping)
tests/              35 files
```

## The eligibility engine (the part to understand deeply)

`services/eligibility/`:
- **`registry.js`** — rule types register `{ slug, evaluate(params, ctx) }`.
- **`evaluator.js`** — pure: `evaluate(policy, ctx) → { allowed, failedRules, message }`. Written once. **Never edit it to add a rule type.** It asks the registry; it knows no rule by name. Unknown or erroring rules fail closed. A test reads this file and asserts it contains no rule-type string literal.
- **`rules/index.js`** — the rule files. Registered (the complete MVP set, 7 rules): `enrolled`, `attestation`, `membership_role`, `course_completed`, `manual_approval`, `assessment_score`, `payment_state`. Requiring the evaluator loads all rules. Three of these (`assessment_score` in 5a, `payment_state` in 6) were added in later sprints without touching the evaluator — ADR-008, proven by test.

The flow: `eligibility.service.canAccessLesson()` resolves the policy (lesson override → course → none), evaluates, and **writes the verdict to `AccessLog`** — granted or withheld. `learner.service.lessonFor()` calls it and returns held teachings as the institution's words, never as an error.

---

# Part III½ — The interface (design system, home page, console)

The admin, public, and console surfaces share one design language, grounded in the subject: a *lintel* is the stone that bears weight above a door, and the product is about thresholds — teaching **held** until standing is attested, then **opened**.

- **`public/css/lintel.css`** is the whole system. Cool stone paper (`--paper #F5F4F1`), doorway-shadow ink (`--ink #161A2E`), oxidised **brass** (`--brass`) for the *open/attested* state, slate-violet (`--held`) for *held* (never red — a held teaching is not an error). Inscription serif headings, grotesque body, **monospace for all provenance** (serials, emails, slugs, log timestamps). The signature is the **threshold rule**: a brass left-border on open content, slate on held — the door-state legible at a glance across every screen.
- **Layout partials.** Tenant admin: `layouts/head.ejs` (data-driven left-rail shell, grouped Teaching/People/Access/Assessment/Records) + `foot.ejs` + `page-head.ejs`. Public/auth: `layouts/public-head.ejs` + `public-foot.ejs` (centered, no shell). Console: `console/head.ejs` + `foot.ejs` (its own dark-brass identity so an operator never mistakes it for an institution's admin).
- **EJS include-scope rule (important, bit twice).** A `<% var x %>` in a view does **not** reach an `include()`'d partial. Pass locals explicitly: `include("head", { nav: nav, pageTitle: pageTitle })`. Symptoms of forgetting: a partial renders a variable as blank (e.g. the active-nav highlight silently never applies). See Part VIII.
- **The apex home page** (`views/home.ejs`) is B2B — the customer is an institution, not a learner. Its hero is the product thesis ("Some teaching is held until you have the standing to be let in"), signature is a two-door figure (one held, one opened on a brass glow). The tenant resolver lets the apex host pass through WITHOUT a tenant so `/` renders it; on a tenant subdomain `/` still falls through to the dashboard.

---

# Part IV — The checkers

Run by `npm run check` and the pre-commit hook. A red checker blocks merge. These exist because each has bitten the author before.

| Checker | Fails when |
|---|---|
| `check-tenant-guard` | A model lacks the guard plugin and isn't allowlisted as platform-scoped. |
| `check-tenant-indexes` | An index on a tenant-scoped model doesn't lead with `tenantId`. A deliberate global namespace (e.g. a public directory handle) may opt out with `// @global-unique`. |
| `check-append-only` | Code calls a mutator on `Attestation`, `Grade`, `AccessLog`, or `AuditLog`. |
| `check-no-tenant-terms` | A banned domain term appears in `src/` (comments are stripped before scanning — comments may cite examples, code may not). |
| `check-money` | A `*price/fee/amount/cost/total*` field is typed `Number` (exempts `*Points`). |
| `check-locale-fields` | A learner-visible content field is typed `String` instead of a locale map. An admin-only config string may opt out with a `// @admin-string` marker (explicit and greppable). |
| `check-api-parity` | A service method is reachable from web controllers but not api, or vice versa, without `@parity-exempt`. |
| `check-route-handlers` | A route references a handler that doesn't exist. |
| `check-ejs-syntax` | An EJS template fails to parse. |
| `check-a11y` | A view has an `<img>` without `alt`, an `<html>` without `lang`, or an `<input>` without a label/`aria-label`. Accessibility as an enforced invariant, not a one-time audit. |
| `check-csrf-forms` | A `<form method="post">` in any view lacks a `_csrf` hidden field. Added after three public forms shipped without a token and produced masked 500s on submit; it immediately found two more missing tokens in old console views. Turns a runtime "form has expired" failure into a build-time one. |
| `check-view-fragility` | A view calls a string/array method (`replace`, `toUpperCase`, `split`, `.length`, …) on a *dotted property* (`x.y.method(`) with no `?`/`||`/`&&` guard — the exact shape that 500'd the lesson page when a content block had no `type`. Deliberately conservative (only the dangerous shape, only unguarded), so it stays low-noise. It caught a case the author had missed by hand the moment it was added. When it fires, guard the access (`x.y ? x.y.method(…) : …`); the guard is cheap, the 500 is not. |

The `check-tenant-guard` platform-scoped allowlist (models that legitimately have no tenant) now reads: `tenant`, `user`, `index`, `onboarding-token`, `tenant-application`, `platform-audit-log`, `abuse-report`, `breakglass-grant`. Each is justified inline in the checker.

---

# Part V — Testing

The suite spans 35 files. **The tenant-isolation suite (`tests/isolation/`) is the one that matters most** — if it goes red, a tenant can read another's data, and nothing else matters until it's green.

The wiring audit (ADR-024) added an `authoring.test.js` per section — `tests/{eligibility,enrolment,assessment,gradebook,commerce,credential,attestation}/…authoring.test.js` — each proving the create/issue/revoke path its UI drives, and the domain rules that guard it (an attestation needs the issuer's role; a grade needs an assessor assignment; a cohort needs a course parent). These are where the schema-mismatch bugs of bite #15 were caught.

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
| 015 | A credential discloses the award only | Never marks, standing, or coursework. The public verifier's return object is the entire public surface; a test pins its keys. |
| 016 | Tenant export is a first-class right | "Can we leave with our material?" is answered yes before it is asked. JSON of the tenant's own collections; archive material as references, never bytes (ADR-004). |
| 017 | SSO **and LTI** signature verification uses a vetted library + security review | SAML XML-DSig, OIDC/LTI id_token validation, and LTI tool-token checks are where these systems get breached. The adapters (`services/sso/`, `services/lti/verify.js`) define the interface and a DEV-ONLY trust mode so the flow and tests are real; `verify()`/`signLaunch()` REFUSE to run in production until the reviewed implementation is wired. Scope enforcement (our own authz) always runs, even in dev. Secrets/keys live in a manager, referenced by key. |
| 018 | Identity linking is protocol-agnostic and centralised | `identity.service.resolveFromAssertion()` is the one place a verified assertion becomes a User+Membership. It assumes authenticity already established by the adapter; it never mints duplicates (keyed on ExternalIdentity); it respects tenant isolation. SAML and OIDC feed the identical function. |
| 019 | Credentials by email are a set-password LINK, never a password | A plaintext password in an inbox and mail logs is a standing credential leak. We email a single-use, expiring, hash-stored token; the raw value exists once, in the link. A temp-password fallback (for when a link can't be used — spam, lag, phone support) is random, `mustChangePassword`-flagged, and can't persist past first login. |
| 020 | Self-registration is role-locked to `learner`/`pending` | A person registering into an institution from its page can never choose a role. Allowing it would let a stranger self-grant `elder`/`admin` and walk through the eligibility engine. Admission is a registrar's act; until then a pending member is locked out (fail closed). |
| 021 | Superadmin is a `platformRole` on User, gated by a real session — never a URL secret | A secret in a query string leaks into history, logs, and referrers. The console requires an authenticated session whose user carries `platformRole: 'superadmin'`, MFA-eligible and auditable. It manages the SYSTEM and tenant METADATA only — never the contents of a tenant. A non-operator gets a 404, not a 403: the console does not announce itself. |
| 022 | Platform staff have NO standing read access to tenant content; abuse oversight is metadata + break-glass | Permanent full read would void the product's core promise — that teaching is held on standing, not held-from-everyone-except-the-platform — and make the operator the weakest point in the security model (one subpoena/breach exposes every institution). Almost all real oversight (suspend, force-logout, reset, investigate) needs only metadata + audit. The rare case needing content (credible illegal-material report) uses a **break-glass** grant: explicit, justified, time-boxed, logged, and it notifies the institution. The honest answer to "can Lintel see our material?" is *no — only through a door that rings a bell you can hear.* |
| 023 | The institution controls its own public voice; the console controls system + lifecycle, not tenant content | An institution publishes and edits its OWN directory listing (its public name, tagline, featured course titles) from the tenant admin. The superadmin console can edit tenant METADATA (name, plan, slug, locales) and manage LIFECYCLE (suspend, reactivate, close) — but never a tenant's teaching, grades, or public listing. Editing a tenant's data on its behalf is the same overreach as reading it; the console stays on the system side of that line. |
| 024 | Every service capability must be reachable from the UI, or its absence must be deliberate | A systematic audit found nine admin sections that rendered data but had **zero write routes** — the services could create/grade/issue/enrol, but no page could. Each was wired the same way (web controller → route → form), respecting `check-api-parity` and `check-csrf-forms`, each with a test. The rule going forward: a service method with no UI path is a bug unless a limitation note in Part VII says why. This is *why* the parity checker matters — it also stops the API and web from drifting as new capability lands on one side only. |
| 025 | Session cookie is named per-app; CSRF errors are 403+exposed, not masked 500s | Two bugs compounded on `localhost`: an unnamed session cookie defaulted to `connect.sid` and **collided with another app on the same host**, and a CSRF failure threw a plain `Error` that defaulted to a 500 with no useful message. Fixed: the cookie is named `lintel.sid` (every app on a shared host must name its cookie), and CSRF errors carry `status: 403, expose: true` so the user sees "that form has expired," not a server error. The `check-csrf-forms` checker (ADR-linked to this) prevents the missing-token half of the failure class. |
| 026 | Defensive rendering of stored/legacy data is a build-time invariant, not a habit | A content block saved by an earlier form (with an invalid `type`) 500'd the whole lesson page via `b.type.replace(...)` on `undefined`. The fix was three-part and is the template for this class: (1) make the view defensive so one malformed row can't take down a page; (2) write a **sweep** for the rows the original bug already produced (`scripts/find-bad-blocks.js`); (3) add a **checker** (`check-view-fragility`) so the fragile shape can't ship again. A post-hoc sweep found four more instances of the same shape across console/gradebook/fees/signup views — all now guarded. Lesson: fixing a data-*producing* bug never fixes the data already written, and "I'll remember to guard it" is not a control — a checker is. |

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
| 6 | Commerce — Paystack behind `PaymentProvider`, instalments, `payment_state` rule | ✅ |
| 7 | Credentials — certificates, QR verification, tenant data export | ✅ |
| 8 | Institutional readiness — SSO (SAML/OIDC), SIS import, WCAG audit | ✅ |
| 9 | LTI 1.3 Advantage — reads the line items already built | ✅ |
| 10 | Institution directory — public pages, no course content | ✅ |
| 11 | Catalog / marketplace | ⏭ **skipped, deliberately** — supply-side infra for a market that doesn't exist yet; the cross-tenant primitives already exist, so nothing is lost by waiting. |
| — | **Design system + apex home page** — one visual language across admin/public/console; the marketing front door | ✅ |
| 12 | Self-service onboarding — institution signup (auto or reviewed), learner self-registration, secure set-password links | ✅ |
| 13 | Platform console — superadmin surface: institutions, plans, applications, operators, platform audit | ✅ |
| 14 | Abuse response — user suspend/force-logout/reset, report queue, and break-glass (the only, notified, time-boxed path to tenant content) | ✅ |
| 15 | Directory self-management (institution publishes its OWN listing — `/directory-listing`) + console tenant metadata-edit and close (lifecycle). Fixes an empty public directory: nothing appears until an institution publishes, by design (ADR-011). | ✅ |
| — | **Course authoring UI** — modules, lessons, and content blocks (text/media/embed) creatable from the course page; a lesson-detail page with an eligibility-policy selector. Closed the "created a course → no way to add anything" dead end. | ✅ |
| — | **Write-UI wiring audit** (ADR-024) — the nine read-only admin sections made writable: eligibility (create policy, attach to lesson), media (browser→R2 upload, media blocks in lessons), cohorts (create/open/close/sessions/attendance), assessments (rubrics, assessments, rubric-driven grading), gradebook (schemes, line items, scores), fees (schedules with correct money handling), credentials (templates, issue, revoke), attestations (standings, issue, revoke — role-gated). Each with a test; all checkers green. | ✅ |

## Known limitations at MVP

- **Learner PWA is a minimal shell** — lessons opened via `?lesson=<id>`, no client-side course browser yet. The load-bearing parts (engine-gated assembly, watermarking, offline refusal, push) are complete and tested; navigation is polish. (Note: the *admin* authoring UI is now complete — see the wiring audit — but the learner-facing browse surface is still thin.)
- **In-browser recording UI is thin** — the `Submission` model and resumable upload path are real and tested; the MediaRecorder capture surface is a stub. (The *admin* media-upload UI — browser→R2 presigned multipart with progress — is now complete and drives the same API.)
- **Assessment/quiz → gradebook roll-up is not automatic.** Gradebook line items carry a `source` (`assessment`/`quiz`/`manual`); the manual path (hand-entered scores) is fully wired, but a recorded assessment grade does not yet flow into its line item automatically. That feed is a deeper integration, not a UI gap — it belongs with the compute layer, not the authoring pass.
- **Fee *collection* UI is partial.** Fee-schedule *setup* is complete (create schedules, money in minor units, currencies). Recording a payment needs an invoice, and invoices are raised against an enrolment (`raiseInvoice`) — so the full invoice→payment collection flow (and the Paystack online path, which exists in the service) is a separate piece from fee setup. `recordPayment` is wired but expects an invoice id.
- **Notification templates are built-in**, not yet tenant-authored.
- **The archive client transport is stubbed** — the consent-revocation *behaviour* is real and tested; the HTTP calls to a live archive are placeholders awaiting an endpoint.
- **SSO is flow-complete but not production-cleared.** The connection model, identity linking, role mapping, and provisioning are real and tested; the SAML/OIDC signature verification runs in a DEV trust mode and REFUSES production until a vetted library is wired and reviewed (ADR-017). Do not enable SSO against a real IdP until that is done.
- **WCAG: the mechanical failures are checked (`check-a11y`); contrast and reading-order need a manual audit** with a screen reader before an accessibility claim is made to an institution. **Done so far:** both login pages (tenant + console) are audited — errors announce via `role="alert"`, forms are labelled, inputs are named, focus order is natural, password-manager autocomplete works, and all text meets AA contrast (the console's dark surfaces had two sub-4.5:1 failures on brass/slate small text — the `PLATFORM CONSOLE` tagline and a TOTP hint — now fixed to AA-passing values). **Still to audit:** the rest of the tenant admin and learner surfaces, and a real screen-reader pass. Note the checker cannot see colour — dark surfaces that use inline hex instead of the (AA-checked) tokens must be contrast-checked by hand; the console shell and both dark login pages were the ones carrying that risk.
- **LTI is flow-complete but not production-cleared** — same boundary as SSO. AGS scoring into `Score`, NRPS rosters, scope enforcement, launch assembly, and nonce recording are real and tested; the id_token/tool-token signature verification runs in DEV trust mode and refuses production until reviewed (ADR-017). Certify against the IMS reference tool before enabling a real tool.
- **The account-details email renders through the log/stub transport** (Sprint 2's channel interface). The template, tokens, and flow are real and tested; wiring a live email provider is a config swap, not new code. Until it's wired, onboarding emails are logged, not sent.
- **The platform console's operator model is a single `platformRole`.** There is one tier — superadmin. No finer-grained platform staff (support-only, read-only) yet; that's a future enum extension and per-action gating, not a rebuild. The bootstrap is a CLI script (`grant-superadmin.js`) with an env fallback (`SUPERADMIN_EMAIL` promotes on boot).
- **The console reads tenant METADATA only** — counts and status, never contents. This boundary is deliberate (an operator must not silently browse a sacred-studies institution's restricted material) and is enforced by what the service queries, not merely by convention. Any future "impersonate tenant" feature must be a separate, audited, consent-gated path — do not loosen the console for it.

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
5. **EJS `include()` does not inherit the parent's `var` scope.** A `<% var nav %>` set in a view is invisible inside an `include`'d partial — the variable reads as `undefined` and, worst case, renders as blank with no error (this silently broke the active-nav highlight on every admin page until caught). Always pass locals explicitly: `include("head", { nav: nav, pageTitle: pageTitle })`. The `check-ejs-syntax` checker catches parse errors, NOT this — it's a runtime scope issue.
6. **The test harness must build indexes itself, or unique constraints don't enforce in tests.** `tests/setup.js` runs `syncIndexes()` sequentially per file (each file gets its own in-memory mongod), with `hookTimeout: 60000` in `vitest.config.js` because that's the honest cost. Use `syncIndexes()`, NOT `createIndexes()` — the latter collides with the tenant-guard plugin's existing `tenantId` index. Never declare a second index on a key the plugin already indexes (a duplicate `tenantId` unique index was the collision that surfaced this). Same root cause as bite #1, one level up: an index that should reject a duplicate but doesn't.
7. **Cross-tenant writes from platform context throw by design.** A tenant-scoped model (`Membership`, `AuditLog`, `Notification`) written inside `runAsPlatform` throws `CrossTenantWriteError` — the guard won't infer a `tenantId` with no ambient tenant. If a platform-level action needs to write tenant data (e.g. approving an application emails the owner, which writes a tenant-scoped `Notification`), wrap that write in `runWithTenant(tenantId, ...)`. Nesting is safe: `runWithTenant` inside `runAsPlatform` cleanly switches context.
8. **R2 bucket CORS must expose `ETag`** or chunked uploads fail at part one with an opaque error. (The admin media-upload UI relies on this — the browser reads each part's `ETag` to complete the multipart upload.)
9. **Never wholesale-replace `package.json`** — deliver deltas. A full replace once reverted a hand-installed dependency.
10. **Abuja↔Atlas latency is ~200ms/round-trip; four round trips per request ≈ 800ms.** Develop against a local `mongod` if it drags; co-locate app and cluster region in production. Do **not** add a tenant cache — it trades a latency problem you can fix (distance) for a correctness problem you can't (staleness).
11. **Someone will propose peer review as a cost saving.** It's a permanent non-goal (ADR-010). Say no, point here.
12. **Someone will propose caching archive audio "for speed."** It converts the platform into a consent-laundering machine (ADR-004). Permanent non-goal.
13. **Under demo pressure, someone will want real elder recordings in a pre-engine database.** This is invariant 10, it is the one that will actually be attempted, and it is the one that matters most. Synthetic content only.
14. **The public credential verifier (`/verify/:code`) reveals only the award, name, date, and validity — never marks, standings, or transcript.** A test pins the exact permitted key set. If you extend the verifier, do not widen that object; a credential proves an award and nothing more. The route sits ABOVE the tenant resolver (a stranger has no subdomain) and runs as platform — that is deliberate, not a leak.
15. **A write form must send every field its model requires — and for models with sub-schemas, read the actual nested structure, not a flattened grep.** Several authoring forms shipped with a required field made optional (a parentless cohort, a session with no `startsAt`) or invented a field that lives in a sub-schema (a `FeeSchedule` has no top-level `amount` — its cost is carried entirely by `items[]`). Each threw a validation error at runtime. A flattened grep of a model tells you *which* fields are required; only the schema structure tells you *where* they live. Confusing a sub-schema's required field for a top-level one is both a validation failure and a correctness risk (Mongoose silently drops the unknown field). Check the structure before building the form.
16. **The sandbox cannot run the DB suite** (`mongodb-memory-server`'s binary download is blocked in the author's build environment), so schema-validation failures — in test fixtures *and* in write-forms — are invisible until the suite runs on a real machine. This is the single biggest source of "green here, red on your machine." Two mitigations, both real: (a) the `check-csrf-forms` and `check-a11y` checkers turn some runtime failures into build-time ones — extend that pattern when you can; (b) before packaging any form, cross-check its fields against the model's *actual* (nested-aware) required set, per bite #15. When a fixture uses a tenant, its `slug` must be ≥3 chars and subdomain-safe (single-char slugs fail the `Tenant` validator).
17. **Browser→R2 uploads need a CORS policy ON THE BUCKET, set out-of-band, that exposes `ETag`.** Media upload sends bytes straight from the browser to R2 with presigned URLs (`src/views/media/upload.ejs`). With no bucket CORS policy, the browser blocks the `PUT` before sending it — the page shows "Failed to fetch", stuck at "uploading". Fix: `node scripts/set-r2-cors.js` (needs an R2 token with **admin/bucket-configuration** permission, not the object-only token the app uses — or set the policy in the Cloudflare dashboard UI). The policy MUST list `ExposeHeaders: ["ETag"]`, because completion reads each part's ETag to finalise the multipart upload; without it the upload gets *further* (PUT succeeds) but fails at "Finalising". This is set-once per bucket. The app's own token stays least-privilege (object read/write) — only this one-time setup needs the powerful token.
18. **The transcode worker is a SEPARATE PROCESS.** `completeUpload` enqueues `media.transcode` only for `audio`/`video` (documents and images go straight to `ready` — they have no renditions, and the asset page says so). The job is consumed by `src/workers/index.js`, run via `npm run worker` (or `npm run dev:worker`), which needs `ffmpeg`/`ffprobe` on PATH. If a video sits at `processing` forever with no renditions, the worker isn't running — that is the first thing to check, not a code bug.
19. **Fixing the source of bad data does not fix data already written.** The first lesson-block form saved blocks with invalid `type` strings; the form was fixed, but blocks already in the DB kept the bad shape and later 500'd the lesson page (`b.type.replace` on `undefined`). Three-part fix, now the template for this class (ADR-026): (a) views that render user/legacy data must be defensive — one malformed row must never take down a whole page; (b) when you fix a data-producing bug, write a sweep for the rows it already produced (`scripts/find-bad-blocks.js`); (c) the fragile *shape* is now caught at build time by `check-view-fragility`, so it can't ship again. A sweep after the first fix found four more instances (console reports, gradebook, fees, learner signup) — all guarded.
20. **`.env.example` is the deployment contract — keep it in exact sync with what the code reads.** A drift here is a silent lockout: `SUPERADMIN_EMAIL` was read by the code (it auto-promotes the first operator on boot) but undocumented, so a fresh deployer could not create their first superadmin and wouldn't know why. Conversely, `PLATFORM_ADMIN_KEY` lingered in the example after its code path was retired, inviting someone to set a variable that does nothing. Both fixed. The check is a two-way `comm` between `grep -rhoE "process\.env\.[A-Z_]+"` and the example's keys — run it after any change that adds or removes an env read. Nothing is undocumented and nothing is stale as of this writing.

21. **A compound index must NEVER use `sparse: true` — use a partial index.** A *compound* sparse index only skips a document when it contains **none** of the indexed keys. On a tenant-scoped model `tenantId` is always present, so `sparse` never excludes the rows it looks like it should: absent optional keys index as `null`, and a `unique + sparse` compound index silently lets ref-less rows collide on `{tenant, null}`. This bit twice — `Cohort {tenantId, code}` (only one code-less cohort per tenant) and `Payment {tenantId, providerRef}` (a second manual payment swallowed as a "webhook replay"). Both are now `partialFilterExpression` indexes keyed on the optional field actually existing, and `check-sparse-compound` fails the build on any compound `sparse: true` (escape hatch: `// @sparse-ok`). **After pulling these changes, run `npm run indexes` on every existing database** — the schema change doesn't retrofit an index already built the old way (see bite #16's cousin).

22. **A template field can be a function of the data — evaluate it, don't pass it raw.** `notify()` resolves a function-valued template *text* by calling it with the data, but for a while did not do the same for the *subject* — it passed `pick(tmpl.subject)` straight through. The one template with a function subject (`account_created`, the new-institution owner email) therefore handed the email channel a *function*, which `JSON.stringify` silently drops — so Resend received a body with no subject and rejected the send with **422 Missing subject field**, and only the owner-onboarding email failed. Fixed to mirror the text path: `typeof subjectVal === 'function' ? subjectVal(data) : subjectVal`. Lesson: anywhere you render locale-map template fields, handle both string and function values.

23. **Guard-group consts in `routes/index.js` are declared mid-file — a route that uses one above its declaration is a boot-time TDZ.** `staff` / `author` / `assessor` / `issuer` / `asLearner` are `const` arrays scattered through the router. A route added *above* the relevant `const` throws `Cannot access 'assessor' before initialization` **at load** — and it passes every text checker and the entire test suite, because none of them execute `routes/index.js` top-to-bottom. It only surfaces on `npm run dev` / in production. The `boot` checker (Part X) now catches this whole class by actually building the app. When adding routes, keep them below the guard consts they use.

# Part IX — August 2026 build log (post-Sprint-15)

Everything above describes the engine as handed over. This section records the features wired on top of it since, closing the write-UI and onboarding gaps found in an August audit. All are on the same spine (tenant-guard + eligibility evaluator), pass the checkers (now **13** — `sparse-compound` added), and ship with tests.

**Learner journey, end to end.** Self-registration is wired through to access: a pending member lands on `/pending` (not a false 403), and login + the institution root dispatch by standing (pending → `/pending`, pure learner → `/app/`, staff → dashboard). Admission is a deliberate registrar act (Admit button; ADR-020). Registrar **direct-enrol** added. The **learner PWA** gained a real home (`/api/v1/me/learning`) listing courses → lessons by module with open/held + progress; a lesson viewer that renders **all four media types** (video/audio/image/pdf, each watermarked — previously image/pdf mis-rendered as audio); media *preparing* vs *unavailable* states; and `rich_text` rendered as HTML (`pickRaw`) rather than escaped. Note: browsing is a **no-log preview** (`eligibility.previewAccess`); only opening a lesson logs.

**Getting people in and reaching them.** **Email transport** is real — `notification/channels/email.js` POSTs to Resend when `RESEND_API_KEY`/`EMAIL_FROM` are set, else the dev log transport; it never sends live in tests (`env.isTest`). **Member invite** (`/members/invite`): a registrar's invite grants an active membership with a chosen role and emails a set-password link. **MFA setup** (`/security`): the login side already verified TOTP; this adds the enable/confirm/disable screens (`otplib`; shows the base32 key + `otpauth://` URI — no QR image yet).

**Assessment, complete.** Learners **take quizzes** in the PWA (all 7 question types; answers stripped server-side). Assessors **author quizzes** at `/courses/:id/quizzes` (7-type builder, open/close). Marked submissions **roll into the gradebook** automatically (`LineItem.source='quiz'`, best attempt as a percentage; only counts toward overall if the scheme has a `quizzes` category). **Essay marking** (`/courses/:id/quizzes/:id/marking`) lets an assessor score written answers, which finalises the attempt and rolls up auto + essay marks.

**Money.** **Invoice + payment collection UI** on top of the already-complete commerce service: raise an invoice against an enrolment from a fee schedule (from the cohort roster), an invoice page to record manual payments, kick off Paystack (`beginPayment` → checkout URL; dev-stub if unconfigured), or waive — each syncs `enrollment.paymentState`, which the `payment_state` eligibility rule reads.

**Trust & safety, and self-service.** **Branding editor** (`/settings/branding` — name, wordmark, logo, accent colour, languages). **Report a concern** (`/report`) lets any member file an abuse report to the platform team (the console already listed/resolved them). **Break-glass content viewer**: the console had the grant *ledger*; now an operator can **consume an active grant** to read a tenant's courses/lessons/content read-only — grant-gated (unexpired, unrevoked, owned by the asker), eligibility bypassed by design, and **every page recorded in the platform audit**.

**Operational reminders.** Run `npm run indexes` after the Cohort/Payment index changes. Bump `public/sw.js` `BUILD` on any PWA-shell change (it's a cache-first worker) — it's at `v0.9.0`. Audio/video still need the transcode worker (`npm run worker`, ffmpeg); images/PDFs are ready on upload. Still deferred by choice: per-quiz eligibility gating, learner-facing self-pay, a QR image for MFA, essay re-open.

# Part X — Production & post-launch (August 2026)

Lintel is **live at `lintel.africa`** on Render. This part records how it's deployed and what changed to get it there — read it before touching deploy config, email, or the worker.

## Deployment shape

- **Web service on Render** (native Node runtime, `npm start` → `src/server.js`). Sessions persist in Mongo via `connect-mongo`, so restarts and multiple instances are fine.
- **MongoDB Atlas** — Render has no managed Mongo. `MONGODB_URI` points at an Atlas cluster (co-locate its region with Render's to keep app↔DB latency low).
- **Cloudflare R2** for media, **Resend** for email, **Paystack** (optional) for online payment.
- **Subdomain multi-tenancy drives DNS.** Tenants resolve by host (`hostToSlug`), so DNS needs the **apex**, `www`, **and a wildcard `*.lintel.africa`** — all three added as Render custom domains (wildcard TLS may want a one-time `_acme-challenge` TXT) and as records at the registrar. The apex serves marketing (`isApex`); `<slug>.lintel.africa` serves a tenant; custom domains are supported per tenant.
- **`GET /healthz`** (host-agnostic, mounted above the resolver, no DB) is the health-check path.
- **`render.yaml`** (Blueprint) and **`DEPLOY.md`** capture the whole setup: Atlas, env vars, DNS, first-run indexes. The Blueprint's build command is `npm install && npm run check`, so **the checkers gate every deploy** — a boot break can't ship.

Env vars (web): `MONGODB_URI`, `SESSION_SECRET`, `ROOT_DOMAIN`, `SUPERADMIN_EMAIL`, the four `R2_*`, `RESEND_API_KEY` + `EMAIL_FROM` (email), `PAYSTACK_SECRET_KEY` (payments). **Never set `PORT`** — Render injects it. On a free instance there's **no Shell**, so run `npm run indexes` **locally against the Atlas URI** once (a fresh DB just builds the partial indexes).

## The `boot` checker — the 14th checker

Text-scanning checkers and the unit tests never require `app.js` top-to-bottom, so a route referencing a not-yet-declared guard (bite #23), a typo'd controller, or a broken import passes everything and then crashes on `npm run dev`. `check-boot` spawns a child process that calls `require('./src/app.js').createApp()` with placeholder env (swallowing the lazy Mongo connection) and fails the build on any load-time throw. This is why the build command runs the checkers: **a boot break fails the deploy instead of going live.**

## Email in production

- Real sending is via **Resend** (`RESEND_API_KEY` + `EMAIL_FROM` on a verified domain). Unset → dev-log transport (logs instead of sends). Tests never send (`env.isTest`).
- **Signup is approval-gated by default** (`AUTO_PROVISION_TENANTS` defaults false): an institution signup files a *pending application*; the owner's set-password email sends when you **approve it in the console**. Set `AUTO_PROVISION_TENANTS=true` for instant provisioning + immediate email.
- The `account_created` **function-subject** bug (bite #22) was the real cause of "signup didn't email" — a 422, not a config miss. Fixed.
- **Resend domain verification:** DKIM verified is enough to send. SPF wants a `send` **MX** record; on some registrars (Namecheap) you must switch Mail Settings → **Custom MX** before the MX type is offered. A verified DKIM alone will send in the meantime; `onboarding@resend.dev` works as a temporary `EMAIL_FROM` while DNS propagates.

## Transcode worker (audio/video)

Images and PDFs are ready on upload; **audio/video** stay "preparing" until a worker transcodes them, and that worker needs **ffmpeg** — which Render's Node runtime lacks. So it runs as a **Docker-based Background Worker** built from **`worker.Dockerfile`** (`node:22-bookworm-slim` + `apt install ffmpeg` + `npm run worker`; see **`WORKER.md`**). It's separate from the web service (no ports), shares `MONGODB_URI` and `R2_*`, polls the Mongo `Job` queue, and flips assets to `ready`. Background Workers are **paid** (Starter min; Standard for lecture-length video). The web service already enqueues `media.transcode` on upload — deploying the worker needs no web redeploy.

## Mobile

Both admin shells — the tenant admin (`layouts/head.ejs` + `public/css/lintel.css`) and the platform console (`console/head.ejs`) — are now **off-canvas drawers**: a hamburger in the sticky topbar slides the sidebar in over a tap-to-close scrim, page scroll locks while open, wide tables scroll horizontally, and the topbar declutters (`< 820px`). The learner **PWA is already mobile-first**, and the public/auth/marketing pages already carry the viewport meta and use centered cards — so only the two admin shells needed work.

---

*If you are inheriting this codebase: the invariants in Part I are not style preferences. Several of them are the entire reason the product exists. Read them, then read `src/plugins/tenant-guard.js` and `src/services/eligibility/evaluator.js` — those two files are the spine.*
