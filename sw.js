// Caches the app shell so it opens instantly and can show an offline screen.
// The fitness page itself is never cached. Bump CACHE_NAME when the shell changes.
const CACHE_NAME = 'fitness-app-v7';
const SHELL_FILES = ['./', './index.html', './styles.css', './app.js', './buddies.js'];
const PUSH_CACHE = 'fitness-push';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME && key !== PUSH_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function saveToCache(request, response) {
  const copy = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
}

// Network first, so updates show up right away. Falls back to the cache when offline.
function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      if (response.ok) saveToCache(request, response);
      return response;
    })
    .catch(() => caches.match(request, { ignoreSearch: true })
      .then((cached) => cached || caches.match('./index.html')));
}

// Icons and manifests rarely change, so serve them from the cache when possible.
function cacheFirst(request) {
  return caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    saveToCache(request, response);
    return response;
  }));
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only handle our own files. Requests to Google go straight to the network.
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;

  const isStatic = /\/(icons|manifests)\//.test(url.pathname);
  event.respondWith(isStatic ? cacheFirst(event.request) : networkFirst(event.request));
});

// Alarm notifications. The push has no data in it, so ask the page's alarm link
// what just went off. Every push must show something, so there is a fallback.
function alarmMessage() {
  const fallback = { title: '⏰ Fitness reminder', body: 'Open your page for details.', kind: '' };
  return caches.open(PUSH_CACHE)
    .then((cache) => cache.match('./push-config'))
    .then((response) => (response ? response.json() : null))
    .then((config) => {
      if (!config || !config.feed) return fallback;
      fallback.buddy = config.buddy;
      return fetch(config.feed + '&next=1', { cache: 'no-store' })
        .then((response) => response.json())
        .then((data) => (data && data.title ? Object.assign(data, { buddy: config.buddy }) : fallback));
    })
    .catch(() => fallback);
}

self.addEventListener('push', (event) => {
  event.waitUntil(alarmMessage().then((message) => self.registration.showNotification(message.title, {
    body: message.body,
    tag: 'fitness-alarm',
    renotify: true,
    requireInteraction: message.kind === 'wake',
    icon: 'icons/' + (/^[a-z]+$/.test(message.buddy || '') ? message.buddy : 'fox') + '-192.png',
    data: { kind: message.kind },
  })));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const kind = (event.notification.data && event.notification.data.kind) || '';
  const target = './' + (kind ? '?alarm=' + kind : '');
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    if (windows.length && !kind) return windows[0].focus();
    return self.clients.openWindow(target);
  }));
});
