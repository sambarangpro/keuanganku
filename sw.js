const CACHE_NAME = 'keuanganku-pwa-v3.9';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './poster-panduan-penggunaan.html',
  './panduan-pengguna.html',
  './manifest.json',
  './favicon.ico',
  './icon-48.png',
  './icon-96.png',
  './icon-128.png',
  './icon-192.png',
  './icon-512.png',
  './icon.svg',
  './logo.png'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(() => {});
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event (Network First Strategy for fresh financial data)
self.addEventListener('fetch', (event) => {
  // Hanya tangani request HTTP/HTTPS GET
  if (event.request.method !== 'GET') return;

  // Jangan tangani Google Script Web App agar data cloud selalu live
  if (event.request.url.includes('script.google.com')) return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Update cache dengan respon terbaru jika valid
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Jika offline, ambil dari cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.headers.get('accept').includes('text/html')) {
            return caches.match('./index.html');
          }
        });
      })
  );
});
