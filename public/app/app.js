/**
 * The learner PWA. Deliberately small and framework-free — it must open on a
 * cheap Android phone over 3G, and every kilobyte is weight a learner pays for.
 *
 * It talks only to the JSON API. It renders a held teaching as the institution's
 * own words, never as an error. It burns the watermark into playback. It never
 * decides eligibility itself — the server does, and this only draws the result.
 */

const root = document.getElementById('root');
let STATE = { csrf: '', institution: '', lessonTitles: {} };

async function boot() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('/sw.js'); } catch {}
  }

  // Deep link to a single lesson, else the learner's home.
  const lessonId = new URLSearchParams(location.search).get('lesson');
  if (lessonId) return renderLesson(lessonId);
  return renderHome();
}

/* --------------------------------------------------------------------- home */

async function renderHome() {
  root.innerHTML = `<p class="muted">Loading…</p>`;
  let data;
  try {
    const res = await fetch('/api/v1/me/learning', { headers: { Accept: 'application/json' } });
    if (res.status === 401) { window.location.href = '/login'; return; }
    data = await res.json();
  } catch {
    return renderOfflineOnly();
  }

  STATE.csrf = data.csrfToken || '';
  STATE.institution = data.institution || '';
  setCsrfMeta(STATE.csrf); // so push.js (and any POST) has a token
  indexLessonTitles(data.courses);

  const courses = data.courses || [];
  let html = `<h1>Your learning</h1>`;
  if (STATE.institution) html += `<p class="muted" style="margin-top:-6px">${escapeHtml(STATE.institution)}</p>`;

  if (!courses.length) {
    html += `
      <div class="card">
        <p style="margin:0">You're not enrolled in anything yet.</p>
        <p class="muted" style="margin:8px 0 0">When a registrar enrols you in a cohort, your courses appear here.</p>
      </div>`;
  } else {
    html += courses.map(courseCard).join('');
  }

  html += `<div id="offline" style="margin-top:26px"></div>`;
  root.innerHTML = html;
  wireHome();
  renderOfflineList();
}

function courseCard(course) {
  const total = course.lessonCount || 0;
  const open = course.openCount || 0;
  const meter = total
    ? `<div class="meter" aria-hidden="true"><span style="width:${Math.round((open / total) * 100)}%"></span></div>
       <div class="muted" style="margin-top:4px">${open} of ${total} open</div>`
    : `<div class="muted">No lessons yet.</div>`;

  const modules = (course.modules || []).map(moduleBlock).join('');

  return `
    <section class="course">
      <div class="course-head">
        <span class="code mono">${escapeHtml(course.code || '')}</span>
        <h2>${pickText(course.title)}</h2>
        ${course.cohortTitle ? `<div class="muted">${pickText(course.cohortTitle)}</div>` : ''}
      </div>
      ${meter}
      <div class="modules">${modules || '<p class="muted">No lessons yet.</p>'}</div>
    </section>`;
}

function moduleBlock(mod) {
  const lessons = (mod.lessons || []).map(lessonRow).join('');
  return `
    <div class="module">
      <h3>${pickText(mod.title)}</h3>
      <ul class="lessons">${lessons}</ul>
    </div>`;
}

function lessonRow(lesson) {
  const mins = lesson.estimatedMinutes ? `<span class="muted">${lesson.estimatedMinutes} min</span>` : '';
  const chip = lesson.held
    ? `<span class="chip held-chip">held</span>`
    : progressChip(lesson.progress);

  if (lesson.held) {
    // A held teaching is a door, not an error. Show the institution's words on tap.
    return `
      <li class="lesson is-held" data-held-msg="${escapeAttr(lesson.message || '')}">
        <button class="lesson-open" aria-expanded="false">
          <span class="thr-dot held"></span>
          <span class="lesson-title">${pickText(lesson.title)}</span>
          <span class="lesson-meta">${mins} ${chip}</span>
        </button>
        <div class="held-note" hidden></div>
      </li>`;
  }

  return `
    <li class="lesson is-open">
      <a class="lesson-open" href="?lesson=${lesson.id}">
        <span class="thr-dot open"></span>
        <span class="lesson-title">${pickText(lesson.title)}</span>
        <span class="lesson-meta">${mins} ${chip}</span>
      </a>
    </li>`;
}

function progressChip(state) {
  if (state === 'complete') return `<span class="chip done-chip">done</span>`;
  if (state === 'in_progress') return `<span class="chip prog-chip">in progress</span>`;
  return `<span class="chip open-chip">open</span>`;
}

function wireHome() {
  // Held lessons expand to reveal the institution's denial message.
  root.querySelectorAll('.lesson.is-held .lesson-open').forEach((btn) => {
    btn.addEventListener('click', () => {
      const li = btn.closest('.lesson');
      const note = li.querySelector('.held-note');
      const open = !note.hidden;
      note.hidden = open;
      btn.setAttribute('aria-expanded', String(!open));
      if (!open && !note.textContent) note.textContent = li.dataset.heldMsg || 'This teaching is held until your standing is attested.';
    });
  });
}

/* ------------------------------------------------------------------- lesson */

async function renderLesson(lessonId) {
  root.innerHTML = `<p class="muted">Loading lesson…</p>`;
  let data;
  try {
    const res = await fetch(`/api/v1/lessons/${lessonId}/view`, { headers: { Accept: 'application/json' } });
    if (res.status === 401) { window.location.href = '/login'; return; }
    data = await res.json();
  } catch {
    const pack = await window.lintelPacks.get(lessonId);
    if (pack) return renderPack(pack);
    root.innerHTML = backLink() + `<div class="err">You are offline and this lesson is not saved for offline use.</div>`;
    return;
  }

  if (data.csrfToken) { STATE.csrf = data.csrfToken; setCsrfMeta(data.csrfToken); }

  if (data.held) {
    root.innerHTML = backLink() + `
      <div class="held" role="status" aria-live="polite">
        <blockquote>${escapeHtml(data.message)}</blockquote>
      </div>
      <p class="muted" style="margin-top:14px">This teaching is held. When your standing is attested, it will open here.</p>`;
    return;
  }

  root.innerHTML = backLink() + `<h1>${pickText(data.lesson.title)}</h1><div id="blocks"></div>`;
  const container = document.getElementById('blocks');
  for (const block of data.blocks) container.appendChild(renderBlock(block, lessonId));

  if (data.enrollmentId) container.appendChild(completeControl(lessonId, data.enrollmentId));
}

function completeControl(lessonId, enrollmentId) {
  const wrap = document.createElement('div');
  wrap.className = 'card complete-card';
  wrap.innerHTML = `<button class="btn" id="mark-complete">Mark this lesson complete</button>`;
  wrap.querySelector('#mark-complete').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const res = await fetch('/api/v1/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeader() },
        body: JSON.stringify({ enrollmentId, lessonId, state: 'complete' }),
      });
      if (!res.ok) throw new Error('Could not save');
      btn.textContent = 'Completed ✓';
      btn.classList.add('offline-ok');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Try again';
    }
  });
  return wrap;
}

function renderBlock(block, lessonId) {
  const el = document.createElement('div');
  el.className = 'card';

  if (block.preparing) {
    el.className = 'card preparing';
    el.innerHTML = `<p class="muted" style="margin:0 0 10px">⏳ ${escapeHtml(block.reason || 'This lesson is still being prepared — check back shortly.')}</p>
      <button class="btn ghost" onclick="location.reload()">Check again</button>`;
    return el;
  }

  if (block.unavailable) {
    el.innerHTML = `<p class="muted">${escapeHtml(block.reason || 'This content is unavailable.')}</p>`;
    return el;
  }

  if (block.type === 'rich_text') {
    el.innerHTML = pickRaw(block.body);
    return el;
  }

  if (block.streamUrl) {
    const wm = block.watermark ? `<span class="watermark">${escapeHtml(block.watermark)}</span>` : '';
    const labels = (block.tkLabels || []).map((l) => `<span class="tk">${escapeHtml(l)}</span>`).join('');
    let media;
    let footer = '';

    if (block.type === 'image') {
      media = `<div class="player img"><img alt="Lesson image" src="${block.streamUrl}">${wm}</div>`;
    } else if (block.type === 'pdf') {
      media = `<div class="player pdf"><iframe title="Lesson document" src="${block.streamUrl}"></iframe>${wm}</div>`;
    } else {
      // video, audio — and archive_ref, which streams as video. A video element
      // plays audio-only sources too, so streamOnly archive material is safe here.
      const isVideo = block.type === 'video' || block.streamOnly;
      media = isVideo
        ? `<div class="player"><video controls controlsList="nodownload" src="${block.streamUrl}"></video>${wm}</div>`
        : `<div class="player"><audio controls controlsList="nodownload" src="${block.streamUrl}"></audio>${wm}</div>`;
      // Offline save is only meaningful for the media the offline pack + player
      // support (audio/video). Images and documents render inline, online.
      footer = block.downloadable
        ? `<button class="btn ghost" data-save="${lessonId}" style="margin-top:10px" aria-live="polite">Save for offline</button>`
        : `<p class="muted" style="margin-top:8px">Streaming only — cannot be saved.</p>`;
    }

    el.innerHTML = media + (labels ? `<div style="margin-top:8px">${labels}</div>` : '') + footer;

    const btn = el.querySelector('[data-save]');
    if (btn) btn.addEventListener('click', async () => {
      btn.textContent = 'Saving…';
      try {
        await window.lintelPacks.download(lessonId);
        btn.textContent = 'Saved ✓';
        btn.classList.add('offline-ok');
      } catch (err) {
        btn.textContent = err.message;
      }
    });
    return el;
  }

  el.innerHTML = `<p class="muted">Unsupported block.</p>`;
  return el;
}

function renderPack(pack) {
  root.innerHTML = backLink() + `<h1>${pickText(pack.title)}</h1><p class="offline-ok">Saved offline</p><div id="blocks"></div>`;
  const c = document.getElementById('blocks');
  for (const b of pack.blocks) {
    const el = document.createElement('div');
    el.className = 'card';
    if (b.type === 'rich_text') el.innerHTML = pickRaw(b.body);
    else if (b.downloadUrl) el.innerHTML = `<audio controls src="${b.downloadUrl}"></audio>`;
    c.appendChild(el);
  }
}

/* ------------------------------------------------------------------ offline */

async function renderOfflineList() {
  const el = document.getElementById('offline');
  if (!el) return;
  const saved = await window.lintelPacks.list();
  if (!saved.length) return; // no clutter when there's nothing saved
  el.innerHTML = `<h2 style="font-size:15px">Saved offline</h2>` +
    saved.map((s) => {
      const title = STATE.lessonTitles[s.lessonId] || 'Saved lesson';
      return `<div class="card"><a href="?lesson=${s.lessonId}">${escapeHtml(title)}</a></div>`;
    }).join('');
}

// When the network is gone entirely, still surface anything saved offline.
async function renderOfflineOnly() {
  const saved = await window.lintelPacks.list();
  let html = `<h1>Your learning</h1><div class="err">You're offline. Showing lessons saved to this device.</div>`;
  if (!saved.length) { root.innerHTML = html + `<p class="muted">Nothing is saved offline yet.</p>`; return; }
  html += saved.map((s) => `<div class="card"><a href="?lesson=${s.lessonId}">${escapeHtml(STATE.lessonTitles[s.lessonId] || 'Saved lesson')}</a></div>`).join('');
  root.innerHTML = html;
}

/* ------------------------------------------------------------------- shared */

document.getElementById('notify').addEventListener('click', async () => {
  try {
    if (!(await window.lintelPush.isSupported())) {
      alert('Reminders need the app installed to your home screen.');
      return;
    }
    await window.lintelPush.subscribe();
    alert('Reminders on.');
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('signout')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    await fetch('/logout', { method: 'POST', headers: { ...csrfHeader() } });
  } catch {}
  window.location.href = '/login';
});

function indexLessonTitles(courses) {
  for (const c of courses || []) {
    for (const m of c.modules || []) {
      for (const l of m.lessons || []) STATE.lessonTitles[l.id] = pickText(l.title);
    }
  }
}

const backLink = () => `<div style="margin-bottom:14px"><a class="back" href="/app/">← Your learning</a></div>`;
const csrfHeader = () => {
  const t = STATE.csrf || document.querySelector('meta[name="csrf-token"]')?.content;
  return t ? { 'x-csrf-token': t } : {};
};
function setCsrfMeta(token) {
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (meta && token) meta.content = token;
}

function pickText(map) {
  if (!map) return '';
  if (typeof map === 'string') return escapeHtml(map);
  return escapeHtml(map.en || Object.values(map)[0] || '');
}
// rich_text blocks hold HTML authored by staff (a trusted rich-text field) and
// must render as markup, not escaped text. Everything else (titles, labels) keeps
// going through pickText/escapeHtml so it can never inject markup.
function pickRaw(map) {
  if (!map) return '';
  if (typeof map === 'string') return map;
  return map.en || Object.values(map)[0] || '';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

boot();
