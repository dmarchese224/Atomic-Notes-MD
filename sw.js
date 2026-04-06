const CACHE_NAME = 'atomic-notes-md-v1';
const ASSETS = [
  './', './index.html', './style.css', './app.js', './manifest.json',
  './assets/favicon.ico', './assets/atomic-notes-md.svg', './assets/icon-180.png', './assets/icon-192.png', './assets/icon-512.png'
];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))));
self.addEventListener('fetch', e => e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))));
