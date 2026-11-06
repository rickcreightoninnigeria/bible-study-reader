/**
 * dispatchPrint() in share-print.js: the Android print bridge when there is
 * one, a share of the fallback text when Android has no print bridge, and the
 * browser's print dialog (through a hidden, script-less iframe) on the web.
 *
 * share-print.js is run in a vm sandbox with a fake DOM.
 *
 * Paths are relative to testing/tests/ — source files are in ../../app/
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../../app/js/share-print.js'), 'utf8');

function fakeFrame({ fontsReady = Promise.resolve() } = {}) {
  const listeners = {};
  const winListeners = {};
  const frame = {
    attrs: {}, style: {}, srcdoc: null, removed: false, listeners,
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { listeners[type] = fn; },
    remove() { this.removed = true; },
    printed: 0, focused: 0,
    contentWindow: {
      document: { fonts: { ready: fontsReady } },
      addEventListener(type, fn) { winListeners[type] = fn; },
      focus() { frame.focused++; },
      print() { frame.printed++; },
    },
    winListeners,
  };
  return frame;
}

function makeSandbox({ android, frame } = {}) {
  const appended = [];
  const sandbox = {
    console,
    window: android === undefined ? {} : { Android: android },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    document: {
      createElement: tag => { expect(tag).toBe('iframe'); return frame; },
      body: { appendChild: el => appended.push(el) },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'share-print.js' });
  sandbox.__appended = appended;
  return sandbox;
}

describe('with the Android bridge', () => {
  it('uses printContent and does not touch the DOM', () => {
    const calls = [];
    const sb = makeSandbox({ android: { printContent: h => calls.push(h), share: () => calls.push('share') } });
    sb.dispatchPrint('<p>hi</p>', 'fallback');
    expect(calls).toEqual(['<p>hi</p>']);
    expect(sb.__appended).toHaveLength(0);
  });

  it('shares the fallback text when Android has no print bridge', () => {
    const shared = [];
    const sb = makeSandbox({ android: { share: t => shared.push(t) } });
    sb.dispatchPrint('<p>hi</p>', 'fallback');
    expect(shared).toEqual(['fallback']);
    expect(sb.__appended).toHaveLength(0);
  });
});

describe('in a browser (no Android bridge)', () => {
  it('puts the document in a hidden, sandboxed iframe with no script permission', () => {
    const frame = fakeFrame();
    const sb = makeSandbox({ frame });
    sb.dispatchPrint('<p>hi</p>', 'fallback');
    expect(sb.__appended).toEqual([frame]);
    expect(frame.srcdoc).toBe('<p>hi</p>');
    const flags = frame.attrs.sandbox.split(' ').sort();
    expect(flags).toEqual(['allow-modals', 'allow-same-origin']);
    expect(frame.attrs.sandbox).not.toContain('allow-scripts');
    expect(frame.attrs['aria-hidden']).toBe('true');
    expect(frame.style.cssText).toContain('visibility:hidden');
    expect(frame.printed).toBe(0);    // not until it has loaded
  });

  it('prints once the frame has loaded and the fonts are ready, then removes it after printing', async () => {
    const frame = fakeFrame();
    const sb = makeSandbox({ frame });
    sb.dispatchPrint('<p>hi</p>', 'fallback');
    frame.listeners.load();
    await new Promise(r => setTimeout(r, 0));
    expect(frame.focused).toBe(1);
    expect(frame.printed).toBe(1);
    expect(frame.removed).toBe(false);
    frame.winListeners.afterprint();
    expect(frame.removed).toBe(true);
  });

  it('waits for fonts, but not forever', async () => {
    vi.useFakeTimers();
    try {
      const frame = fakeFrame({ fontsReady: new Promise(() => {}) });    // never settles
      const sb = makeSandbox({ frame });
      sb.dispatchPrint('<p>hi</p>', 'fallback');
      frame.listeners.load();
      await vi.advanceTimersByTimeAsync(2900);
      expect(frame.printed).toBe(0);
      await vi.advanceTimersByTimeAsync(200);
      expect(frame.printed).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it('removes the frame after a minute if afterprint never fires', async () => {
    vi.useFakeTimers();
    try {
      const frame = fakeFrame();
      const sb = makeSandbox({ frame });
      sb.dispatchPrint('<p>hi</p>', 'fallback');
      frame.listeners.load();
      await vi.advanceTimersByTimeAsync(10);
      expect(frame.removed).toBe(false);
      await vi.advanceTimersByTimeAsync(60000);
      expect(frame.removed).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('removes the frame without printing if it has no window', () => {
    const frame = fakeFrame();
    frame.contentWindow = null;
    const sb = makeSandbox({ frame });
    sb.dispatchPrint('<p>hi</p>', 'fallback');
    frame.listeners.load();
    expect(frame.removed).toBe(true);
  });
});

// ── The print document's fonts ────────────────────────────────────────────────
// The print document must not reach out to a font host (the only request the
// app would otherwise make just by printing), so every face it uses has to be a
// local @font-face pointing at a file that is really in app/fonts/.

import { existsSync } from 'fs';

describe('print document fonts', () => {
  const sandbox = {
    console, window: {}, document: { documentElement: {} },
    appSettings: { useSansSerif: false },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'share-print.js' });
  const head = sandbox.buildPrintHead('Title');

  it('links to no external host', () => {
    expect(head).not.toMatch(/https?:\/\//);
    expect(head).not.toContain('<link');
  });

  it('declares every face from a file that exists in app/fonts/', () => {
    const files = [...head.matchAll(/url\('fonts\/([^']+)'\)/g)].map(m => m[1]);
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const f of files) {
      expect(existsSync(join(__dirname, '../../app/fonts', f)), f).toBe(true);
    }
  });

  it('declares no two faces with the same family, weight and style (the later one would replace the earlier)', () => {
    const faces = [...head.matchAll(/@font-face \{([^}]*)\}/g)].map(m => m[1]);
    const key = f => ['font-family', 'font-weight', 'font-style'].map(p => (f.match(new RegExp(p + ':\\s*([^;]+);')) || [])[1]).join('|');
    const keys = faces.map(key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('declares Inter italic as italic', () => {
    expect(head).toMatch(/Inter-Italic\.ttf'\) format\('truetype'\); font-weight: 400; font-style: italic;/);
  });
});
