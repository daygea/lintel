# The transcode worker (audio & video)

Uploaded **images and PDFs are ready immediately**. **Audio and video** are held in
a "preparing" state until a worker transcodes them into streamable derivatives.
That worker needs `ffmpeg`, which Render's native Node runtime doesn't include — so
it runs as a small **Docker-based Background Worker**, built from `worker.Dockerfile`.

It's completely separate from the web service: it opens no ports, serves no pages.
It connects to the same MongoDB, watches the `Job` queue, and whenever the web app
enqueues a `media.transcode` job (on an audio/video upload) it pulls the source from
R2, encodes it, uploads the derivatives back to R2, and flips the asset to `ready` —
at which point learners can play it.

---

## Deploy it on Render

1. **Push** `worker.Dockerfile` to the repo (root).
2. Render → **New +** → **Background Worker**.
3. **Connect** the same GitHub repo (`daygea/lintel`).
4. **Language / Runtime: Docker.**
5. **Dockerfile Path:** `./worker.Dockerfile`
6. **Region:** the **same region as your web service** (Oregon), so they share a
   network and hit Atlas from the same place.
7. **Instance type:** Background Workers require a **paid** plan — **Starter ($7/mo)**
   is the minimum. Note transcoding is CPU-bound: Starter (0.5 CPU) is fine for short
   clips and testing; for real lecture-length video, **Standard (1 CPU, $25/mo)** or
   higher will encode much faster.
8. **Environment variables** — set the same ones the web service uses (copy them):
   - `MONGODB_URI` — the **same** Atlas string as the web service (they share the queue)
   - `SESSION_SECRET` — any value; the worker doesn't use it, but config validation
     requires it to be present
   - `ROOT_DOMAIN` — `lintel.africa` (same reason — required by config validation)
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — the
     **same** R2 bucket as the web service
   - `NODE_ENV` — `production` (already set in the Dockerfile, harmless to repeat)
9. **Create.** First build takes a few minutes (it installs ffmpeg). When it's up,
   the logs show `worker started` with the handler `media.transcode`.

---

## Verify end to end

1. In the admin UI, upload a short **audio or video** file to a lesson.
2. Watch the **worker logs** in Render — you'll see it pick up the job and run ffmpeg.
3. Refresh the lesson: the block moves from "still being prepared" to a working
   player. (If it stays "preparing", check the worker logs and that its `R2_*` and
   `MONGODB_URI` match the web service exactly.)

---

## Notes

- **One worker is enough to start.** If a backlog builds up, bump the instance type
  or run a second worker — the queue hands each job to whichever worker grabs it
  first, and an interrupted job is reclaimed and retried, so scaling is safe.
- **Cost:** this is the first piece of Lintel that isn't free — a Background Worker
  is always-on. If you only need A/V occasionally, you can suspend the worker between
  uses; queued jobs wait and process when it's back.
- **The web service doesn't change.** It already enqueues transcode jobs on upload;
  it was just that nothing was consuming them. No web redeploy is needed.
