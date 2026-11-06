/**
 * app/js/web-app.js: the web build's service-worker registration, durable
 * storage request and one-time "Add to Home Screen" hint, run in a vm sandbox.
 *
 *  - Nothing runs in the Android app, on file://, or on localhost (unless the
 *    dev opt-in key is set).
 *  - The hint is for iPhone and iPad browsers only, once, after the first-run
 *    slides, and never over another dialog.
 *
 * Paths are relative to testing/tests/ — source files are in ../../app/js/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../app/js/web-app.js'), 'utf8');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const MAC    = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';

function env({
  ua = ANDROID_CHROME, platform = 'Linux armv8l', touch = 5, standalone = false, displayStandalone = false,
  protocol = 'https:', hostname = 'rick.github.io', android = false, store = {}, swVisible = false,
  hasServiceWorker = true, persist = true,
} = {}) {
  const calls = { register: [], persist: 0, fire: [], loadHandlers: [], seen: {} };
  const storage = { ...store };
  const nav = {
    userAgent: ua, platform, maxTouchPoints: touch, standalone: standalone || undefined,
    storage: persist ? { persist: async () => { calls.persist++; return true; } } : undefined,
  };
  if (hasServiceWorker) nav.serviceWorker = { register: async url => { calls.register.push(url); } };
  const sandbox = {
    console,
    navigator: nav,
    location: { protocol, hostname },
    localStorage: { getItem: k => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
    document: { querySelector: sel => (sel === '.onboarding-overlay' && env.overlay ? {} : null) },
    Swal: { isVisible: () => swVisible, fire: opts => { calls.fire.push(opts); return Promise.resolve({}); } },
    t: k => k,
    safeSetItem: (k, v) => { storage[k] = v; },
    setTimeout: fn => fn(),
    window: {},
  };
  sandbox.window.navigator = nav;
  sandbox.window.matchMedia = q => ({ matches: displayStandalone && q.includes('standalone') });
  sandbox.window.addEventListener = (type, fn) => calls.loadHandlers.push([type, fn]);
  if (android) sandbox.window.Android = {};
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'web-app.js' });
  return { sb: sandbox, calls, storage };
}

describe('where it runs', () => {
  it('runs on an https site', () => {
    expect(env().sb.webAppFeaturesEnabled()).toBe(true);
  });
  it('does not run in the Android app', () => {
    expect(env({ android: true }).sb.webAppFeaturesEnabled()).toBe(false);
  });
  it('does not run from a file:// page', () => {
    expect(env({ protocol: 'file:', hostname: '' }).sb.webAppFeaturesEnabled()).toBe(false);
  });
  it('does not run on localhost, so a dev server never serves cached scripts', () => {
    for (const hostname of ['localhost', '127.0.0.1', '[::1]', 'bsr.localhost']) {
      expect(env({ protocol: 'http:', hostname }).sb.webAppFeaturesEnabled(), hostname).toBe(false);
    }
  });
  it('runs on localhost once the dev key is set', () => {
    expect(env({ protocol: 'http:', hostname: 'localhost', store: { bsr_dev_sw: '1' } }).sb.webAppFeaturesEnabled()).toBe(true);
  });
  it('registers itself for the page load event', () => {
    const { calls } = env();
    expect(calls.loadHandlers.map(h => h[0])).toEqual(['load']);
  });
});

describe('detecting the device', () => {
  it('recognises an iPhone', () => {
    expect(env({ ua: IPHONE }).sb.isIosBrowser()).toBe(true);
  });
  it('recognises an iPad that reports itself as a Mac (it has a touch screen)', () => {
    expect(env({ ua: MAC, platform: 'MacIntel', touch: 5 }).sb.isIosBrowser()).toBe(true);
  });
  it('does not mistake a Mac, or an Android phone, for an iPhone', () => {
    expect(env({ ua: MAC, platform: 'MacIntel', touch: 0 }).sb.isIosBrowser()).toBe(false);
    expect(env().sb.isIosBrowser()).toBe(false);
  });
  it('knows when it was opened from the Home Screen', () => {
    expect(env({ standalone: true }).sb.isStandaloneWebApp()).toBe(true);
    expect(env({ displayStandalone: true }).sb.isStandaloneWebApp()).toBe(true);
    expect(env().sb.isStandaloneWebApp()).toBe(false);
  });
});

describe('service worker', () => {
  it('registers sw.js where enabled', () => {
    const { sb, calls } = env();
    sb.registerServiceWorker();
    expect(calls.register).toEqual(['sw.js']);
  });
  it('does not register in the Android app or without browser support', () => {
    const a = env({ android: true }); a.sb.registerServiceWorker();
    const b = env({ hasServiceWorker: false }); b.sb.registerServiceWorker();
    expect(a.calls.register).toEqual([]);
    expect(b.calls.register).toEqual([]);
  });
  it('survives a registration that fails', async () => {
    const { sb } = env();
    sb.navigator.serviceWorker.register = () => Promise.reject(new Error('blocked'));
    expect(() => sb.registerServiceWorker()).not.toThrow();
    await new Promise(r => setTimeout(r, 0));
  });
});

describe('durable storage', () => {
  it('is requested only from the installed app', () => {
    const installed = env({ standalone: true }); installed.sb.requestPersistentStorage();
    const browser = env(); browser.sb.requestPersistentStorage();
    expect(installed.calls.persist).toBe(1);
    expect(browser.calls.persist).toBe(0);
  });
  it('is skipped in the Android app', () => {
    const { sb, calls } = env({ android: true, standalone: true });
    sb.requestPersistentStorage();
    expect(calls.persist).toBe(0);
  });
  it('is skipped where the browser has no such call', () => {
    const { sb } = env({ standalone: true, persist: false });
    expect(() => sb.requestPersistentStorage()).not.toThrow();
  });
});

describe('Add to Home Screen hint', () => {
  const ready = { app_onboarding_complete: 'true' };
  const schedule = e => e.sb.scheduleAddToHomeScreenHint();

  it('shows once on an iPhone browser after the first-run slides, then never again', () => {
    const e = env({ ua: IPHONE, store: ready });
    schedule(e);
    expect(e.calls.fire).toHaveLength(1);
    expect(e.calls.fire[0]).toMatchObject({ title: 'a2hs_title', confirmButtonText: 'a2hs_ok' });
    expect(e.calls.fire[0].html).toContain('a2hs_body');
    expect(e.storage.a2hs_hint_seen).toBe('1');
    schedule(e);
    expect(e.calls.fire).toHaveLength(1);
  });

  it('is not shown to a brand-new reader still on the first-run slides', () => {
    const e = env({ ua: IPHONE });
    schedule(e);
    expect(e.calls.fire).toHaveLength(0);
  });

  it('is not shown on other devices, in the installed app, or in the Android app', () => {
    for (const opts of [{ ua: ANDROID_CHROME }, { ua: IPHONE, standalone: true }, { ua: IPHONE, android: true }]) {
      const e = env({ store: ready, ...opts });
      schedule(e);
      expect(e.calls.fire, JSON.stringify(opts)).toHaveLength(0);
    }
  });

  it('waits while a dialog or the What\u2019s New slides are up, then shows when the screen is free', () => {
    const timers = [];
    const e = env({ ua: IPHONE, store: ready, swVisible: true });
    e.sb.setTimeout = fn => { timers.push(fn); };
    schedule(e);
    expect(e.calls.fire).toHaveLength(0);
    expect(e.storage.a2hs_hint_seen).toBeUndefined();       // still unseen: it will be offered
    expect(timers).toHaveLength(1);
    e.sb.Swal.isVisible = () => false;                      // the dialog was dismissed
    timers.shift()();
    expect(e.calls.fire).toHaveLength(1);

    env.overlay = true;
    try {
      const f = env({ ua: IPHONE, store: ready });
      f.sb.setTimeout = fn => { timers.push(fn); };
      schedule(f);
      expect(f.calls.fire).toHaveLength(0);
      env.overlay = false;
      timers.shift()();
      expect(f.calls.fire).toHaveLength(1);
    } finally { env.overlay = false; }
  });

  it('gives up after about a minute of waiting', () => {
    const timers = [];
    const e = env({ ua: IPHONE, store: ready, swVisible: true });
    e.sb.setTimeout = fn => { timers.push(fn); };
    schedule(e);
    let rounds = 0;
    while (timers.length && rounds < 100) { timers.shift()(); rounds++; }
    expect(rounds).toBe(20);
    expect(e.calls.fire).toHaveLength(0);
  });

  it('waits for the app strings before it is scheduled', () => {
    const e = env({ ua: IPHONE, store: ready });
    e.sb.initWebApp();                    // _appReady is not set: nothing yet
    expect(e.calls.fire).toHaveLength(0);
    e.sb.window._appReady = true;
    e.sb.initWebApp();
    expect(e.calls.fire).toHaveLength(1);
  });
});
