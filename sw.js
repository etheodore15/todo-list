const CACHE = 'idea-todo-v63';
const LIB_CACHE = 'idea-todo-libs-v1';
const ASSETS = [
  './app.html',
  './manifest.webmanifest',
  './ai-worker.js',
  './digest.js',
  './managed-config.js',
  './icons.css',
  './dashboard.html',
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
      .catch(() => caches.match(e.request).then(m => m || caches.match('./app.html')))
  );
});

// ---------- daily digest (Periodic Background Sync) ----------
importScripts('./digest.js');

function idbOp(mode, fn){
  return new Promise((resolve) => {
    const req = indexedDB.open('itodo-sw', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', mode);
      const r = fn(tx.objectStore('kv'));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    };
  });
}
const idbGet = (k) => idbOp('readonly', (st) => st.get(k));
const idbSet = (k, v) => idbOp('readwrite', (st) => st.put(v, k));

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'config') idbSet('cfg', e.data.cfg);
});

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'daily-digest') e.waitUntil(runDigest());
});

async function runDigest(){
  try {
    const cfg = await idbGet('cfg');
    if (!cfg) return;
    const since = (await idbGet('digestAt')) || (Date.now() - 86400000);
    const today = new Date().toISOString().slice(0, 10);
    let items = null;
    // Managed spaces: the SW can't authenticate, so use the page-provided
    // snapshot. Self-hosted with open rules: fetch live via REST.
    if (cfg.managed && Array.isArray(cfg.snapshot)){
      items = cfg.snapshot;
    } else if (cfg.hid && cfg.projectId){
      const url = 'https://firestore.googleapis.com/v1/projects/' + cfg.projectId +
        '/databases/(default)/documents/households/' + cfg.hid + '/items?pageSize=300&key=' + cfg.apiKey;
      const res = await fetch(url);
      if (!res.ok){ if (Array.isArray(cfg.snapshot)) items = cfg.snapshot; else return; }
      else items = ((await res.json()).documents || []).map(parseFsDoc);
    } else if (Array.isArray(cfg.snapshot)){
      items = cfg.snapshot;
    }
    if (!items) return;
    const d = composeDigest(items, cfg.me, since, today);
    await idbSet('digestAt', Date.now());
    if (d.openToday || d.dueTomorrow || d.news.length || d.ticks.length){
      await self.registration.showNotification(d.title,
        {body: d.body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'daily-digest'});
    }
  } catch (_) {}
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({type: 'window', includeUncontrolled: true}).then(ws => {
    for (const w of ws){ if ('focus' in w) return w.focus(); }
    return clients.openWindow('./');
  }));
});
