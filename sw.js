const CACHE_NAME = 'hms-shell-v88';
const SHELL_ASSETS = [
  './',
  './index.html',
  './user.html',
  './admin.html',
  './confirmed.html',
  './varsling.html',
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
  // app unstyled after a bad or superseded deploy.
  if (request.mode === 'navigate' ||
      ['document', 'style', 'script', 'worker'].includes(request.destination)) {
    event.respondWith(networkFirst(request));
  }
});

// Web push: payload is JSON { title, body, url } sent by the send-push edge
// function. Clicking the notification focuses an open app tab or opens one.
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title || 'HMS', {
    body: data.body || '',
    data: { url: data.url || './user.html' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './user.html', self.registration.scope).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
          c.navigate(target).catch(() => {});
          return c.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
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
