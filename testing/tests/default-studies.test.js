/**
 * The bundled "default studies" install on a fresh app.
 *
 * Regression guard: startApp() once stopped calling installDefaultStudiesIfNeeded()
 * (commit 0c86fd4), so a fresh install had an empty library even though the
 * installer and estudy/firstEstudies.zip were fine. These tests check that
 *  1. startApp() calls the installer, at the right point in start-up; and
 *  2. the installer itself installs every .estudy in the bundle, sets its
 *     once-per-app-version flag, skips when the flag is current, and treats a
 *     missing zip as a quiet no-op.
 *
 * The installer is cut out of study-loader.js by name (that file has many
 * load-time dependencies) and run in a vm sandbox with stubs.
 *
 * Paths are relative to testing/tests/ — source files are in ../../app/js/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS = join(__dirname, '../../app/js');

// ── 1. startApp() calls the installer ─────────────────────────────────────────
describe('startApp() installs the default studies', () => {
  const src = readFileSync(join(JS, 'app-init.js'), 'utf8');
  const body = src.slice(src.indexOf('async function startApp()'));

  it('awaits installDefaultStudiesIfNeeded()', () => {
    expect(body).toMatch(/await installDefaultStudiesIfNeeded\(\)/);
  });

  it('runs after the locale is loaded (it reads appAboutData) and before any routing', () => {
    const at = s => body.indexOf(s);
    expect(at('await loadLocale(')).toBeGreaterThan(-1);
    expect(at('await installDefaultStudiesIfNeeded()')).toBeGreaterThan(at('await loadLocale('));
    // The first routing decision is Case 0 (a study delivered by Android).
    expect(at('await installDefaultStudiesIfNeeded()')).toBeLessThan(at('if (window.pendingStudyData)'));
    expect(at('await installDefaultStudiesIfNeeded()')).toBeLessThan(at('await cleanOrphanedRegistry()'));
    expect(at('await installDefaultStudiesIfNeeded()')).toBeLessThan(at('const isFirstRun'));
  });
});

// ── 2. The installer ──────────────────────────────────────────────────────────
function extractInstaller() {
  const src = readFileSync(join(JS, 'study-loader.js'), 'utf8');
  const start = src.indexOf('class _DefaultStudiesAssetMissing');
  const fnStart = src.indexOf('async function installDefaultStudiesIfNeeded()');
  expect(start, 'class found').toBeGreaterThan(-1);
  expect(fnStart, 'function found').toBeGreaterThan(start);
  // The function ends at the first line that is exactly "}" after it starts.
  const end = src.indexOf('\n}\n', fnStart) + 3;
  return src.slice(start, end);
}

function makeSandbox({ names = null, corrupt = false, status = 200, flag = null, version = '9.9.9' } = {}) {
  const store = flag === null ? {} : { default_studies_installed: flag };
  const installed = [];
  const toasts = [];
  const infos = [];
  const requested = [];
  const sandbox = {
    console: { ...console, info: m => infos.push(m), error: () => {}, warn: () => {} },
    setTimeout, clearTimeout, setImmediate, clearImmediate,   // JSZip schedules work with these
    window: { appAboutData: { appVersion: version } },
    localStorage: { getItem: k => (k in store ? store[k] : null) },
    safeSetItem: (k, v) => { store[k] = v; },
    showToast: o => toasts.push(o),
    t: k => k,
    JSZip: undefined,
    _installStudyFileQuietly: async (buf, name) => { installed.push(name); },
    XMLHttpRequest: function () {
      this.open = (_m, url) => { requested.push(url); };
      this.send = () => setTimeout(() => {
        this.status = status;
        this.response = sandbox.__bytes;
        this.onload();
      }, 0);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(JS, 'jszip.min.js'), 'utf8'), sandbox, { filename: 'jszip.min.js' });
  sandbox.JSZip = sandbox.window.JSZip;   // the UMD build attaches itself to window
  vm.runInContext(extractInstaller(), sandbox, { filename: 'default-studies-installer' });
  return { sandbox, store, installed, toasts, infos, requested };
}

// Builds the sandbox, and (inside its own realm, so JSZip recognises the bytes)
// the bundle zip the stubbed XHR will return.
async function setup(opts = {}) {
  const t = makeSandbox(opts);
  if (opts.names) {
    const zip = new t.sandbox.JSZip();
    opts.names.forEach(n => zip.file(n, 'x'));
    zip.file('readme.txt', 'not a study');
    t.sandbox.__bytes = await zip.generateAsync({ type: 'arraybuffer' });
  } else if (opts.corrupt) {
    t.sandbox.__bytes = vm.runInContext('new ArrayBuffer(8)', t.sandbox);
  }
  return t;
}

describe('installDefaultStudiesIfNeeded()', () => {
  it('requests estudy/firstEstudies.zip, installs each .estudy, and records the app version', async () => {
    const t = await setup({ names: ['A.estudy', 'B.estudy'] });
    await t.sandbox.installDefaultStudiesIfNeeded();
    expect(t.requested).toEqual(['estudy/firstEstudies.zip']);
    expect(t.installed.sort()).toEqual(['A.estudy', 'B.estudy']);   // readme.txt is ignored
    expect(t.store.default_studies_installed).toBe('9.9.9');
    expect(t.toasts).toEqual([]);
  });

  it('does nothing when the flag already matches the app version', async () => {
    const t = await setup({ names: ['A.estudy'], flag: '9.9.9' });
    await t.sandbox.installDefaultStudiesIfNeeded();
    expect(t.requested).toEqual([]);
    expect(t.installed).toEqual([]);
  });

  it('runs again after an app update (a different version)', async () => {
    const t = await setup({ names: ['A.estudy'], flag: '9.9.8' });
    await t.sandbox.installDefaultStudiesIfNeeded();
    expect(t.installed).toEqual(['A.estudy']);
    expect(t.store.default_studies_installed).toBe('9.9.9');
  });

  it('treats a missing zip (404) as a quiet no-op and leaves the flag unset', async () => {
    const t = await setup({ status: 404 });
    await t.sandbox.installDefaultStudiesIfNeeded();
    expect(t.installed).toEqual([]);
    expect(t.toasts).toEqual([]);
    expect(t.infos.length).toBe(1);
    expect(t.store.default_studies_installed).toBeUndefined();
  });

  it('shows one toast and leaves the flag unset when the bundle is corrupt', async () => {
    const t = await setup({ corrupt: true });
    await t.sandbox.installDefaultStudiesIfNeeded();
    expect(t.installed).toEqual([]);
    expect(t.toasts.length).toBe(1);
    expect(t.store.default_studies_installed).toBeUndefined();
  });
});
