/* OMNI-PERFORM service worker — installability + offline SHELL only.
 * DESIGN RULE (non-negotiable): NETWORK-FIRST. A voice app that deploys many times a day must
 * never serve a stale build — the cache is a fallback for OFFLINE only, never a source of truth.
 * It only ever touches same-origin GET navigations/assets; the API + WebSocket (onrender.com,
 * cross-origin) are never intercepted, so live audio/interview traffic is untouched. */
const CACHE = 'omni-shell-v4';
const META_CACHE = 'omni-reminder-state-v1';
const META_KEY = '/__omni_reminder_state__';
const SHELL = ['/', '/index.html', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE && k !== META_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// The page sends only small, non-sensitive progress counters. Cache Storage makes the state
// available to a payload-less push even when every app window is closed.
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'REMINDER_STATE') return;
  const raw = e.data.state || {};
  const state = {
    streak: Math.max(0, Math.min(999, Number(raw.streak) || 0)),
    shield: !!raw.shield,
    trainedToday: !!raw.trainedToday,
    sessionsToNext: Math.max(0, Math.min(99, Number(raw.sessionsToNext) || 0)),
    nextLabel: String(raw.nextLabel || '').slice(0, 40),
  };
  e.waitUntil(caches.open(META_CACHE).then((c) => c.put(META_KEY,
    new Response(JSON.stringify(state), { headers: { 'Content-Type': 'application/json' } }))));
});

async function reminderState() {
  try {
    const r = await caches.match(META_KEY);
    return r ? await r.json() : {};
  } catch { return {}; }
}

function reminderBody(s) {
  if (s.shield && !s.trainedToday) return 'Dein Schutz ist aktiv. Fünf Minuten heute halten deinen Rhythmus stabil.';
  if (s.streak >= 3) return `${s.streak} Tage aufgebaut. Fünf Minuten in der Arena schützen deine Serie.`;
  if (s.sessionsToNext > 0 && s.sessionsToNext <= 2 && s.nextLabel) {
    return `Noch ${s.sessionsToNext} ${s.sessionsToNext === 1 ? 'Sitzung' : 'Sitzungen'} bis ${s.nextLabel}. Deine kurze Runde ist bereit.`;
  }
  const pool = [
    'Deine kurze Deutsch-Runde ist bereit — fünf Minuten, ein konkreter Fortschritt.',
    'Salma hat deine nächste Übung bereitgelegt. Fünf Minuten reichen für heute.',
    'Zurück in die Arena: eine kurze Runde für dein nächstes Interview.',
  ];
  return pool[Math.floor(Date.now() / 86400000) % pool.length];
}

// ── Web Push: state-aware daily practice reminder (still payload-less and $0) ──
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    const state = await reminderState();
    await self.registration.showNotification('Die Arena · Salma', {
      body: reminderBody(state), icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
      tag: 'daily-reminder', renotify: true, data: { url: '/?daily=1' },
    });
  })());
});
// Tapping the notification focuses an open tab or opens the app.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const requested = typeof e.notification?.data?.url === 'string' ? e.notification.data.url : '/';
    const target = /^\/(?!\/)[^\s]*$/u.test(requested) ? requested : '/';
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) { await c.navigate?.(target); return c.focus(); } }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Only same-origin GETs. Everything else (API, WebSocket upgrade, POST) passes straight through.
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  // Reset tokens, media tickets, referrals and campaign tags live in the query string.
  // Never persist or replay a query-bearing request from Cache Storage.
  if (url.search) {
    e.respondWith(fetch(req).catch(async () => {
      if (req.mode === 'navigate') {
        const shell = await caches.match('/index.html');
        if (shell) return shell;
      }
      return new Response('', { status: 504, statusText: 'offline' });
    }));
    return;
  }

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
