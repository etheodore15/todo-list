const CACHE = 'idea-todo-v11';
const LIB_CACHE = 'idea-todo-libs-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './ai-worker.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== LIB_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for the app shell (so updates land), cache fallback for offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // API calls + model downloads pass through untouched
  // Cache-first for the vendored AI runtime (large, immutable files).
  if (url.pathname.includes('/vendor/')){
    e.respondWith(
      caches.match(e.request).then(m => m || fetch(e.request).then(res => {
        if (res.ok){
          const copy = res.clone();
          caches.open(LIB_CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }))
    );
    return;
  }
  e.respondWith(
    // no-cache: revalidate with the server instead of trusting the HTTP cache
    // (GitHub Pages serves max-age=600, which delayed updates by up to 10 min)
    fetch(e.request, {cache: 'no-cache'})
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(m => m || caches.match('./index.html')))
  );
});
