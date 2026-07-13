# Lintel

A multi-tenant learning platform for institutions whose access to teaching is conditional on **who the learner is**, not merely on whether they paid.

> A lintel is the stone that bears the weight above a doorway. Every screen in this product is about a door: opened, held, and who holds the key.

**Sprint 0 — foundation and tenancy. Complete.**

---

## Run it

```bash
cp .env.example .env          # then edit SESSION_SECRET
npm install
npm run seed                  # two synthetic tenants
npm run dev
```

Add to `/etc/hosts`:

```
127.0.0.1  alpha.lintel.test beta.lintel.test
```

Then open `http://alpha.lintel.test:3000`. Sign in as `owner@example.test` / `correct-horse-battery-staple`.

Switch to `beta.lintel.test:3000` and you are, structurally, in a different institution.

```bash
npm run check           # the nine checkers — invariants, not style
npm run test:isolation  # the suite that matters
npm test                # everything
git config core.hooksPath .githooks   # block commits that break an invariant
```

## Read before you write code

**`docs/ENGINEERING-PLAN-v1.0.md`, Part I.** The ten invariants are not preferences — several of them are the entire reason this product exists. In particular:

1. **No tenant term in the codebase.** OISS's rules are rows in `AttestationType` and `EligibilityPolicy`, never branches in an `if`. Enforced by `check-no-tenant-terms`.
2. **A query without tenant context throws rather than leaking.** That is the desired failure mode. Do not "fix" it by defaulting the tenant. See `src/plugins/tenant-guard.js`.
3. **Append-only means append-only.** Revocation is a *write*. A moderated grade is a *new* grade. When an elder overrules a junior assessor, both judgements survive.
4. **No real restricted material in any environment before Sprint 3 ships.** Synthetic content only. This is the invariant that will actually be broken, under demo pressure, and it is the one that matters most.

## What Sprint 0 delivered

| Area | Files |
|---|---|
| Tenant context | `src/lib/context.js` — `AsyncLocalStorage`, `runWithTenant`, `runAsPlatform` |
| **Tenant isolation** | `src/plugins/tenant-guard.js` — the most important file in the repo |
| Immutability | `src/plugins/append-only.js` |
| i18n | `src/plugins/locale-map.js` — locale maps + diacritic-folded search shadow |
| Money | `src/lib/money.js` — minor units + ISO code. Never a float. |
| Models | `Tenant`, `User` (platform-scoped) · `Membership`, `AuditLog` (tenant-scoped) |
| Auth | Sessions, bcrypt, TOTP MFA, invites, CSRF |
| Routing | Host-based tenant resolution (subdomain and custom domain) |
| Registry | `src/config/features.js`, `src/config/plans.js` |
| Guardrails | 9 checkers, CI, pre-commit hook |
| Proof | 14 isolation tests + 5 context tests |

## Next: Sprint 1 — curriculum and media

`Program → Course → Module → Lesson → ContentBlock`, the media pipeline, course copy, and diacritic-insensitive search. `visibility` defaults to `private` and stays unused until Sprint 11 — build the door now, open it later.

Do not build access control in Sprint 1. Everything is visible to anyone enrolled. That is correct, and Sprint 3 fixes it.
