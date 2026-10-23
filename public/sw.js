// Minimal service worker: makes the app installable and shows request alerts.
// Orders are never cached; only the app shell is kept for a quick start when offline.
const SHELL = 'saint-cakes-shell-v1';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== SHELL).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Same-origin GETs only; Supabase and other APIs always go to the network.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      if (response.ok) void caches.open(SHELL).then(cache => cache.put('/', copy));
      return response;
    }).catch(() => caches.match('/')));
    return;
  }
  // Hashed build assets never change, so serve them from cache once fetched.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      const copy = response.clone();
      if (response.ok) void caches.open(SHELL).then(cache => cache.put(request, copy));
      return response;
    })));
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const open = windows.find(client => new URL(client.url).pathname !== '/pedido');
    return open ? open.focus() : self.clients.openWindow('/');
  }));
});
