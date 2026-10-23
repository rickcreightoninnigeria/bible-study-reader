/**
 * Error reporting (error-report.js) and the install summary (study-loader.js).
 *
 * error-report.js is run whole in a vm sandbox with a tiny fake DOM and
 * localStorage. The install-summary helpers are cut out of study-loader.js and
 * run with the real English strings. Wiring (what calls what) is checked by
 * reading the source, as in the other tests.
 *
 * Paths are relative to testing/tests/ — source files are in ../../app/
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, '../../app');
const read = f => readFileSync(join(APP, f), 'utf8');
const en = JSON.parse(read('js/locales/en/ui_en.json'));

function slice(src, from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  expect(a, from).toBeGreaterThan(-1);
  expect(b, to).toBeGreaterThan(a);
  return src.slice(a, b);
}

// ── A fake DOM, just big enough for the dialog and banner ─────────────────────
class FakeEl {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.listeners = {}; this.style = {}; this.className = ''; this._text = ''; this.parent = null; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set innerHTML(v) { throw new Error('innerHTML must not be used'); }
  setAttribute(k, v) { this.attrs[k] = v; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async click() { for (const fn of this.listeners.click || []) await fn(); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
  focus() {}
  select() {}
  querySelector(sel) { return this.find(e => sel.startsWith('.') ? e.className.split(' ').includes(sel.slice(1)) : e.tagName === sel.toUpperCase()); }
  find(pred) { if (pred(this)) return this; for (const c of this.children) { const f = c.find(pred); if (f) return f; } return null; }
  findAll(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach(c => c.findAll(pred, out)); return out; }
}

function makeSandbox({ strings } = {}) {
  const body = new FakeEl('body');
  const store = {};
  const handlers = {};
  const copied = [];
  const sandbox = {
    console: { ...console, error() {} },
    navigator: { userAgent: 'TestAgent/1', clipboard: { writeText: async t => { copied.push(t); } } },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    document: {
      body,
      createElement: tag => new FakeEl(tag),
      getElementById: id => body.find(e => e.id === id),
    },
    window: null,
    copied, store, handlers, body,
  };
  sandbox.window = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    screen: { width: 360, height: 640 },
    appStrings: strings,
    appAboutData: { appVersion: '0.6.9' },
    activeStudyId: 'demo',
    studyMetadata: { studyId: 'demo', studyVersion: 1.2 },
    _activeStudyLang: 'en',
  };
  sandbox.t = (key, vars) => {
    let s = strings[key];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
    return s;
  };
  vm.createContext(sandbox);
  vm.runInContext(read('js/error-report.js'), sandbox, { filename: 'error-report' });
  return sandbox;
}

let sb;
beforeEach(() => { sb = makeSandbox({ strings: en }); });

describe('the error log', () => {
  it('records message, stack, study, version and where it happened', () => {
    const e = sb.recordError(new TypeError('x is not a function'), { context: 'render-element', chapter: 3, elementId: 'ch03-el07' });
    expect(e).toMatchObject({ name: 'TypeError', message: 'x is not a function', studyId: 'demo', studyVersion: '1.2',
      appVersion: '0.6.9', context: 'render-element', chapter: 3, elementId: 'ch03-el07' });
    expect(JSON.parse(sb.store.bsr_error_log)).toHaveLength(1);
  });

  it('keeps only the last 20 entries', () => {
    for (let i = 0; i < 25; i++) sb.recordError(new Error('e' + i));
    const log = sb.getErrorLog();
    expect(log).toHaveLength(20);
    expect(log[0].message).toBe('e5');
    expect(log[19].message).toBe('e24');
  });

  it('copes with things that are not Errors', () => {
    expect(sb.recordError('plain string').message).toBe('plain string');
    expect(sb.recordError(null).message).toBe('null');
    expect(sb.recordError(undefined).message).toBe('undefined');
  });

  it("does not claim the previous study's version for a study that is still opening", () => {
    sb.window.activeStudyId = 'next';           // metadata still says 'demo'
    expect(sb.recordError(new Error('x')).studyVersion).toBe('');
    expect(sb.recordError(new Error('x'), { studyId: 'other' }).studyVersion).toBe('');
  });

  it('can be cleared', () => {
    sb.recordError(new Error('x'));
    sb.clearErrorLog();
    expect(sb.getErrorLog()).toHaveLength(0);
  });
});

describe('the details a student copies', () => {
  it('lists app, study, file, chapter, element, error and device on separate lines', () => {
    const e = sb.recordError(new Error('boom'), { context: 'install-study', file: 'class.estudy', chapter: 2, elementId: 'ch02-el09', elementType: 'callout' });
    const text = sb.formatErrorDetails(e);
    expect(text).toContain('Bible Study Reader 0.6.9');
    expect(text).toContain('Study: demo v1.2');
    expect(text).toContain('File: class.estudy');
    expect(text).toContain('Chapter: 2');
    expect(text).toContain('Element: ch02-el09 (callout)');
    expect(text).toContain('Error: Error: boom');
    expect(text).toContain('Device: TestAgent/1');
    expect(text).toContain('Screen: 360x640');
  });
});

describe('benign errors', () => {
  it('are recognised: cancelled shares, refused permissions, ResizeObserver notices, speech stops', () => {
    expect(sb.isBenignError({ name: 'AbortError' }, '')).toBe(true);
    expect(sb.isBenignError({ name: 'NotAllowedError' }, '')).toBe(true);
    expect(sb.isBenignError(null, 'ResizeObserver loop limit exceeded')).toBe(true);
    expect(sb.isBenignError(null, 'interrupted')).toBe(true);
    expect(sb.isBenignError(new TypeError('x is not a function'), 'x is not a function')).toBe(false);
  });

  it('are logged but get no banner or dialog; real errors do', () => {
    const shown = [];
    sb.showErrorBanner = e => shown.push(e.message);
    sb.showErrorDialog = o => shown.push('dialog:' + o.message);
    sb.reportError({ name: 'AbortError', message: 'share cancelled' }, { context: 'x' });
    expect(shown).toHaveLength(0);
    expect(sb.getErrorLog()).toHaveLength(1);
    sb.reportError(new Error('real problem'), { context: 'x' });
    sb.reportError(new Error('real problem 2'), { context: 'x', dialog: true, message: 'Could not open it' });
    expect(shown).toEqual(['real problem', 'dialog:Could not open it']);
  });
});

describe('global handlers', () => {
  it('are installed for errors (capture phase) and unhandled promise rejections', () => {
    expect(typeof sb.handlers.error).toBe('function');
    expect(typeof sb.handlers.unhandledrejection).toBe('function');
    expect(read('js/error-report.js')).toMatch(/}, true\);\s*\nwindow\.addEventListener\('unhandledrejection'/);
  });

  it('record an uncaught error and show the banner', () => {
    sb.handlers.error({ error: new Error('kaboom'), message: 'kaboom' });
    expect(sb.getErrorLog().at(-1)).toMatchObject({ message: 'kaboom', context: 'uncaught-error' });
    expect(sb.body.querySelector('.error-report-banner')).not.toBeNull();
  });

  it('record a rejection that is not an Error', () => {
    sb.handlers.unhandledrejection({ reason: 'string reason' });
    expect(sb.getErrorLog().at(-1)).toMatchObject({ message: 'string reason', context: 'unhandled-promise' });
  });

  it('report a script or stylesheet that failed to load, but ignore a missing image', () => {
    sb.handlers.error({ target: { tagName: 'SCRIPT', src: 'js/format-text.js' } });
    expect(sb.getErrorLog().at(-1)).toMatchObject({ message: 'Could not load js/format-text.js', context: 'file-load' });
    const before = sb.getErrorLog().length;
    sb.handlers.error({ target: { tagName: 'IMG', src: 'x.png' } });
    expect(sb.getErrorLog()).toHaveLength(before);
  });

  it('never throw, whatever they are given', () => {
    expect(() => sb.handlers.error(undefined)).not.toThrow();
    expect(() => sb.handlers.unhandledrejection({})).not.toThrow();
  });
});

describe('the banner and dialog', () => {
  it('counts a repeated error instead of stacking banners', () => {
    const entry = sb.recordError(new Error('same'));
    sb.showErrorBanner(entry); sb.showErrorBanner(entry); sb.showErrorBanner(entry);
    expect(sb.body.findAll(e => e.className.split(' ').includes('error-report-banner'))).toHaveLength(1);
    expect(sb.body.querySelector('.error-report-count').textContent).toBe('×3');
  });

  it('Details opens a dialog that replaces the banner', () => {
    sb.showErrorBanner(sb.recordError(new Error('why')));
    sb.body.find(e => e.tagName === 'BUTTON' && e.textContent === 'Details').click();
    expect(sb.body.querySelector('.error-report-overlay')).not.toBeNull();
    expect(sb.body.querySelector('.error-report-banner')).toBeNull();
  });

  it('shows hostile text as text, never as markup (no innerHTML anywhere)', () => {
    expect(read('js/error-report.js')).not.toMatch(/\.innerHTML\s*=/);
    sb.showErrorDialog({ title: '<img onerror=x>', message: '<script>alert(1)</script>', lines: [{ ok: false, text: '<b>x</b>' }], details: '<i>d</i>' });
    const box = sb.body.querySelector('.error-report-box');
    expect(box.textContent).toContain('<script>alert(1)</script>');
    expect(box.textContent).toContain('<b>x</b>');
    expect(sb.body.findAll(e => ['SCRIPT', 'IMG', 'B', 'I'].includes(e.tagName))).toHaveLength(0);
  });

  it('Copy details copies the details text, and Close removes the dialog', async () => {
    sb.showErrorDialog({ message: 'm', details: 'DETAILS HERE' });
    const copy = sb.body.find(e => e.tagName === 'BUTTON' && e.textContent === 'Copy details');
    await copy.click();
    expect(sb.copied).toEqual(['DETAILS HERE']);
    expect(copy.textContent).toBe('Copied ✓');
    await sb.body.find(e => e.tagName === 'BUTTON' && e.textContent === 'Close').click();
    expect(sb.body.querySelector('.error-report-overlay')).toBeNull();
  });

  it('a question dialog shows the given buttons instead of Close, closes on a click, and runs that click', async () => {
    const picked = [];
    sb.showErrorDialog({ title: 'Which?', message: 'm', actions: [
      { label: 'Install anyway', onClick: () => picked.push('install') },
      { label: 'Keep', primary: true, onClick: () => picked.push('keep') },
    ] });
    const labels = sb.body.findAll(e => e.tagName === 'BUTTON').map(b => b.textContent);
    expect(labels).toEqual(['Install anyway', 'Keep']);
    await sb.body.find(e => e.tagName === 'BUTTON' && e.textContent === 'Install anyway').click();
    expect(picked).toEqual(['install']);
    expect(sb.body.querySelector('.error-report-overlay')).toBeNull();
  });

  it('a question dialog replaced by another dialog reports a cancel, once, so nobody waits forever', () => {
    const events = [];
    sb.showErrorDialog({ message: 'q', actions: [{ label: 'A', onClick: () => events.push('A') }], onCancel: () => events.push('cancel') });
    sb.showErrorDialog({ message: 'something else' });
    sb.showErrorDialog({ message: 'and again' });
    expect(events).toEqual(['cancel']);
  });

  it('a button press does not also count as a cancel', async () => {
    const events = [];
    sb.showErrorDialog({ message: 'q', actions: [{ label: 'A', onClick: () => events.push('A') }], onCancel: () => events.push('cancel') });
    await sb.body.find(e => e.tagName === 'BUTTON' && e.textContent === 'A').click();
    sb.showErrorDialog({ message: 'next' });
    expect(events).toEqual(['A']);
  });

  it('uses English defaults before the locale has loaded', () => {
    const early = makeSandbox({ strings: undefined });
    early.window.appStrings = undefined;
    early.showErrorDialog({ message: 'm', details: 'd' });
    expect(early.body.querySelector('.error-report-title').textContent).toBe('Something went wrong');
  });
});

describe('install summary (study-loader.js)', () => {
  const src = read('js/study-loader.js');
  function makeLoader(installedVersions = {}) {
    const loader = {
      dialogs: [],
      window: { appAboutData: { appVersion: '0.6.9' } },
      t: (key, vars) => { let s = en[key]; for (const [k, v] of Object.entries(vars || {})) s = s.replaceAll(`{${k}}`, v); return s; },
      localStorage: { getItem: k => { const id = k.replace('bsr_studyver_', ''); return id in installedVersions ? String(installedVersions[id]) : null; } },
      safeSetItem() {},
      showErrorDialog: o => loader.dialogs.push(o),
    };
    vm.createContext(loader);
    vm.runInContext(slice(src, 'function _versionString(', '// Decides, for the SILENT installers'), loader);
    vm.runInContext(slice(src, 'function _quietInstallResult(', '// Installs a single .estudy File object'), loader);
    vm.runInContext(slice(src, '// One line of the summary', '// Processes a bundle zip'), loader);
    return loader;
  }
  const data = (v, title = 'Theology') => ({ studyMetadata: { title, studyVersion: v } });

  it('says which of "same version" and "file is older" applies, and gives both numbers', () => {
    const l = makeLoader({ a: 1.5, b: 1.2 });
    const same = l._quietSkipResult(data(1.5), 'a', 'a.estudy');
    const older = l._quietSkipResult(data(1.1), 'b', 'b.estudy');
    expect(same.status).toBe('unchanged');
    expect(older.status).toBe('older');
    expect(l._installResultLine(same).text).toBe('Theology: you already have this version (v1.5), so nothing was changed.');
    expect(l._installResultLine(older).text).toBe('Theology: not installed. You already have v1.2, and this file is v1.1.');
  });

  it('explains a file that could not be installed', () => {
    const l = makeLoader();
    const noJson = l._quietInstallResult('failed', null, '', 'x.estudy', { reason: 'no_study_json' });
    const noId = l._quietInstallResult('failed', {}, '', 'y.estudy', { reason: 'no_study_id' });
    const thrown = { status: 'failed', name: 'z.estudy', reason: 'Unexpected end of JSON input' };
    expect(l._installResultLine(noJson).text).toBe('x.estudy: could not be installed (no study file inside it).');
    expect(l._installResultLine(noId).text).toBe('y.estudy: could not be installed (its study ID is missing or invalid).');
    expect(l._installResultLine(thrown).text).toBe('z.estudy: could not be installed (Unexpected end of JSON input).');
  });

  it('shows no dialog when everything went in, and counts installs and updates', () => {
    const l = makeLoader();
    const r = [l._quietInstallResult('installed', data(1), 's1', 'a'), l._quietInstallResult('updated', data(2), 's2', 'b')];
    expect(l._summariseInstall(r)).toEqual({ installed: 2, allGood: true });
    expect(l.dialogs).toHaveLength(0);
  });

  it('shows a dialog listing every file when any was not installed, with details to copy', () => {
    const l = makeLoader({ s2: 1.5 });
    const r = [
      l._quietInstallResult('installed', data(1, 'One'), 's1', 'one.estudy'),
      l._quietSkipResult(data(1.5, 'Two'), 's2', 'two.estudy'),
      { status: 'failed', name: 'three.estudy', reason: 'bad zip' },
    ];
    expect(l._summariseInstall(r)).toEqual({ installed: 1, allGood: false });
    expect(l.dialogs).toHaveLength(1);
    const d = l.dialogs[0];
    expect(d.lines.map(x => x.ok)).toEqual([true, false, false]);
    expect(d.details).toContain('Bible Study Reader 0.6.9');
    expect(d.details).toContain('unchanged: two.estudy | s2 | file v1.5 | installed v1.5');
    expect(d.details).toContain('failed: three.estudy | bad zip');
  });
});

describe('wiring', () => {
  const loader = read('js/study-loader.js');

  it('error-report.js is the first script in both index.html copies', () => {
    for (const html of [read('index.html'), readFileSync(join(APP, '../index.html'), 'utf8')]) {
      const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
      expect(scripts[0]).toBe('js/error-report.js');
    }
  });

  it('opening a study from the library reports failures in a dialog', () => {
    expect(loader).toMatch(/async function activateStudy\(id\) \{\s*try \{\s*await _activateStudyUnsafe\(id\);\s*\} catch \(err\) \{\s*reportError\(err, \{\s*context: 'open-study'/);
  });

  it('every file-loading entry point reports through _reportLoadError', () => {
    expect(loader.match(/_reportLoadError\(/g).length).toBeGreaterThanOrEqual(5);
    expect(loader).not.toContain("showPickerError(t('studyloader_error_load_file'");
    expect(loader).not.toContain("showPickerError(t('studyloader_error_load_json'");
  });

  it('multi-file picks and bundles collect results instead of counting', () => {
    expect(loader).toContain('results.push(await _installStudyFileQuietly(file));');
    expect(loader).toContain('results.push(await _installStudyFileQuietly(innerFile));');
    expect(loader).not.toMatch(/\binstalled\+\+;/);
    expect(loader.match(/= _summariseInstall\(results\)/g)).toHaveLength(2);
  });

  it('a chapter item that cannot be drawn is reported and marked, and the chapter still renders', () => {
    const rc = read('js/render-chapter.js');
    expect(rc).toContain("context: 'render-element'");
    expect(rc).toContain('class="element-error"');
    expect(rc).toContain('escapeHtml(err.message)');
  });

  it('every errorreport_* string used in code exists in ui_en.json', () => {
    const used = new Set();
    for (const f of ['js/error-report.js', 'js/study-loader.js', 'js/render-chapter.js']) {
      for (const m of read(f).matchAll(/['"`](errorreport_[a-z_]+)['"`]/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(10);
    for (const key of used) expect(en[key], key).toBeTypeOf('string');
  });
});
