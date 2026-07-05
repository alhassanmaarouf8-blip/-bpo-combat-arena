/* OMNI-PERFORM service worker — installability + offline SHELL only.
 * DESIGN RULE (non-negotiable): NETWORK-FIRST. A voice app that deploys many times a day must
 * never serve a stale build — the cache is a fallback for OFFLINE only, never a source of truth.
 * It only ever touches same-origin GET navigations/assets; the API + WebSocket (onrender.com,
 * cross-origin) are never intercepted, so live audio/interview traffic is untouched. */
const CACHE = 'omni-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Only same-origin GETs. Everything else (API, WebSocket upgrade, POST) passes straight through.
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    try {
      // NETWORK FIRST — always try the freshest build.
      const fresh = await fetch(req);
      if (fresh && fresh.ok && fresh.type === 'basic') {
        const copy = fresh.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return fresh;
    } catch {
      // Offline only: serve the last good copy; for a navigation, fall back to the app shell.
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await caches.match('/index.html');
        if (shell) return shell;
      }
      return new Response('', { status: 504, statusText: 'offline' });
    }
  })());
});
