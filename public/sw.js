/**
 * Lintel learner service worker.
 *
 * THE BUILD VERSION MUST BE BUMPED ON EVERY DEPLOY. This is the lesson carried
 * over from Orírùn at real cost: a stale service worker will serve old code and
 * convince you the deploy failed. The version string is the cache name; changing
 * it orphans the old caches, which activate() then deletes.
 *
 * Caching policy, deliberately split:
 *   - The app shell (HTML/CSS/JS) is cache-first, so the app opens offline.
 *   - API calls are network-first, because a learner's standing can change and a
 *     stale "you may access this" is a correctness bug, not a speed one.
 *   - Lesson MEDIA is never cached here. Downloadable lessons are stored
 *     explicitly in IndexedDB by pack.js, honouring offlineCacheable. Restricted
 *     media is streamed and must never touch a cache — see fetch handler.
 */

const BUILD = 'lintel-v0.13.0'; // ← bump on every deploy
const SHELL_CACHE = `${BUILD}-shell`;

const SHELL = [
  '/app/',
  '/app/index.html',
  '/app/app.js',
  '/app/app.css',
  '/app/pack.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(BUILD)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache media or signed URLs. Restricted content must not be recoverable
  // from a cache; downloadable content is handled by IndexedDB, not here.
  if (
    url.pathname.includes('/playback') ||
    url.hostname.endsWith('r2.cloudflarestorage.com') ||
    url.hostname.includes('archive')
  ) {
    return; // let it hit the network untouched
  }

  // API: network-first, fall back to nothing (an eligibility answer must be live).
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request).catch(() => new Response(null, { status: 503 })));
    return;
  }

  // Shell: cache-first so the app opens with no network.
  if (SHELL.includes(url.pathname) || url.pathname === '/app/') {
    event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
    return;
  }
});

/* ------------------------------------------------------------------ Web Push */

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Lintel', body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Lintel', {
      body: payload.body || '',
      tag: payload.tag,
      data: { url: payload.url || '/app/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/app/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes('/app/') && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
