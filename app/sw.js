// ── SERVICE WORKER (web build only) ───────────────────────────────────────────
// Lets the web version open and run offline once it has been loaded. The
// Android app does not use it (assets/ in the Android project has no sw.js).
//
// Do not deploy this file as it stands. py/build_web.py copies it into the
// build with the two marked lines below replaced by the real file list and a
// build id, so that the file changes whenever any app file changes: a changed
// sw.js is how the browser learns there is a new version. Unreplaced, the list
// is empty and the worker only caches things as they are used.
//
// How it behaves:
//   • install   – downloads every file in PRECACHE into a cache named for the
//                 build. Files unchanged since the previous build are copied
//                 from the old cache, not downloaded again. If a required file
//                 cannot be fetched the install fails and the old version
//                 keeps running; "optional" files (fonts, starter studies,
//                 icons) may fail without blocking it.
//   • no skipWaiting – a new build waits until every window of the app has
//                 closed, then takes over. Old and new files are never mixed
//                 in one session, and readers see no prompt.
//   • activate  – deletes caches of older builds.
//   • fetch     – same-origin GET requests only. Page loads get index.html
//                 (the app is one page). Code, strings and fonts come from the
//                 cache first; files used for the first time (other languages,
//                 other fonts, images) are cached as they arrive. Everything
//                 else, and everything on another site (Google Drive links),
//                 goes straight to the network.

const PRECACHE = [];   // __PRECACHE__  [{ url, hash, optional }]
const BUILD_ID = 'dev';   // __BUILD_ID__

const CODE_CACHE_PREFIX = 'bsr-code-';
const CODE_CACHE        = CODE_CACHE_PREFIX + BUILD_ID;   // versioned: code, strings
const ASSET_CACHE       = 'bsr-assets';                   // kept across builds: fonts, images
const MANIFEST_KEY      = '__bsr_manifest__';             // file hashes stored in each code cache
const SHELL_URL         = 'index.html';

// ── install ───────────────────────────────────────────────────────────────────

// url → hash for the newest earlier build's cache, with that cache, so that
// unchanged files can be copied forward.
async function _previousBuilds() {
  const out = [];
  for (const name of await caches.keys()) {
    if (!name.startsWith(CODE_CACHE_PREFIX) || name === CODE_CACHE) continue;
    const cache = await caches.open(name);
    const res = await cache.match(MANIFEST_KEY);
    if (!res) continue;
    try { out.push({ cache, hashes: await res.json() }); } catch (e) { /* unreadable: ignore */ }
  }
  return out;
}

async function _fetchOrCopy(file, cache, previous) {
  for (const { cache: old, hashes } of previous) {
    if (hashes[file.url] !== file.hash) continue;
    const kept = await old.match(file.url);
    if (kept) { await cache.put(file.url, kept); return; }
  }
  const res = await fetch(file.url, { cache: 'reload' });
  if (!res.ok) throw new Error(`${file.url}: HTTP ${res.status}`);
  await cache.put(file.url, res);
}

async function precache() {
  const cache = await caches.open(CODE_CACHE);
  const previous = await _previousBuilds();
  const results = await Promise.allSettled(PRECACHE.map(f => _fetchOrCopy(f, cache, previous)));
  const failed = PRECACHE.filter((f, i) => results[i].status === 'rejected');
  if (failed.some(f => !f.optional)) {
    await caches.delete(CODE_CACHE);
    throw new Error('precache failed: ' + failed.filter(f => !f.optional).map(f => f.url).join(', '));
  }
  const hashes = {};
  PRECACHE.forEach((f, i) => { if (results[i].status === 'fulfilled') hashes[f.url] = f.hash; });
  await cache.put(MANIFEST_KEY, new Response(JSON.stringify(hashes), { headers: { 'Content-Type': 'application/json' } }));
}

self.addEventListener('install', event => event.waitUntil(precache()));

// ── activate ──────────────────────────────────────────────────────────────────

async function removeOldBuilds() {
  for (const name of await caches.keys()) {
    if (name.startsWith(CODE_CACHE_PREFIX) && name !== CODE_CACHE) await caches.delete(name);
  }
}

self.addEventListener('activate', event => event.waitUntil(removeOldBuilds().then(() => self.clients.claim())));

// ── fetch ─────────────────────────────────────────────────────────────────────

// The one page of the app: the scope root or index.html.
function _isShellRequest(url) {
  const scope = new URL('./', self.location.href).pathname;
  return url.pathname === scope || url.pathname === scope + SHELL_URL;
}

async function _cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.status === 200) await cache.put(request, res.clone());
  return res;
}

// Cached copy now, refreshed in the background for next time.
async function _staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreSearch: true });
  const refresh = fetch(request).then(res => {
    if (res.ok && res.status === 200) cache.put(request, res.clone());
    return res;
  });
  if (hit) { refresh.catch(() => {}); return hit; }
  return refresh;
}

async function respond(request) {
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    if (!_isShellRequest(url)) return fetch(request);
    const shell = await (await caches.open(CODE_CACHE)).match(SHELL_URL);
    return shell || fetch(request);
  }

  const code = await (await caches.open(CODE_CACHE)).match(request, { ignoreSearch: true });
  if (code) return code;

  if (url.pathname.includes('/fonts/'))        return _cacheFirst(request, ASSET_CACHE);
  if (url.pathname.includes('/images/'))       return _staleWhileRevalidate(request, ASSET_CACHE);
  if (url.pathname.includes('/js/locales/'))   return _cacheFirst(request, CODE_CACHE);
  return fetch(request);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(respond(request));
});
