const CACHE_NAME = 'keuanganku-pwa-v2.0';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './pesan.html',
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

// Message Event (Menerima perintah update dari aplikasi)
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});

// Notification Click Event (Buka/fokus ke aplikasi saat notifikasi ditekan)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('./index.html');
      }
    })
  );
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

// Fetch Event (Stale-While-Revalidate untuk Startup Cepat 0ms, Google Script tetap Live)
self.addEventListener('fetch', (event) => {
  // Hanya tangani request HTTP/HTTPS GET
  if (event.request.method !== 'GET') return;

  // Jangan tangani Google Script Web App agar data cloud selalu live
  if (event.request.url.includes('script.google.com')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      // Startup instan tanpa mentok: utamakan cache jika ada, perbarui di latar belakang
      return cachedResponse || fetchPromise;
    })
  );
});
