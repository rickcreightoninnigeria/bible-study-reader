/**
 * Settings → Diagnostics (diagnostics.js).
 *
 * The real file is run whole in a vm sandbox with a fake study store,
 * localStorage, navigator and the real English strings. Wiring into Settings is
 * checked by reading the source, as in the other tests.
 *
 * Paths are relative to testing/tests/ — source files are in ../../app/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, '../../app');
const read = f => readFileSync(join(APP, f), 'utf8');
const en = JSON.parse(read('js/locales/en/ui_en.json'));

function makeSandbox({ registry = [], versions = {}, studies = {}, idbFails = false, log = [], features = {} } = {}) {
  const ls = { study_registry: JSON.stringify(registry) };
  for (const [id, v] of Object.entries(versions)) ls['bsr_studyver_' + id] = String(v);
  const sandbox = {
    window: { appAboutData: { appVersion: '0.6.9', estudyVersion: '3' }, appLocale: 'ha', activeStudyId: 'demo', devicePixelRatio: 2, matchMedia: () => ({ matches: false }), speechSynthesis: {} },
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 9; Tecno) Chrome/68.0.3440.91 Mobile Safari/537.36', platform: 'Linux armv8l', languages: ['ha', 'en'], onLine: true,
      storage: { estimate: async () => ({ usage: 5 * 1048576, quota: 500 * 1048576 }), persisted: async () => false },
      clipboard: { writeText: async () => {} }, ...features },
    screen: { width: 360, height: 640 },
    innerWidth: 360, innerHeight: 560,
    localStorage: {
      getItem: k => (k in ls ? ls[k] : null),
      setItem: (k, v) => { ls[k] = String(v); },
      removeItem: k => { delete ls[k]; },
      key: i => Object.keys(ls)[i],
      get length() { return Object.keys(ls).length; },
    },
    indexedDB: {},
    StudyIDB: { get: async key => {
      if (idbFails) throw Object.assign(new Error('IDB blocked'), { name: 'IDBUnavailable' });
      return studies[key.replace('study_content_', '')];
    } },
    getInterfaceMode: () => 'basic',
    getErrorLog: () => log,
    formatErrorDetails: e => `DETAILS ${e.message}`,
    escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    t: (key, vars) => { let s = en[key]; if (s === undefined) throw new Error('missing string ' + key); for (const [k, v] of Object.entries(vars || {})) s = s.replaceAll(`{${k}}`, v); return s; },
    JSZip: function () {}, DOMPurify: {}, markdownit: function () {}, Swal: {},
    _erCopy: async () => true,
    document: { getElementById: () => null },
    console,
  };
  sandbox.Intl = Intl;
  vm.createContext(sandbox);
  vm.runInContext(read('js/diagnostics.js'), sandbox, { filename: 'diagnostics' });
  return sandbox;
}

const study = (version, title = 'Theology') => ({ studyMetadata: { title, studyVersion: version, estudyFileVersion: 3 }, chapters: [{}, {}] });

describe('collectDiagnostics', () => {
  it('reads app, device, storage and installed studies', async () => {
    const sb = makeSandbox({ registry: ['a'], versions: { a: 1.2 }, studies: { a: study(1.2) } });
    const info = await sb.collectDiagnostics();
    expect(info.app).toMatchObject({ version: '0.6.9', fileFormat: '3', uiLanguage: 'ha', interfaceMode: 'basic', activeStudy: 'demo' });
    expect(info.device).toMatchObject({ chrome: '68.0.3440.91', android: '9', screen: '360x640', online: true });
    expect(info.storage).toEqual({ usage: 5 * 1048576, quota: 500 * 1048576, persisted: false });
    expect(info.studies.studies).toEqual([{ id: 'a', title: 'Theology', recorded: '1.2', contentVersion: '1.2', fileFormat: '3', chapters: 2, issues: [] }]);
  });

  it('flags the study problems that make an update misbehave', async () => {
    const sb = makeSandbox({
      registry: ['gone', 'drift', 'norecord'],
      versions: { drift: 1.9 },
      studies: { drift: study(1.2), norecord: study(1) },
    });
    const rows = Object.fromEntries((await sb.collectDiagnostics()).studies.studies.map(r => [r.id, r.issues]));
    expect(rows).toEqual({ gone: ['no_content'], drift: ['version_mismatch'], norecord: ['no_record'] });
  });

  it('does not report a version record left by a deleted study: it no longer blocks anything', async () => {
    const sb = makeSandbox({ registry: ['a'], versions: { a: 1, deleted_one: 2.5 }, studies: { a: study(1) } });
    expect((await sb.collectDiagnostics()).studies.orphans).toBeUndefined();
  });

  it('reads "1.10" as recorded; a different saved version is a mismatch, the same number is not', async () => {
    const sb = makeSandbox({ registry: ['a', 'b'], versions: { a: '1.10', b: '1.10' }, studies: { a: study('1.1'), b: study('1.09') } });
    sb.compareStudyVersions = (x, y) => (parseFloat(x) === parseFloat(y) ? 0 : 1);     // stand-in for the loader's comparison
    const rows = Object.fromEntries((await sb.collectDiagnostics()).studies.studies.map(r => [r.id, r.issues]));
    expect(rows).toEqual({ a: [], b: ['version_mismatch'] });
  });

  it('keeps going when one section fails: the rest are still reported', async () => {
    const sb = makeSandbox({ registry: ['a'], idbFails: true });
    sb.navigator.storage.estimate = async () => { throw new Error('no estimate'); };
    const info = await sb.collectDiagnostics();
    expect(info.storage.error).toBe('no estimate');
    expect(info.app.version).toBe('0.6.9');
    expect(info.studies.studies[0].issues).toEqual(['unreadable']);
    expect(info.features.find(f => f.key === 'idbProbe').ok).toBe(false);
  });

  it('tests real capabilities, and treats the optional ones as optional', async () => {
    const sb = makeSandbox();
    const f = Object.fromEntries((await sb.collectDiagnostics()).features.map(x => [x.key, x]));
    expect(f.idb.ok && f.idbProbe.ok && f.ls.ok && f.libs.ok).toBe(true);
    expect(f.share.ok).toBe(false);                                   // no navigator.share in this fake
    expect(f.share.optional && f.speech.optional && f.clipboard.optional && f.segmenter.optional && f.unicode.optional).toBe(true);
    expect(f.idb.optional).toBeUndefined();
  });
});

describe('problem count', () => {
  it('counts essential features, study problems and "errors exist" once; not optional features or harmless notes', async () => {
    const quiet = makeSandbox({ registry: ['a'], versions: { a: 1 }, studies: { a: study(1) } });
    expect(quiet.diagnosticsProblemCount(await quiet.collectDiagnostics())).toBe(0);   // share sheet is missing, but optional

    const noisy = makeSandbox({ registry: ['a', 'b'], versions: { a: 1.9 }, studies: { a: study(1.2), b: study(1) },
      log: [{ message: 'x' }, { message: 'y' }] });
    // a: version mismatch (a note, 0) + b: no record (harmless, 0) + errors present (1)
    expect(noisy.diagnosticsProblemCount(await noisy.collectDiagnostics())).toBe(1);
    // a study listed but with no saved content IS a problem
    const missing = makeSandbox({ registry: ['gone'], versions: {}, studies: {} });
    expect(missing.diagnosticsProblemCount(await missing.collectDiagnostics())).toBe(1);
  });
});

describe('the report to copy', () => {
  it('is plain English with everything the author needs, and no answers', async () => {
    const sb = makeSandbox({ registry: ['a'], versions: { a: 1.2, gone: 3 }, studies: { a: study(1.2) },
      log: [{ time: '2026-10-22T10:00:00Z', context: 'open-study', message: 'boom' }] });
    const report = sb.formatDiagnosticsReport(await sb.collectDiagnostics());
    expect(report).toContain('Version: 0.6.9');
    expect(report).toContain('Chrome/WebView: 68.0.3440.91');
    expect(report).toContain('Android: 9');
    expect(report).toContain('a "Theology" | saved v1.2 | record v1.2 | format 3 | 2 chapters');
    expect(report).toContain('Used: 5.0 MB');
    expect(report).toContain('no   Share sheet (optional)');
    expect(report).toContain('DETAILS boom');
    expect(report).not.toMatch(/answer/i);
  });

  it('says so when something could not be gathered, instead of failing', async () => {
    const sb = makeSandbox();
    sb.navigator.storage.estimate = async () => { throw new Error('no estimate'); };
    expect(sb.formatDiagnosticsReport(await sb.collectDiagnostics())).toContain('(could not gather: no estimate)');
  });
});

describe('the page', () => {
  it('shows hostile study titles, ids and error text as text', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const sb = makeSandbox({ registry: [evil], versions: {}, studies: { [evil]: study(1, evil) },
      log: [{ time: '2026-10-22T10:00:00Z', context: evil, message: evil }] });
    const html = sb.renderDiagnosticsHtml(await sb.collectDiagnostics());
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('marks a mismatch and a missing study in the study list, and offers Copy/Refresh/Clear', async () => {
    const sb = makeSandbox({ registry: ['gone', 'drift'], versions: { drift: 1.9 }, studies: { drift: study(1.2) },
      log: [{ time: '2026-10-22T10:00:00Z', message: 'x' }] });
    const html = sb.renderDiagnosticsHtml(await sb.collectDiagnostics());
    expect(html).toContain('content is missing');
    expect(html).toContain('(v1.9) differs from the saved study (v1.2)');
    expect(html).toContain('copyDiagnosticsReport(this)');
    expect(html).toContain('clearDiagnosticsErrors()');
  });

  it('says everything looks fine when it does', async () => {
    const sb = makeSandbox({ registry: ['a'], versions: { a: 1 }, studies: { a: study(1) } });
    expect(sb.renderDiagnosticsHtml(await sb.collectDiagnostics())).toContain('Everything looks fine.');
  });

  it('every diag_* string used in the code exists in ui_en.json', () => {
    const src = read('js/diagnostics.js');
    const keys = new Set([...src.matchAll(/['"`](diag_[a-zA-Z_]+)['"`]/g)].map(m => m[1]));
    for (const m of src.matchAll(/t\('(diag_[a-z_]+)' \+/g)) { /* dynamic prefixes are covered below */ }
    for (const f of ['idb', 'idbProbe', 'ls', 'unicode', 'segmenter', 'clipboard', 'speech', 'share', 'libs']) keys.add('diag_f_' + f);
    for (const i of ['no_content', 'version_mismatch', 'unreadable']) keys.add('diag_issue_' + i);
    expect(keys.size).toBeGreaterThan(30);
    for (const k of keys) if (!k.endsWith('_')) expect(en[k], k).toBeTypeOf('string');
    expect(en.renderpages_tab_diagnostics).toBeTypeOf('string');
  });
});

describe('Report a problem', () => {
  const ADDRESS = 'bible.study.reader@gmail.com';

  it('offers the button and says where the report goes and that nothing is sent automatically', async () => {
    const sb = makeSandbox({ registry: [], studies: {} });
    const html = sb.renderDiagnosticsHtml(await sb.collectDiagnostics());
    expect(html).toContain('reportProblemByEmail(this)');
    expect(html).toContain('Report a problem');
    expect(html).toContain(ADDRESS);
    expect(html).toContain('Nothing is sent until you press Send');
  });

  it('builds a mailto link to the project address with the report in the body', () => {
    const sb = makeSandbox();
    const url = sb.buildReportMailto('LINE ONE\nLINE TWO', '0.6.9');
    expect(url.startsWith(`mailto:${ADDRESS}?subject=`)).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('subject')).toBe('Bible Study Reader problem (v0.6.9)');
    expect(params.get('body')).toContain('Please describe what you were doing');
    expect(params.get('body')).toContain('LINE ONE\nLINE TWO');
  });

  it('keeps the start and the end of a very long report', () => {
    const sb = makeSandbox();
    const report = 'START' + 'x'.repeat(20000) + 'END-OF-ERRORS';
    const out = sb.trimReportForMail(report, 1000);
    expect(out.length).toBeLessThanOrEqual(1000);
    expect(out.startsWith('START')).toBe(true);
    expect(out.endsWith('END-OF-ERRORS')).toBe(true);
    expect(out).toContain('left out');
    expect(sb.trimReportForMail('short', 1000)).toBe('short');
  });

  it('copies the full report, then opens the email app via the Android bridge when there is one', async () => {
    const sb = makeSandbox();
    const copied = [], opened = [];
    sb._erCopy = async text => { copied.push(text); return true; };
    sb.window.Android = { openUrl: u => opened.push(u) };
    const status = { textContent: '' };
    sb.document.getElementById = id => (id === 'diagMailStatus' ? status : null);
    await sb.reportProblemByEmail(null);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain(`mailto:${ADDRESS}`);
    expect(status.textContent).toContain('also copied');
  });

  it('falls back to the address in the message when the copy fails', async () => {
    const sb = makeSandbox();
    sb._erCopy = async () => false;
    sb.window.Android = { openUrl: () => {} };
    const status = { textContent: '' };
    sb.document.getElementById = () => status;
    await sb.reportProblemByEmail(null);
    expect(status.textContent).toContain(ADDRESS);
    expect(status.textContent).not.toContain('also copied');
  });
});

describe('wiring into Settings', () => {
  const rp = read('js/render-pages.js');

  it('adds a last, always-visible Diagnostics tab and fills it after the page is drawn', () => {
    expect(rp).toMatch(/tabs\.push\(\{ id: 'diagnostics'/);
    expect(rp).toContain('diagnostics: tabDiagnostics,');
    expect(rp).toContain("if (activeTab === 'diagnostics') renderDiagnosticsInto('diagnosticsBody');");
  });

  it('diagnostics.js changes nothing: it never writes to or removes from storage except its own probe', () => {
    const src = read('js/diagnostics.js');
    expect(src).not.toMatch(/StudyIDB\.(set|remove|clearAll|delete)/);
    expect(src.match(/localStorage\.(setItem|removeItem)/g)).toHaveLength(2);       // the probe only
    expect(src).not.toMatch(/\.innerHTML\s*=\s*[^;]*(?:message|userAgent)/);
  });
});
