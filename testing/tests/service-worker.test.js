/**
 * app/sw.js, the web build's service worker, run in a vm sandbox with a fake
 * Cache Storage, fake fetch and a recording `self`.
 *
 *  - install: caches the build's file list; a failed required file aborts the
 *    install; failed optional files do not; files unchanged since the previous
 *    build are copied across instead of downloaded.
 *  - activate: removes older builds, keeps the font/image cache, never
 *    skipWaiting (updates are silent and wait for the next launch).
 *  - fetch: same-origin GET only; page loads get the cached shell; code, fonts
 *    and strings are served from the cache; first-use files are cached as they
 *    arrive; everything else goes to the network.
 *
 * Paths are relative to testing/tests/ — source files are in ../../app/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SW_SRC = readFileSync(join(__dirname, '../../app/sw.js'), 'utf8');

const BASE = 'https://example.test/app/';

// ── fakes ────────────────────────────────────────────────────────────────────

function makeCaches() {
  const stores = new Map();
  const href = r => new URL(typeof r === 'string' ? r : r.url, BASE).href;
  const noSearch = h => { const u = new URL(h); u.search = ''; return u.href; };
  class FakeCache {
    constructor() { this.entries = new Map(); }
    async put(r, res) { this.entries.set(href(r), res.clone()); }
    async match(r, opts = {}) {
      const k = href(r);
      let hit = this.entries.get(k);
      if (!hit && opts.ignoreSearch) {
        for (const [kk, v] of this.entries) if (noSearch(kk) === noSearch(k)) { hit = v; break; }
      }
      return hit ? hit.clone() : undefined;
    }
    urls() { return [...this.entries.keys()].map(k => k.replace(BASE, '')); }
  }
  return {
    stores,
    open: async name => { if (!stores.has(name)) stores.set(name, new FakeCache()); return stores.get(name); },
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
  };
}

function loadSw({ precache = [], buildId = 'b1', caches = makeCaches(), fetchImpl } = {}) {
  let src = SW_SRC
    .replace(/^const PRECACHE = .*\/\/ __PRECACHE__.*$/m, `const PRECACHE = ${JSON.stringify(precache)};`)
    .replace(/^const BUILD_ID = .*\/\/ __BUILD_ID__.*$/m, `const BUILD_ID = '${buildId}';`);
  const listeners = {};
  const fetched = [];
  const calls = { claim: 0, skipWaiting: 0 };
  let impl = fetchImpl;
  const self_ = {
    location: { href: BASE + 'sw.js', origin: new URL(BASE).origin },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    clients: { claim: async () => { calls.claim++; } },
    skipWaiting: async () => { calls.skipWaiting++; },
  };
  const sandbox = {
    self: self_, caches, console, Response, URL, Promise,
    fetch: async (req, opts) => {
      const url = new URL(typeof req === 'string' ? req : req.url, BASE).href;
      fetched.push(url.replace(BASE, ''));
      if (impl) return impl(url, opts);
      return new Response('body of ' + url, { status: 200 });
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'sw.js' });
  return { sw: sandbox, listeners, fetched, caches, calls, setFetch: fn => { impl = fn; } };
}

async function runEvent(listeners, type) {
  const waits = [];
  listeners[type]({ waitUntil: p => waits.push(p) });
  await Promise.all(waits);
}

// Plain request object: Node cannot build a Request with mode "navigate".
const req = (path, { mode = 'cors', method = 'GET' } = {}) => ({ url: new URL(path, BASE).href, method, mode });

async function fetchEvent(listeners, request) {
  let responded;
  listeners.fetch({ request, respondWith: p => { responded = Promise.resolve(p); } });
  return responded === undefined ? { handled: false } : { handled: true, res: await responded };
}

const FILES = [
  { url: 'index.html', hash: 'h-index' },
  { url: 'css/a.css', hash: 'h-css' },
  { url: 'js/app.js', hash: 'h-js' },
  { url: 'fonts/Inter-Regular.ttf', hash: 'h-font', optional: true },
];

// ── install ──────────────────────────────────────────────────────────────────

describe('install', () => {
  it('caches every file in the list under a cache named for the build, with a record of their hashes', async () => {
    const t = loadSw({ precache: FILES });
    await runEvent(t.listeners, 'install');
    expect([...t.caches.stores.keys()]).toEqual(['bsr-code-b1']);
    const cache = t.caches.stores.get('bsr-code-b1');
    expect(cache.urls()).toEqual(expect.arrayContaining(FILES.map(f => f.url)));
    const manifest = await (await cache.match('__bsr_manifest__')).json();
    expect(manifest).toEqual({ 'index.html': 'h-index', 'css/a.css': 'h-css', 'js/app.js': 'h-js', 'fonts/Inter-Regular.ttf': 'h-font' });
  });

  it('refetches around the HTTP cache', async () => {
    const seen = [];
    const t = loadSw({ precache: FILES, fetchImpl: (url, opts) => { seen.push(opts && opts.cache); return new Response('x'); } });
    await runEvent(t.listeners, 'install');
    expect(seen.every(c => c === 'reload')).toBe(true);
  });

  it('fails, and keeps nothing, when a required file cannot be fetched', async () => {
    const t = loadSw({ precache: FILES, fetchImpl: url => url.endsWith('js/app.js') ? new Response('no', { status: 404 }) : new Response('x') });
    await expect(runEvent(t.listeners, 'install')).rejects.toThrow(/js\/app\.js/);
    expect(t.caches.stores.has('bsr-code-b1')).toBe(false);
  });

  it('carries on when an optional file cannot be fetched, and leaves it out of the record', async () => {
    const t = loadSw({ precache: FILES, fetchImpl: url => { if (url.includes('fonts/')) throw new Error('offline'); return new Response('x'); } });
    await runEvent(t.listeners, 'install');
    const cache = t.caches.stores.get('bsr-code-b1');
    expect(cache.urls()).not.toContain('fonts/Inter-Regular.ttf');
    expect(Object.keys(await (await cache.match('__bsr_manifest__')).json())).not.toContain('fonts/Inter-Regular.ttf');
  });

  it('copies files unchanged since the previous build instead of downloading them', async () => {
    const caches = makeCaches();
    const first = loadSw({ precache: FILES, buildId: 'old', caches });
    await runEvent(first.listeners, 'install');

    const next = FILES.map(f => f.url === 'js/app.js' ? { ...f, hash: 'h-js-NEW' } : f);
    const second = loadSw({ precache: next, buildId: 'new', caches });
    await runEvent(second.listeners, 'install');

    expect(second.fetched).toEqual(['js/app.js']);
    const cache = caches.stores.get('bsr-code-new');
    expect(cache.urls()).toEqual(expect.arrayContaining(FILES.map(f => f.url)));
    expect(await (await cache.match('css/a.css')).text()).toBe('body of ' + BASE + 'css/a.css');
  });
});

// ── activate ─────────────────────────────────────────────────────────────────

describe('activate', () => {
  it('removes older builds, keeps the font and image cache, and claims the open pages', async () => {
    const caches = makeCaches();
    await caches.open('bsr-code-old1'); await caches.open('bsr-code-old2'); await caches.open('bsr-assets'); await caches.open('other-site');
    const t = loadSw({ precache: FILES, caches });
    await caches.open('bsr-code-b1');
    await runEvent(t.listeners, 'activate');
    expect([...caches.stores.keys()].sort()).toEqual(['bsr-assets', 'bsr-code-b1', 'other-site']);
    expect(t.calls.claim).toBe(1);
  });

  it('never skips waiting, so a new build takes over only after every window has closed', async () => {
    const t = loadSw({ precache: FILES });
    await runEvent(t.listeners, 'install');
    await runEvent(t.listeners, 'activate');
    expect(t.calls.skipWaiting).toBe(0);
    expect(SW_SRC).not.toMatch(/skipWaiting\s*\(/);
  });
});

// ── fetch ────────────────────────────────────────────────────────────────────

describe('fetch', () => {
  async function installed(extra = {}) {
    const t = loadSw({ precache: FILES, ...extra });
    await runEvent(t.listeners, 'install');
    t.fetched.length = 0;
    return t;
  }

  it('leaves non-GET requests and other sites alone', async () => {
    const t = await installed();
    expect((await fetchEvent(t.listeners, req('x', { method: 'POST' }))).handled).toBe(false);
    expect((await fetchEvent(t.listeners, { url: 'https://drive.google.com/uc?id=1', method: 'GET', mode: 'cors' })).handled).toBe(false);
  });

  it('answers a page load at the root, or index.html, with the cached shell, offline too', async () => {
    const t = await installed();
    t.setFetch(() => { throw new Error('offline'); });
    for (const path of ['', 'index.html', 'index.html?utm=1']) {
      const { res } = await fetchEvent(t.listeners, req(path, { mode: 'navigate' }));
      expect(await res.text()).toBe('body of ' + BASE + 'index.html');
    }
    expect(t.fetched).toEqual([]);
  });

  it('sends a page load for any other page to the network', async () => {
    const t = await installed();
    const { res } = await fetchEvent(t.listeners, req('other.html', { mode: 'navigate' }));
    expect(await res.text()).toBe('body of ' + BASE + 'other.html');
    expect(t.fetched).toEqual(['other.html']);
  });

  it('serves a cached file ignoring a ?v= query, without touching the network', async () => {
    const t = await installed();
    const { res } = await fetchEvent(t.listeners, req('css/a.css?v=2'));
    expect(await res.text()).toBe('body of ' + BASE + 'css/a.css');
    expect(t.fetched).toEqual([]);
  });

  it('caches a font the first time it is used, then serves it offline', async () => {
    const t = await installed();
    const first = await fetchEvent(t.listeners, req('fonts/NotoSansArabic-Regular.ttf'));
    expect(await first.res.text()).toContain('NotoSansArabic');
    expect(t.caches.stores.get('bsr-assets').urls()).toContain('fonts/NotoSansArabic-Regular.ttf');
    t.setFetch(() => { throw new Error('offline'); });
    const again = await fetchEvent(t.listeners, req('fonts/NotoSansArabic-Regular.ttf'));
    expect(await again.res.text()).toContain('NotoSansArabic');
  });

  it('serves a cached image at once and refreshes it for next time', async () => {
    let version = 1;
    const t = await installed();
    t.setFetch(url => new Response(`img v${version} ${url}`));
    const a = await fetchEvent(t.listeners, req('images/x.png'));
    expect(await a.res.text()).toContain('img v1');
    version = 2;
    const b = await fetchEvent(t.listeners, req('images/x.png'));
    expect(await b.res.text()).toContain('img v1');            // the cached copy, immediately
    await new Promise(r => setTimeout(r, 0));
    const c = await fetchEvent(t.listeners, req('images/x.png'));
    expect(await c.res.text()).toContain('img v2');            // the refresh landed
  });

  it('caches another language file with the build, so it is replaced on update', async () => {
    const t = await installed();
    await fetchEvent(t.listeners, req('js/locales/fr/ui_fr.json'));
    expect(t.caches.stores.get('bsr-code-b1').urls()).toContain('js/locales/fr/ui_fr.json');
    expect(t.caches.stores.get('bsr-assets')?.urls() || []).not.toContain('js/locales/fr/ui_fr.json');
  });

  it('sends anything else straight to the network without caching it', async () => {
    const t = await installed();
    await fetchEvent(t.listeners, req('estudy/something.estudy'));
    expect(t.fetched).toEqual(['estudy/something.estudy']);
    expect(t.caches.stores.get('bsr-code-b1').urls()).not.toContain('estudy/something.estudy');
  });

  it('does not cache an error response', async () => {
    const t = await installed();
    t.setFetch(() => new Response('gone', { status: 404 }));
    const { res } = await fetchEvent(t.listeners, req('fonts/Missing.ttf'));
    expect(res.status).toBe(404);
    expect((t.caches.stores.get('bsr-assets') || { urls: () => [] }).urls()).not.toContain('fonts/Missing.ttf');
  });
});
