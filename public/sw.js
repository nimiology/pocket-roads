// Offline support. Pages are fetched network-first so a new deploy shows up at once; built
// assets (hashed file names) are cache-first; anything else is served from cache and refreshed.
// Only HTTP caches live here: saved progress such as the best score is in localStorage and is
// never touched by updates.
const CACHE = 'pocket-roads-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', 'site.webmanifest', 'logo.svg', 'logo.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('version.json')) return;
  const put = (res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  };
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(put).catch(() => caches.match(req).then((r) => r || caches.match('./'))));
  } else if (url.pathname.includes('/assets/')) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then(put)));
  } else {
    e.respondWith(caches.match(req).then((r) => {
      const net = fetch(req).then(put).catch(() => r);
      return r || net;
    }));
  }
});
