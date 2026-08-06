# Deploying Lintel to Render (lintel.africa)

Lintel is a Node app that needs **MongoDB** and (for media) **Cloudflare R2**. Render
runs the web service; MongoDB comes from **Atlas** (Render has no managed Mongo).
Tenants resolve by **subdomain** (`oiss.lintel.africa`), so DNS needs a wildcard.

Do these in order.

---

## 1. MongoDB Atlas (the database)

1. Create a free account at mongodb.com/atlas → **Build a Database** → **M0 (free)**.
2. Put the cluster in a region near Render's (Frankfurt / `eu-central`) to keep
   app↔DB latency low.
3. **Database Access** → add a user (username + strong password). Save these.
4. **Network Access** → **Add IP** → `0.0.0.0/0` (allow from anywhere — Render's
   egress IPs aren't fixed on lower tiers). You can tighten this later.
5. **Connect** → **Drivers** → copy the connection string. It looks like:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxx.mongodb.net/?retryWrites=true&w=majority`
   Insert the DB name before the `?` so data lands in one place:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxx.mongodb.net/lintel?retryWrites=true&w=majority`
   That final string is your **`MONGODB_URI`**.

---

## 2. Cloudflare R2 (media storage)

You already have R2 configured locally — reuse those four values
(`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`). If the
bucket is new, run the CORS setup once (`node scripts/set-r2-cors.js` if present)
so the browser can load signed URLs.

---

## 3. Render web service

1. Push the repo to GitHub (you're already doing this) with `render.yaml` at the root.
2. Render → **New +** → **Blueprint** → pick the repo. Render reads `render.yaml`
   and creates the `lintel` web service.
3. Open the service → **Environment** and fill every `sync: false` value:
   `MONGODB_URI`, `SUPERADMIN_EMAIL`, the four `R2_*`, and (optionally)
   `RESEND_API_KEY` + `EMAIL_FROM` and `PAYSTACK_SECRET_KEY`.
   - `SESSION_SECRET` is auto-generated; `NODE_ENV`, `NODE_VERSION`, `ROOT_DOMAIN`
     are already set. **Do not set `PORT`** — Render injects it and the app reads it.
4. **Deploy**. Watch the logs for `connected to mongodb` and `lintel listening on`.
   Render's health check hits `/healthz`.
5. Test at the temporary URL Render gives you (`lintel-xxxx.onrender.com`). The apex
   there shows the marketing/home page (no tenant). Tenant subdomains need the real
   domain (next step), since `*.onrender.com` isn't your root domain.

---

## 4. Point lintel.africa at Render (Namecheap DNS)

Lintel serves the apex as marketing and every `*.lintel.africa` as a tenant, so you
need the apex, `www`, **and a wildcard**.

**In Render:** service → **Settings** → **Custom Domains** → add all three:
`lintel.africa`, `www.lintel.africa`, `*.lintel.africa`. Render shows the exact DNS
records for each — use the values Render displays (they're authoritative), not
guesses. They'll be roughly:

**In Namecheap:** Domain List → **Manage** → **Advanced DNS** → add:

| Type  | Host | Value                          | Notes                          |
|-------|------|--------------------------------|--------------------------------|
| A     | `@`  | (the IP Render shows for apex) | apex → Render                  |
| CNAME | `www`| `lintel-xxxx.onrender.com`     | Render shows your exact target |
| CNAME | `*`  | `lintel-xxxx.onrender.com`     | wildcard → all tenant subdomains |

Delete Namecheap's default parking/"CNAME @ → parkingpage" records so they don't
conflict. DNS + TLS take a few minutes to an hour.

**Wildcard TLS note:** Render provisions a wildcard certificate via Let's Encrypt.
For the wildcard (`*.lintel.africa`) it may ask you to add a one-time
`_acme-challenge` **TXT** record (DNS validation) — if so, Render shows it; add it
in Namecheap and Render finishes automatically. If wildcard certs give you trouble
at first, a fine interim step is to add each live tenant subdomain
(`oiss.lintel.africa`) as its own custom domain in Render — simpler per-domain
certs — and switch to the wildcard once you have several tenants.

---

## 5. First-run tasks (once, after the first successful deploy)

1. **Build the indexes** (rebuilds the Cohort/Payment indexes as partial — required):
   Render → service → **Shell** → run:
   ```
   npm run indexes
   ```
2. **Get into the platform console:** the app ensures a superadmin for
   `SUPERADMIN_EMAIL` on boot. Sign in / set that account's password through the
   normal onboarding, then the console lives at `lintel.africa/console`.
3. **Create your first institution** from the console (or the signup flow), give it
   a slug, and it's reachable at `slug.lintel.africa`.

---

## 6. Later: the transcode worker (audio & video)

Audio/video uploads stay in "preparing" until a worker transcodes them, and the
worker needs **ffmpeg**, which Render's Node runtime doesn't include. Text, images,
and PDFs work without it. When you want A/V, add a **second Render service** built
from a Dockerfile that installs ffmpeg and runs `npm run worker`, sharing the same
env vars (`MONGODB_URI`, `R2_*`). Ping me and I'll write that Dockerfile + service.

---

## Environment variable checklist

| Variable                | Required | Where it comes from                         |
|-------------------------|----------|---------------------------------------------|
| `MONGODB_URI`           | yes      | MongoDB Atlas connection string             |
| `SESSION_SECRET`        | yes      | auto-generated by Render                    |
| `ROOT_DOMAIN`           | yes      | `lintel.africa` (set in render.yaml)        |
| `SUPERADMIN_EMAIL`      | yes      | your email — gets the console               |
| `R2_ACCOUNT_ID` etc.    | yes*     | Cloudflare R2 (needed for any media)        |
| `RESEND_API_KEY`        | no       | Resend — real email; omit for dev-log mode  |
| `EMAIL_FROM`            | with Resend | verified sender on lintel.africa         |
| `PAYSTACK_SECRET_KEY`   | no       | Paystack — live online payments             |
| `PORT`                  | no       | injected by Render — do not set             |

\* Without R2 the app runs, but no media (image/pdf/audio/video) can be served.
