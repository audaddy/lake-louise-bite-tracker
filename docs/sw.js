/* Lake Louise Bite Tracker — service worker (offline app shell + last data) */
const CACHE = 'llbt-v2';

// Same-origin shell files (must all succeed).
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
];

// Cross-origin libraries (cached best-effort; opaque responses are fine).
const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/suncalc/1.9.0/suncalc.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    await Promise.all(CDN.map(async (u) => {
      try { await c.put(u, await fetch(u, { mode: 'no-cors' })); } catch (_) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Live weather + AI Worker + map tiles: always go to the network, never cache.
  if (url.hostname.includes('open-meteo.com') || url.hostname.includes('workers.dev') || url.hostname.includes('arcgisonline.com')) return;

  // Data JSON: network-first so the score is fresh, fall back to cache offline.
  if (url.origin === location.origin && url.pathname.includes('/data/')) {
    event.respondWith(
      fetch(req).then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return r;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // App shell + libraries: cache-first, refresh in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((r) => {
        if (r && (r.ok || r.type === 'opaque')) {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return r;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
