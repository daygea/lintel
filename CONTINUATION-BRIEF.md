# Lintel — Continuation Brief for a New Chat

*Attach this alongside the zipped code and `TECHNICAL-HANDOVER.md`. This brief is written for a fresh AI assistant picking up the work — it captures where we are, how we work together, and what comes next. The handover doc is the deep technical reference; this is the "get oriented and keep going" note.*

---

## 1. What Lintel is (in two sentences)

A white-label, multi-tenant learning platform for institutions **whose access to teaching is conditional on WHO the learner is, not merely whether they paid.** The hard problem it solves is holding a lesson closed until a learner has attained a *standing* (been initiated, examined, vouched for) — not a paywall, a *personhood* wall.

The first design partner is **Obatala Institute of Sacred Studies (OISS)**, a Yorùbá sacred-studies institution. OISS is the *hardest* tenant, chosen deliberately to force the primitives — it is **not** the product. The product is the generic engine underneath. If you ever find yourself hard-coding anything Yorùbá-specific or OISS-specific into the platform, stop — that is a design error the checkers will also catch.

## 2. Who you're working with

A solo founder-engineer (procurement analyst by day, building this alone). Works on a MacBook Air, deploys to real infrastructure. Communicates tersely and drives fast — "all green, lets move on" is the usual cadence. Values:
- **Honesty over reassurance.** If something isn't done, say so plainly. He explicitly corrected an earlier drift toward calling things "done" when they weren't. Never oversell status.
- **Direct recommendations with reasoning**, not option-menus — but he'll push back, and he's right often enough that you should listen.
- **Known limitations stated openly** at the end of each delivery, framed as honest scope, not apology.
- He reports results by **pasting terminal output** (test runs, error traces). Read them carefully — several real bugs were found only because he runs the DB suite you can't.

## 3. How the two of you actually work (the delivery loop)

You build in a sandbox; he applies to his machine and runs the tests. The rhythm:

1. You make changes in the sandbox repo, run `npm run check` (11 static checkers — must be green).
2. You **cannot run the DB test suite** in the sandbox (`mongodb-memory-server`'s binary download is blocked). This is the single biggest source of "green here, red on his machine." He runs `npm test` on his side.
3. You package changes as a **zip** (for multi-file deliveries) or **individual files** (for one or a few changed files — he prefers standalone files over a zip when it's small).
4. You give an **Add / Replace / Run manifest** — exact repo-relative paths, which files are new vs replaced, and the commands to run (usually `npm run check` then `npm test`).
5. He applies, runs, pastes the result. If red, you diagnose from the trace and fix.

**Conventions that matter to him:**
- `package.json` is delivered as **deltas, never a full-file replace** (a full replace once reverted a hand-installed dependency).
- `.env` and `.gitignore` are hand-created on his side after extraction (macOS drops dotfiles from zips).
- End every code delivery with the file manifest.

## 4. The current state (as of this brief)

**Everything builds green: 12/12 checkers, ~190 tests passing across 35 test files.** The MVP engine is complete, the entire admin authoring surface is wired, and a post-audit hardening pass has closed the known latent-crash bugs.

What exists and works:
- **Tenant isolation spine** — `AsyncLocalStorage` context; a query with no tenant context *throws*; a `tenant-guard` Mongoose plugin stamps `tenantId` at the driver level. This is the load-bearing security property. The `tests/isolation/` suite is the one that matters most — if it goes red, nothing else matters until it's green.
- **The eligibility engine** — a rule registry (7 rule types: attestation, enrolled, payment_state, course_completed, membership_role, assessment_score, manual_approval) and an evaluator that gates lesson access. This is *the reason the product exists*. Read `src/services/eligibility/evaluator.js` and `registry.js` deeply.
- **Full admin authoring UI** — every section is writable: courses/modules/lessons/blocks, eligibility policies (+ attach to lesson), media (browser→R2 upload + media blocks), cohorts (create/open/close/sessions/attendance), assessments (rubrics/grading), gradebook (schemes/line-items/scores), fees (schedules), credentials (templates/issue/revoke), attestations (standings/issue/revoke). This was a systematic "write-UI wiring audit" — nine sections that rendered data but had no write routes, now all wired, each with a test.
- **Platform console** (`/console`, superadmin-only, apex-only) — tenant oversight, abuse response, break-glass. Crucially: **platform staff have NO standing read access to tenant content** (ADR-022). The only path to content is break-glass: explicit, justified, time-boxed, logged, and it notifies the institution.
- **Media pipeline** — presigned multipart upload straight to Cloudflare R2, transcode worker (separate process) producing bitrate ladders. Just made operational (CORS + worker awareness fixed).

## 5. The invariants you must never break (short form — full text in handover Part I)

1. No tenant-specific term in platform code.
2. Every tenant doc has `tenantId` at the driver level.
3. A query with no context THROWS.
4. `Attestation`, `Grade`, `AccessLog`, `AuditLog`, `Payment` are **append-only** (a revocation is a new write, never a mutation).
5. Publication is an act, not a flag.
6. Fail closed.
7. Money is `{ amount: <integer minor units>, currency }` — never a float.
8. Content fields are locale maps (`{ en: "...", yo: "..." }`).
9. Controllers hold no logic; web + API call the same service (enforced by `check-api-parity`).
10. **No real restricted material in the database before the engine ships.** Synthetic content only. This is the one that will actually be attempted under demo pressure, and the one that matters most.

## 6. Hard-won lessons (so you don't repeat them)

- **Read the actual nested schema structure, not a flattened grep.** Several authoring forms shipped with a required field made optional, or invented a field that lives in a sub-schema (a `FeeSchedule` has no top-level `amount` — its cost is entirely in `items[]`). A grep tells you *which* fields are required; only the structure tells you *where* they live.
- **Before packaging any form, cross-check its fields against the model's real required set** — because the sandbox can't run the DB suite, schema-validation failures are invisible to you until he runs them.
- **Fixing a data-producing bug does not fix data already written.** When you fix such a bug, also write a sweep for the rows it already produced, and make the rendering defensive so one bad row can't 500 a page.
- **The parity checker (`check-api-parity`) is your friend** — when it fails because a web controller reaches a service method the API doesn't, either add the API endpoint (usually correct) or annotate `@parity-exempt` with a written reason. Don't fake symmetry.
- **Own mistakes directly and fix them.** Several bugs in this codebase were yours (the assistant's). He responds well to "that was my bug, here's the fix," badly to hand-waving.
- **When a bug reveals a *class*, close the class, not just the instance.** The lesson page 500'd because a view called `.replace()` on an undefined property. The fix wasn't just guarding that line — it was (a) guarding it, (b) sweeping the four other views with the same shape, (c) writing `check-view-fragility` so the shape can't ship again, and (d) writing `find-bad-blocks.js` to clean the data the original bug produced. That four-part response (guard + sweep + checker + data-cleanup) is the standard he now expects for this kind of bug. The build-time checker is the durable part — "I'll remember to guard it" is not a control.
- **Keep `.env.example` in exact sync with what the code reads.** Drift is a silent lockout (a missing `SUPERADMIN_EMAIL` means a fresh deploy can't create its first operator). Re-run the two-way `comm` check after any change that adds/removes an env read.

## 7. What's genuinely NOT built yet (honest backlog — these are new features, not gaps)

- **Email transport is still a stub.** `src/services/notification/channels/email.js` logs instead of sending. This is *the* real blocker for onboarding real institutions — they can't receive login details. The recommended direction (not yet built): an HTTP API provider like Resend or Postmark (better Nigerian deliverability than raw SMTP), creds in `.env`. **This is probably the highest-value next thing to build.**
- **Assessment/quiz → gradebook automatic roll-up.** Gradebook scores are hand-entered; a recorded assessment grade doesn't yet flow into its line item automatically. Line items carry a `source` field ready for this.
- **Full invoice + payment collection UI.** Fee *setup* is done (schedules). Recording a payment needs an invoice (raised against an enrolment), and the Paystack online-payment path exists in the service but isn't UI-wired. The full collection flow is unbuilt.
- **Learner-facing course browser.** The admin authoring side is complete, but the learner PWA is still a minimal shell — lessons open via `?lesson=<id>`, no client-side course browser. The load-bearing parts (engine-gated assembly, watermarking, offline refusal) are done; navigation is thin.
- **Break-glass content viewer.** Break-glass *grants* access, notifies, audits, and expires — but no viewer consumes an active grant yet. Deliberately deferred (it's the dangerous surface, to be designed *with* institutions).

## 8. The highest-leverage NON-code move

Take the working MVP to OISS and get the **three denial sentences** written (Yorùbá + English) — the messages a learner sees when a door is held. They're currently `__OISS_TO_WRITE__` placeholders. Plus the outstanding governance decisions (gender/lineage rules, traditional-medicine content policy). Every piece of software OISS depends on is now built and green; the blockers now are content and governance, not code. The founder knows this; nudge toward it when code work reaches a natural pause.

## 9. First moves in the new chat

1. Read `TECHNICAL-HANDOVER.md` in full — especially Part I (invariants), Part VIII (things that will bite you), and the eligibility engine section.
2. Unzip the code; run `npm run check` to confirm green, `npm test` to confirm the suite.
3. Ask the founder what he wants to tackle — but if he's open to a recommendation, **email transport** is the thing standing between "works on my machine" and "works for real institutions."
4. Keep the delivery loop (Section 3) and the honesty (Section 2). Maintain a visible checklist if the task has multiple parts — he values seeing what remains.

---

*One last thing: the name. A lintel is the stone that bears the weight above a doorway. Every screen in this product is about a door — opened, held, and who holds the key. Keep that metaphor in mind; it's not decoration, it's the design.*
