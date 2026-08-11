/**
 * The learner PWA. Deliberately small and framework-free — it must open on a
 * cheap Android phone over 3G, and every kilobyte is weight a learner pays for.
 *
 * It talks only to the JSON API. It renders a held teaching as the institution's
 * own words, never as an error. It burns the watermark into playback. It never
 * decides eligibility itself — the server does, and this only draws the result.
 */

const root = document.getElementById('root');
let STATE = { csrf: '', institution: '', lessonTitles: {}, courses: null, loaded: false };

async function boot() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('/sw.js'); } catch {}
  }

  wireRouter();
  route();
}

/* --------------------------------------------------------------------- home */

/* ------------------------------------------------------------------- data */

// The learner's whole picture in one call: courses → modules → lessons (+quizzes),
// with held/progress state. Cached on STATE so the outline is built once per view.
async function loadLearning(force) {
  if (STATE.loaded && !force) return STATE.courses;
  const res = await fetch('/api/v1/me/learning', { headers: { Accept: 'application/json' } });
  if (res.status === 401) { window.location.href = '/login'; return null; }
  const data = await res.json();
  STATE.csrf = data.csrfToken || '';
  setCsrfMeta(STATE.csrf);
  STATE.institution = data.institution || '';
  STATE.learnerName = data.learnerName || '';
  STATE.courses = data.courses || [];
  STATE.loaded = true;
  indexLessonTitles(STATE.courses);
  return STATE.courses;
}

const findCourse = (id) => (STATE.courses || []).find((c) => String(c.id) === String(id));

function courseOfLesson(lessonId) {
  for (const c of STATE.courses || []) {
    for (const m of c.modules || []) {
      if ((m.lessons || []).some((l) => String(l.id) === String(lessonId))) return c;
    }
  }
  return null;
}

function flatLessons(course) {
  const out = [];
  for (const m of course.modules || []) for (const l of m.lessons || []) out.push(l);
  return out;
}

function courseProgress(course) {
  const all = flatLessons(course);
  const done = all.filter((l) => l.progress === 'complete').length;
  return { done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0 };
}

/* ------------------------------------------------------------------ shell */

function shell(sideHtml, paneHtml) {
  return `
    <div class="shell">
      <aside class="side" id="side" aria-label="Course navigation">${sideHtml}</aside>
      <div class="pane" id="pane">${paneHtml}</div>
    </div>
    <div class="scrim" id="scrim" aria-hidden="true"></div>`;
}

function solo(html) { return `<div class="solo">${html}</div>`; }

function wireShell() {
  document.body.classList.add('has-shell');
  const toggle = document.getElementById('nav-toggle');
  const scrim = document.getElementById('scrim');
  if (toggle) toggle.onclick = () => document.body.classList.toggle('nav-open');
  if (scrim) scrim.onclick = () => document.body.classList.remove('nav-open');
  // Any navigation inside the drawer should close it.
  document.querySelectorAll('.side a').forEach((a) => a.addEventListener('click', () => document.body.classList.remove('nav-open')));
}

/* --------------------------------------------------------------- sidebars */

function sideCourseList(courses, activeId) {
  const items = (courses || []).map((c) => {
    const p = courseProgress(c);
    const active = String(c.id) === String(activeId) ? ' active' : '';
    return `<a class="side-item${active}" href="?course=${c.id}">
      <span class="o-title">${pickText(c.title)}</span>
      <span class="side-sub">${p.done}/${p.total}</span></a>`;
  }).join('');
  return `<div class="side-head">My courses</div>
    ${items || '<p class="muted" style="padding:0 16px">No courses yet.</p>'}
    <a class="side-cta btn ghost" href="/apply">Browse open programmes</a>
    <a class="side-cta" href="/my/fees" style="font-size:13px">Fees &amp; payments</a>`;
}

function sideOutline(course, activeLessonId) {
  const modules = (course.modules || []).map((m) => {
    const lessons = (m.lessons || []).map((l) => outlineLesson(l, activeLessonId)).join('');
    return `<div class="side-mod"><div class="side-mod-title">${pickText(m.title)}</div>${lessons}</div>`;
  }).join('');
  const quizzes = (course.quizzes || []).length
    ? `<div class="side-mod"><div class="side-mod-title">Quizzes</div>${course.quizzes.map(outlineQuiz).join('')}</div>`
    : '';
  return `<a class="side-back" href="/app/">← My courses</a>
    <div class="side-course">${pickText(course.title)}</div>
    ${modules}${quizzes}`;
}

function outlineLesson(l, activeId) {
  const active = String(l.id) === String(activeId) ? ' active' : '';
  const icon = l.held
    ? '<span class="o-dot held" title="Held"></span>'
    : l.progress === 'complete'
      ? '<span class="o-check" aria-label="complete">✓</span>'
      : '<span class="o-dot open"></span>';
  return `<a class="o-item${active}${l.held ? ' is-held' : ''}" href="?lesson=${l.id}">${icon}<span class="o-title">${pickText(l.title)}</span></a>`;
}

function outlineQuiz(q) {
  return `<a class="o-item" href="?quiz=${q.id}"><span class="o-dot open"></span><span class="o-title">${pickText(q.title)}</span></a>`;
}

/* --------------------------------------------------------------------- home */

async function renderHome() {
  root.innerHTML = `<p class="muted" style="padding:22px 18px">Loading…</p>`;
  let courses;
  try { courses = await loadLearning(); } catch { return renderOfflineOnly(); }
  if (courses == null) return; // redirected to login

  const first = STATE.learnerName ? escapeHtml(STATE.learnerName.split(' ')[0]) : '';
  const hero = `
    <section class="hero">
      <div class="hero-eyebrow">${escapeHtml(STATE.institution || 'Lintel')}</div>
      <h1>${first ? 'Welcome back, ' + first : 'Welcome back'}</h1>
      <p>${courses.length
        ? 'Pick up where you left off, or explore what\u2019s open.'
        : 'Your courses will appear here once you\u2019re enrolled.'}</p>
    </section>`;

  const resume = pickResume(courses);
  const continueBlock = resume ? continueCard(resume) : '';

  const grid = courses.length
    ? `<h2 class="section-h">Your courses</h2><div class="grid">${courses.map(homeCard).join('')}</div>`
    : `<div class="card"><p style="margin:0">You're not enrolled in anything yet.</p>
        <p class="muted" style="margin:8px 0 0">Apply to an open programme below, or a registrar can enrol you directly.</p></div>`;

  root.innerHTML = `<div class="home">
    ${hero}
    ${continueBlock}
    ${grid}
    <p style="margin-top:22px"><a class="btn" href="/apply">Browse open programmes</a> <a class="btn ghost" href="/my/fees" style="margin-left:8px">Fees &amp; payments</a></p>
    <div id="offline" style="margin-top:26px"></div>
  </div>`;
  renderOfflineList();
}

// The course to resume: the in-progress one with the most completed lessons,
// else the first course that still has an open lesson to start.
function pickResume(courses) {
  const inProgress = courses
    .map((c) => ({ c, p: courseProgress(c) }))
    .filter((x) => x.p.done > 0 && x.p.done < x.p.total)
    .sort((a, b) => b.p.done - a.p.done);
  if (inProgress.length) return inProgress[0].c;
  return courses.find((c) => flatLessons(c).some((l) => !l.held && l.progress !== 'complete')) || null;
}

function continueCard(course) {
  const p = courseProgress(course);
  const flat = flatLessons(course);
  const next = flat.find((l) => !l.held && l.progress !== 'complete') || flat.find((l) => !l.held);
  return `
    <div class="continue">
      <div style="flex:1;min-width:220px">
        <div class="continue-eyebrow">Continue learning</div>
        <div class="continue-title">${pickText(course.title)}</div>
        <div class="meter" style="margin-top:10px"><span style="width:${p.pct}%"></span></div>
        <div class="c-prog" style="margin-top:5px">${p.done} of ${p.total} lessons${next ? ' \u00b7 next: ' + pickText(next.title) : ''}</div>
      </div>
      ${next
        ? `<a class="btn" href="?lesson=${next.id}">Resume</a>`
        : `<a class="btn ghost" href="?course=${course.id}">Review</a>`}
    </div>`;
}

// A course cover: the uploaded image if there is one, otherwise a deterministic
// gradient + monogram so every card looks intentional even before a cover is set.
function coverArt(course, cls) {
  if (course.coverUrl) {
    return `<span class="${cls}" style="background-image:url('${course.coverUrl}')"></span>`;
  }
  const key = String(course.code || course.id || '');
  let seed = 0;
  for (let i = 0; i < key.length; i++) seed = (seed + key.charCodeAt(i)) % 360;
  const h2 = (seed + 42) % 360;
  const mono = escapeHtml((pickText(course.title) || course.code || '?').trim().charAt(0).toUpperCase());
  return `<span class="${cls} gen" style="background:linear-gradient(135deg,hsl(${seed} 42% 30%),hsl(${h2} 48% 20%))"><span class="mono-badge">${mono}</span></span>`;
}

function homeCard(course) {
  const p = courseProgress(course);
  return `
    <a class="c-card" href="?course=${course.id}">
      ${coverArt(course, 'c-cover')}
      <span class="c-body">
        <span class="c-code mono">${escapeHtml(course.code || '')}</span>
        <span class="c-title">${pickText(course.title)}</span>
        ${course.cohortTitle ? `<span class="c-sub">${pickText(course.cohortTitle)}</span>` : ''}
        <span class="meter" aria-hidden="true"><span style="width:${p.pct}%"></span></span>
        <span class="c-prog">${p.done} of ${p.total} lessons</span>
      </span>
    </a>`;
}

/* ------------------------------------------------------------------- course */

async function renderCourse(courseId) {
  root.innerHTML = `<p class="muted" style="padding:22px 18px">Loading…</p>`;
  let courses;
  try { courses = await loadLearning(); } catch { return renderOfflineOnly(); }
  if (courses == null) return;
  const course = findCourse(courseId);
  if (!course) { root.innerHTML = shell('', `<p class="err">Course not found.</p><p><a class="btn ghost" href="/app/">← My courses</a></p>`); wireShell(); return; }

  const p = courseProgress(course);
  const flat = flatLessons(course);
  const next = flat.find((l) => !l.held && l.progress !== 'complete') || flat.find((l) => !l.held);

  const pane = `
    <div class="course-hero">
      ${coverArt(course, 'course-cover')}
      <div class="course-hero-body">
        <span class="c-code mono">${escapeHtml(course.code || '')}</span>
        <h1>${pickText(course.title)}</h1>
        ${course.cohortTitle ? `<p class="muted" style="margin-top:-2px">${pickText(course.cohortTitle)}</p>` : ''}
        <div class="meter big" style="margin-top:14px" aria-hidden="true"><span style="width:${p.pct}%"></span></div>
        <p class="muted" style="margin-top:6px">${p.done} of ${p.total} lessons complete${p.pct === 100 ? ' \u00b7 done \u2713' : ''}</p>
        ${next
          ? `<p style="margin-top:16px"><a class="btn" href="?lesson=${next.id}">${p.done ? 'Continue' : 'Start'}: ${pickText(next.title)}</a></p>`
          : '<p class="muted" style="margin-top:12px">No open lessons yet.</p>'}
      </div>
    </div>
    <p class="quiet" style="font-size:13px;margin-top:20px">Use the course outline to jump to any lesson${(course.quizzes || []).length ? ' or quiz' : ''}.</p>`;

  root.innerHTML = shell(sideOutline(course, null), pane);
  wireShell();
}

function courseQuizRow(q) {
  const left = Math.max(0, (q.attemptsAllowed || 1) - (q.attemptsUsed || 0));
  const tag = left <= 0
    ? '<span class="chip done-chip">completed</span>'
    : `<span class="chip open-chip">${left} attempt${left === 1 ? '' : 's'} left</span>`;
  const inner = `<span class="lesson-title">${pickText(q.title)}</span>
    <span class="lesson-meta"><span class="muted">${q.questionCount} question${q.questionCount === 1 ? '' : 's'}</span> ${tag}</span>`;
  return left <= 0
    ? `<li class="q-row">${inner}</li>`
    : `<li class="q-row"><a href="?quiz=${q.id}">${inner}</a></li>`;
}

/* ------------------------------------------------------- lesson prev / next */

function lessonNav(course, lessonId) {
  if (!course) return '';
  const flat = flatLessons(course);
  const i = flat.findIndex((l) => String(l.id) === String(lessonId));
  if (i < 0) return '';
  const prev = flat[i - 1];
  const next = flat[i + 1];
  return `<div class="lnav">
    ${prev ? `<a class="btn ghost" href="?lesson=${prev.id}">← ${pickText(prev.title)}</a>` : '<span></span>'}
    ${next ? `<a class="btn" href="?lesson=${next.id}">${pickText(next.title)} →</a>` : '<span></span>'}
  </div>`;
}

/* --------------------------------------------------------------------- quiz */

async function renderQuiz(quizId) {
  root.innerHTML = `<p class="muted">Loading quiz…</p>`;
  let data;
  try {
    const res = await fetch(`/api/v1/quizzes/${quizId}/present`, { headers: { Accept: 'application/json' } });
    if (res.status === 401) { window.location.href = '/login'; return; }
    if (!res.ok) throw new Error('unavailable');
    data = await res.json();
  } catch {
    root.innerHTML = solo(backLink() + `<div class="err">This quiz isn't available.</div>`);
    return;
  }
  if (data.csrfToken) { STATE.csrf = data.csrfToken; setCsrfMeta(data.csrfToken); }

  const questions = data.questions || [];
  const body = questions.map((q, i) => renderQuestion(q, i)).join('');
  root.innerHTML = solo(backLink() +
    `<h1>${pickText(data.title)}</h1>
     <div id="quiz-questions">${body || '<p class="muted">This quiz has no questions.</p>'}</div>
     <div class="card"><button class="btn" id="quiz-submit">Submit answers</button>
       <span id="quiz-msg" class="muted" style="margin-left:10px"></span></div>`);

  document.getElementById('quiz-submit').addEventListener('click', () => submitQuiz(quizId, questions));
}

function renderQuestion(q, i) {
  const prompt = `<div class="q-prompt"><span class="q-num">${i + 1}.</span> ${pickRaw(q.prompt)} <span class="muted">(${q.points} pt${q.points === 1 ? '' : 's'})</span></div>`;
  let field = '';

  if (q.type === 'mcq' || q.type === 'multi') {
    const input = q.type === 'mcq' ? 'radio' : 'checkbox';
    field = (q.options || []).map((o) =>
      `<label class="q-opt"><input type="${input}" name="q_${q.id}" value="${o.id}"> ${pickText(o.text)}</label>`
    ).join('');
  } else if (q.type === 'matching') {
    field = (q.lefts || []).map((l) =>
      `<div class="q-match"><span class="q-left">${escapeHtml(l)}</span>
        <select data-match="${escapeAttr(l)}" name="q_${q.id}">
          <option value="">—</option>
          ${(q.rights || []).map((r) => `<option value="${escapeAttr(r)}">${escapeHtml(r)}</option>`).join('')}
        </select></div>`
    ).join('');
  } else if (q.type === 'numeric') {
    field = `<input class="q-text" type="number" step="any" name="q_${q.id}">`;
  } else if (q.type === 'essay') {
    field = `<textarea class="q-text" name="q_${q.id}" rows="5" placeholder="Your answer"></textarea>`;
  } else {
    // short / cloze
    field = `<input class="q-text" type="text" name="q_${q.id}" placeholder="Your answer">`;
  }

  return `<div class="card q-block" data-qid="${q.id}" data-qtype="${q.type}">${prompt}<div class="q-field">${field}</div></div>`;
}

// Gather each question's response in the shape submit() expects, then POST.
async function submitQuiz(quizId, questions) {
  const responses = {};
  for (const q of questions) {
    const block = root.querySelector(`.q-block[data-qid="${q.id}"]`);
    if (!block) continue;
    if (q.type === 'mcq') {
      const sel = block.querySelector('input:checked');
      responses[q.id] = sel ? sel.value : '';
    } else if (q.type === 'multi') {
      responses[q.id] = [...block.querySelectorAll('input:checked')].map((el) => el.value);
    } else if (q.type === 'matching') {
      const map = {};
      block.querySelectorAll('select[data-match]').forEach((s) => { if (s.value) map[s.dataset.match] = s.value; });
      responses[q.id] = map;
    } else if (q.type === 'numeric') {
      const v = block.querySelector('input').value;
      responses[q.id] = v === '' ? '' : Number(v);
    } else {
      responses[q.id] = block.querySelector('input, textarea').value;
    }
  }

  const btn = document.getElementById('quiz-submit');
  const msg = document.getElementById('quiz-msg');
  btn.disabled = true;
  msg.textContent = 'Submitting…';
  try {
    const res = await fetch(`/api/v1/quizzes/${quizId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...csrfHeader() },
      body: JSON.stringify({ responses }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.message || 'Could not submit');
    }
    const { attempt } = await res.json();
    STATE.loaded = false;
    renderQuizResult(attempt);
  } catch (e) {
    btn.disabled = false;
    msg.textContent = e.message;
  }
}

function renderQuizResult(attempt) {
  const pct = attempt.maxScore ? Math.round((attempt.autoScore / attempt.maxScore) * 100) : 0;
  const manual = attempt.needsManualMarking
    ? `<p class="muted">Some answers (written responses) will be marked by an assessor — this score is provisional.</p>`
    : '';
  root.innerHTML = solo(backLink() + `
    <div class="card">
      <h1 style="margin-top:0">Submitted</h1>
      <p style="font-size:22px;margin:6px 0"><strong>${attempt.autoScore} / ${attempt.maxScore}</strong> <span class="muted">(${pct}%)</span></p>
      ${manual}
      <a class="btn ghost" href="/app/" style="margin-top:8px">Back to your learning</a>
    </div>`);
}

/* ------------------------------------------------------------------- lesson */

async function renderLesson(lessonId) {
  if (!STATE.loaded) { try { await loadLearning(); } catch { /* offline handled below */ } }
  const course = courseOfLesson(lessonId);
  const side = course ? sideOutline(course, lessonId) : sideCourseList(STATE.courses || [], null);

  root.innerHTML = shell(side, `<p class="muted">Loading lesson…</p>`);
  wireShell();
  const pane = document.getElementById('pane');

  let data;
  try {
    const res = await fetch(`/api/v1/lessons/${lessonId}/view`, { headers: { Accept: 'application/json' } });
    if (res.status === 401) { window.location.href = '/login'; return; }
    data = await res.json();
  } catch {
    const pack = await window.lintelPacks.get(lessonId);
    if (pack) return renderPack(pack);
    pane.innerHTML = `<div class="err">You are offline and this lesson is not saved for offline use.</div>`;
    return;
  }

  if (data.csrfToken) { STATE.csrf = data.csrfToken; setCsrfMeta(data.csrfToken); }

  if (data.held) {
    pane.innerHTML = `
      <h1>${pickText(data.lesson.title)}</h1>
      <div class="held" role="status" aria-live="polite"><blockquote>${escapeHtml(data.message)}</blockquote></div>
      <p class="muted" style="margin-top:14px">This teaching is held. When your standing is attested, it will open here.</p>
      ${lessonNav(course, lessonId)}`;
    return;
  }

  pane.innerHTML = `<h1>${pickText(data.lesson.title)}</h1><div id="blocks"></div><div id="lnav"></div>`;
  const container = document.getElementById('blocks');
  for (const block of data.blocks) container.appendChild(renderBlock(block, lessonId));
  if (data.enrollmentId) container.appendChild(completeControl(lessonId, data.enrollmentId));
  document.getElementById('lnav').innerHTML = lessonNav(course, lessonId);
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
      STATE.loaded = false;          // progress changed — refetch the outline next view
      markOutlineComplete(lessonId); // reflect it instantly in the sidebar
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Try again';
    }
  });
  return wrap;
}

// Tick the current lesson in the cached outline and in the live sidebar, so the
// checkmark appears immediately without waiting for the next fetch.
function markOutlineComplete(lessonId) {
  for (const c of STATE.courses || []) {
    for (const m of c.modules || []) {
      const l = (m.lessons || []).find((x) => String(x.id) === String(lessonId));
      if (l) l.progress = 'complete';
    }
  }
  const active = document.querySelector('.o-item.active .o-dot, .o-item.active .o-check');
  if (active) active.outerHTML = '<span class="o-check" aria-label="complete">✓</span>';
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

  if (block.embed) {
    const e = block.embed;
    if (e.kind === 'youtube' || e.kind === 'vimeo') {
      el.innerHTML = `<div class="player embed"><iframe src="${escapeHtml(e.src)}" title="Lesson video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>`;
    } else if (e.kind === 'video') {
      el.innerHTML = `<div class="player video"><video controls preload="metadata" playsinline src="${escapeHtml(e.src)}"></video></div>`;
    } else if (e.kind === 'audio') {
      el.innerHTML = `<div class="player audio"><audio controls preload="metadata" src="${escapeHtml(e.src)}"></audio></div>`;
    } else {
      el.innerHTML = `<a class="btn" href="${escapeHtml(e.url)}" target="_blank" rel="noopener noreferrer">Open resource ↗</a>`;
    }
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
  root.innerHTML = solo(backLink() + `<h1>${pickText(pack.title)}</h1><p class="offline-ok">Saved offline</p><div id="blocks"></div>`);
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
  if (!saved.length) { root.innerHTML = solo(html + `<p class="muted">Nothing is saved offline yet.</p>`); return; }
  html += saved.map((s) => `<div class="card"><a href="?lesson=${s.lessonId}">${escapeHtml(STATE.lessonTitles[s.lessonId] || 'Saved lesson')}</a></div>`).join('');
  root.innerHTML = solo(html);
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

/* ------------------------------------------------------------------- router */

function currentView() {
  const params = new URLSearchParams(location.search);
  const lesson = params.get('lesson');
  const quiz = params.get('quiz');
  const course = params.get('course');
  if (lesson) return () => renderLesson(lesson);
  if (quiz) return () => renderQuiz(quiz);
  if (course) return () => renderCourse(course);
  return renderHome;
}

async function route() {
  window.scrollTo(0, 0);
  document.body.classList.remove('has-shell'); // shell views re-add via wireShell
  await currentView()();
}

function navigate(href) {
  document.body.classList.remove('nav-open');
  history.pushState({}, '', href);
  route();
}

// Instant in-app navigation: intercept clicks on /app/ links (home + ?course /
// ?lesson / ?quiz) and swap views via the History API. Anything else — /apply,
// /login, external links, downloads, new-tab, modified clicks — loads normally.
function wireRouter() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a');
    if (!a) return;
    const raw = a.getAttribute('href');
    if (!raw || raw.startsWith('#') || a.target === '_blank' || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === '/app/' || url.pathname === '/app/index.html') {
      e.preventDefault();
      navigate(url.pathname + url.search);
    }
  });
  window.addEventListener('popstate', route);
}


boot();
