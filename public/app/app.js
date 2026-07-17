/**
 * The learner PWA. Deliberately small and framework-free — it must open on a
 * cheap Android phone over 3G, and every kilobyte is weight a learner pays for.
 *
 * It talks only to the JSON API. It renders a held teaching as the institution's
 * own words, never as an error. It burns the watermark into playback. It never
 * decides eligibility itself — the server does, and this only draws the result.
 */

const root = document.getElementById('root');

async function boot() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('/sw.js'); } catch {}
  }

  // A real app would route; for this shell, read ?lesson= to preview one lesson.
  const lessonId = new URLSearchParams(location.search).get('lesson');
  if (lessonId) return renderLesson(lessonId);

  root.innerHTML = `
    <h1>Your learning</h1>
    <p class="muted">Open a lesson with <code>?lesson=&lt;id&gt;</code> to preview it.</p>
    <div id="offline"></div>`;
  renderOfflineList();
}

async function renderLesson(lessonId) {
  root.innerHTML = `<p class="muted">Loading lesson…</p>`;
  let data;
  try {
    // Try the network first; fall back to an offline pack if we have one.
    const res = await fetch(`/api/v1/lessons/${lessonId}/view`, { headers: { Accept: 'application/json' } });
    data = await res.json();
  } catch {
    const pack = await window.lintelPacks.get(lessonId);
    if (pack) return renderPack(pack);
    root.innerHTML = `<div class="err">You are offline and this lesson is not saved for offline use.</div>`;
    return;
  }

  if (data.held) {
    root.innerHTML = `
      <div class="held">
        <blockquote>${escapeHtml(data.message)}</blockquote>
      </div>
      <p class="muted" style="margin-top:14px">This teaching is held. When your standing is attested, it will open here.</p>`;
    return;
  }

  root.innerHTML = `<h1>${pickTitle(data.lesson.title)}</h1><div id="blocks"></div>`;
  const container = document.getElementById('blocks');
  for (const block of data.blocks) container.appendChild(renderBlock(block, lessonId));
}

function renderBlock(block, lessonId) {
  const el = document.createElement('div');
  el.className = 'card';

  if (block.unavailable) {
    el.innerHTML = `<p class="muted">${escapeHtml(block.reason || 'This content is unavailable.')}</p>`;
    return el;
  }

  if (block.type === 'rich_text') {
    el.innerHTML = pickTitle(block.body);
    return el;
  }

  if (block.streamUrl) {
    const isVideo = block.type === 'video' || block.streamOnly;
    const media = isVideo
      ? `<div class="player"><video controls controlsList="nodownload" src="${block.streamUrl}"></video>${block.watermark ? `<span class="watermark">${escapeHtml(block.watermark)}</span>` : ''}</div>`
      : `<div class="player"><audio controls controlsList="nodownload" src="${block.streamUrl}"></audio>${block.watermark ? `<span class="watermark">${escapeHtml(block.watermark)}</span>` : ''}</div>`;

    const labels = (block.tkLabels || []).map((l) => `<span class="tk">${escapeHtml(l)}</span>`).join('');
    const save = block.downloadable
      ? `<button class="btn ghost" data-save="${lessonId}" style="margin-top:10px">Save for offline</button>`
      : `<p class="muted" style="margin-top:8px">Streaming only — cannot be saved.</p>`;

    el.innerHTML = media + (labels ? `<div style="margin-top:8px">${labels}</div>` : '') + save;

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
  root.innerHTML = `<h1>${pickTitle(pack.title)}</h1><p class="offline-ok">Saved offline</p><div id="blocks"></div>`;
  const c = document.getElementById('blocks');
  for (const b of pack.blocks) {
    const el = document.createElement('div');
    el.className = 'card';
    if (b.type === 'rich_text') el.innerHTML = pickTitle(b.body);
    else if (b.downloadUrl) el.innerHTML = `<audio controls src="${b.downloadUrl}"></audio>`;
    c.appendChild(el);
  }
}

async function renderOfflineList() {
  const saved = await window.lintelPacks.list();
  const el = document.getElementById('offline');
  if (!saved.length) { el.innerHTML = `<p class="muted">No lessons saved offline.</p>`; return; }
  el.innerHTML = `<h2 style="font-size:15px">Saved offline</h2>` +
    saved.map((s) => `<div class="card"><a href="?lesson=${s.lessonId}">Lesson ${s.lessonId}</a></div>`).join('');
}

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

function pickTitle(map) {
  if (!map) return '';
  if (typeof map === 'string') return escapeHtml(map);
  return escapeHtml(map.en || Object.values(map)[0] || '');
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

boot();
