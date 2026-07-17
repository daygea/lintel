/**
 * Offline lesson packs.
 *
 * A downloadable lesson is stored in IndexedDB so it plays with no network — the
 * design case is a learner on 3G who downloads at home and studies where there is
 * no signal. Only lessons the SERVER says are offline-cacheable may be stored;
 * the client never decides this. A restricted lesson that reached this code by
 * mistake is refused here as a second line of defence.
 */

const DB = 'lintel-packs';
const STORE = 'lessons';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'lessonId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const result = fn(store);
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

/**
 * Download a lesson for offline use. The server's /pack endpoint returns the
 * lesson only if its content policy permits caching; if it refuses, we do too.
 */
async function download(lessonId) {
  const res = await fetch(`/api/v1/lessons/${lessonId}/pack`, { headers: json() });
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || 'This lesson may not be saved for offline use.');
  }
  if (!res.ok) throw new Error(`Could not fetch the lesson (${res.status})`);

  const pack = await res.json();

  // Second line of defence: never store something not marked cacheable, even if
  // the server sent it. Belt and braces, because the failure mode is a restricted
  // recording sitting on a stranger's phone.
  if (!pack.offlineCacheable) {
    throw new Error('This lesson is stream-only and cannot be stored.');
  }

  await tx('readwrite', (store) => store.put({ lessonId, pack, savedAt: Date.now() }));
  return pack;
}

const get = (lessonId) => tx('readonly', (store) => store.get(lessonId)).then((r) => r?.pack || null);
const list = () =>
  tx('readonly', (store) => store.getAll()).then((rows) => (rows || []).map((r) => ({ lessonId: r.lessonId, savedAt: r.savedAt })));
const remove = (lessonId) => tx('readwrite', (store) => store.delete(lessonId));

function json() {
  const token = document.querySelector('meta[name="csrf-token"]')?.content;
  return token ? { 'x-csrf-token': token } : {};
}

window.lintelPacks = { download, get, list, remove };
