const DEV_CACHE_NAME = 'keuanganku-dev-portal-v2.8';
const DEV_ASSETS = [
  './dev-dashboard.html',
  './dev-manifest.json',
  './dev-favicon.ico',
  './dev-icon-48.png',
  './dev-icon-96.png',
  './dev-icon-128.png',
  './dev-icon-192.png',
  './dev-icon-512.png',
  './dev-icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(DEV_CACHE_NAME).then((cache) => {
      return cache.addAll(DEV_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== DEV_CACHE_NAME && key.includes('dev-portal')) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Always fetch fresh data for Google Apps Script API
  if (event.request.url.includes('script.google.com')) return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(DEV_CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
