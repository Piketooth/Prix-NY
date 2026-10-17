'use strict';

const CACHE = 'prix-ny-v6';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'taxes.json',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/mark-128.png',
  'fonts/darker-grotesque-latin-500-normal.woff2',
  'fonts/darker-grotesque-latin-600-normal.woff2',
  'fonts/darker-grotesque-latin-700-normal.woff2',
  'fonts/darker-grotesque-latin-800-normal.woff2',
  'fonts/darker-grotesque-latin-900-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Réseau d'abord pour les fichiers de l'appli (les mises à jour arrivent tout de suite),
// cache en secours hors ligne. Les requêtes externes (taux, OCR) ne passent pas par ici.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
