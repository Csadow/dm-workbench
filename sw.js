// Bump when any shell file changes. A new worker waits until all old tabs close.
const CACHE = 'dm-workbench-v4';
const FILES = ['./', './index.html', './app/main.js', './app/bestiary.js', './app/assistant.js', './assets/srd-monsters.json', './app/ui.js', './app/screens.js', './app/audio.js', './app/domain.js', './app/storage.js', './app/backup.js', './app/styles.css', './assets/icon.svg', './manifest.webmanifest'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('dm-workbench-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if (new URL(event.request.url).pathname.startsWith('/api/')) return;
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    if (event.request.mode === 'navigate') return cache.match('./index.html');
    return fetch(event.request);
  })());
});
