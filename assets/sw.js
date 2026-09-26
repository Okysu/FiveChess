/*
 * 命阙 service worker: repeat visits load art and audio from the local cache.
 * Images / audio / atlas sheets: stale-while-revalidate (instant from cache, refreshed in the background, so changed
 * art shows up on the next visit). Index files (manifest, audio.json, avif.json, atlas index, credits) and the app
 * shell always go to the network first. Only same-origin GET requests are handled.
 */
const CACHE = 'mingque-assets-v1';
const MEDIA = /\.(webp|avif|png|jpg|ogg|mp3|wav|ttf|woff2?)$/i;
const INDEX = /(manifest|audio|avif|credits|index)\.json$/i;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('mingque-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isMedia = MEDIA.test(url.pathname) || (url.pathname.includes('/atlas/') && url.pathname.endsWith('.json') && !INDEX.test(url.pathname));
  if (!isMedia) return; // app shell, scripts and index files: browser default (network, HTTP cache headers)
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req);
    const refresh = fetch(req).then((res) => { if (res.ok && res.status === 200) void cache.put(req, res.clone()); return res; }).catch(() => hit);
    if (hit) { e.waitUntil(refresh); return hit; }
    return refresh;
  }));
});
