// Offline shell: app files are cached; the budget data itself always comes from GitHub
// (the app keeps its own encrypted copy for offline viewing).
const CACHE = 'coinmaster-1.0.4';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'engine.js', 'crypto.js', 'github.js', 'ui.js', 'charts.js',
  'txn-ui.js', 'view-budget.js', 'view-update.js', 'view-activity.js', 'view-settings.js', 'view-setup.js', 'xlsx-lite.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  // 'reload' skips the browser's HTTP cache, so a new version never caches old files
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/data/')) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => cached);
    return cached || fresh;
  }));
});
