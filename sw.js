const CACHE_NAME = 'hms-shell-v43';
const SHELL_ASSETS = [
  './',
  './index.html',
  './user.html',
  './admin.html',
  './confirmed.html',
  './styles.css',
  './config.js',
  './courses.js',
  './app-shell.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;

  // Network-first for HTML *and* CSS/JS: an online user always gets the freshly
  // deployed asset, and the cache is only a fallback when offline. This is what
  // prevents a stale/poisoned styles.css from getting "stuck" and rendering the
  // app unstyled after a bad or superseded deploy. cacheFirst kept only for
  // anything else we might cache later.
  if (request.mode === 'navigate' ||
      ['document', 'style', 'script', 'worker'].includes(request.destination)) {
    event.respondWith(networkFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    // Only cache genuinely good responses — never poison the cache with a 404
    // page or an error, which is how the app ended up unstyled before.
    if (fresh && fresh.ok && fresh.type === 'basic') cache.put(request, fresh.clone()).catch(() => {});
    return fresh;
  } catch (_) {
    const isDoc = request.mode === 'navigate' || request.destination === 'document';
    return (await cache.match(request)) || (isDoc ? cache.match('./index.html') : Response.error());
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok && fresh.type === 'basic') cache.put(request, fresh.clone()).catch(() => {});
  return fresh;
}
