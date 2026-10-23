/**
 * Single-file install: version comparison and the ask-first flow (study-loader.js).
 *
 * The version helpers, _askVersionConflict, _resolveUserInstall and
 * _announceUpdate are cut out of the loader and run in a vm sandbox with a fake
 * study store, localStorage and dialog. Wiring is checked by reading the source.
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
const src = read('js/study-loader.js');

function slice(from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  expect(a, from).toBeGreaterThan(-1);
  expect(b, to).toBeGreaterThan(a);
  return src.slice(a, b);
}

// store: { studyId: savedStudyData }, records: { studyId: 'recorded version' }
function makeLoader({ store = {}, records = {}, idbError = null } = {}) {
  const ls = Object.fromEntries(Object.entries(records).map(([id, v]) => ['bsr_studyver_' + id, String(v)]));
  const loader = {
    dialogs: [], toasts: [], pickerErrors: [],
    localStorage: {
      getItem: k => (k in ls ? ls[k] : null),
      removeItem: k => { delete ls[k]; },
      raw: ls,
    },
    safeSetItem: (k, v) => { ls[k] = String(v); },
    StudyIDB: { get: async key => { if (idbError) throw idbError; return store[key.replace('study_content_', '')]; } },
    showErrorDialog: o => loader.dialogs.push(o),
    showToast: o => loader.toasts.push(o.message),
    showPickerError: m => loader.pickerErrors.push(m),
    t: (key, vars) => { let s = en[key]; for (const [k, v] of Object.entries(vars || {})) s = s.replaceAll(`{${k}}`, v); return s; },
    // error-report.js's _er: the string if the locale has it, else the default.
    _er: (key, fallback, vars) => { let s = en[key] ?? fallback; for (const [k, v] of Object.entries(vars || {})) s = s.replaceAll(`{${k}}`, v); return s; },
  };
  vm.createContext(loader);
  vm.runInContext(slice('function _versionString(', '// Describes what _installStudyFileQuietly() did'), loader, { filename: 'versions' });
  return loader;
}

const file = (v, extra = {}) => ({ studyMetadata: { studyId: 's', title: 'Theology', studyVersion: v, ...extra } });
const saved = v => file(v);
// The question appears after the (async) store lookup.
const dialogShown = async loader => { for (let i = 0; i < 20 && !loader.dialogs.length; i++) await new Promise(r => setTimeout(r, 0)); };
const press = (loader, label) => { const d = loader.dialogs.at(-1); d.actions.find(a => a.label === label).onClick(); };

describe('compareStudyVersions', () => {
  const l = makeLoader();
  it.each([
    ['1.10', '1.09', 1],           // two-decimal convention: 1.09 then 1.10
    ['1.09', '1.10', -1],
    ['1.1', '1.09', 1],            // 1.1 is the same version as 1.10
    ['1.1', '1.10', 0],
    ['1.0', '1', 0],
    ['2', '1.99', 1],
    ['1.03', '1.04', -1],
    [1.5, '1.5', 0],               // numbers and strings mix (JSON numbers, saved strings)
    [1.5, 1.2, 1],
    ['', '0', 0],
    ['', '1', -1],
    [undefined, '', 0],
    ['v1.2', '1.1', -1],           // no leading digit: counts as 0
  ])('%s vs %s = %i', (a, b, expected) => {
    expect(l.compareStudyVersions(a, b)).toBe(expected);
  });
});

describe('recording the installed version', () => {
  it('keeps it exactly as written, so "1.10" stays "1.10"', () => {
    const l = makeLoader();
    l._setInstalledStudyVersion('s', '1.10');
    expect(l._installedStudyVersionRaw('s')).toBe('1.10');
    l._setInstalledStudyVersion('s', 1.5);
    expect(l._installedStudyVersionRaw('s')).toBe('1.5');
  });

  it('removes the record when the study has no version', () => {
    const l = makeLoader({ records: { s: '2' } });
    l._setInstalledStudyVersion('s', undefined);
    expect(l._installedStudyVersionRaw('s')).toBe('');
  });

  it('reads records written by older app versions (plain numbers)', () => {
    const l = makeLoader({ records: { s: 1.02 } });
    expect(l._installedStudyVersionRaw('s')).toBe('1.02');
    expect(l._getInstalledStudyVersion('s')).toBe(1.02);
  });
});

describe('_shouldInstallStudy (silent installers)', () => {
  it('installs when nothing is recorded, or the file is newer', () => {
    expect(makeLoader()._shouldInstallStudy(file('1'))).toBe('install');
    expect(makeLoader({ records: { s: '1.09' } })._shouldInstallStudy(file('1.10'))).toBe('install');
  });
  it('skips the same or an older version', () => {
    const l = makeLoader({ records: { s: '1.5' } });
    expect(l._shouldInstallStudy(file('1.5'))).toBe('skip');
    expect(l._shouldInstallStudy(file('1.4'))).toBe('skip');
    expect(l._shouldInstallStudy(file('1.4'), { isUserInitiated: true })).toBe('downgrade-blocked');
  });
});

describe('_resolveUserInstall: a study that is not installed', () => {
  it('installs without asking, whatever the version, even if a version record was left behind', async () => {
    const l = makeLoader({ records: { s: '9' } });            // deleted study: record kept, content gone
    expect(await l._resolveUserInstall(file('1.1'), 's')).toEqual({ action: 'install' });
    expect(l.dialogs).toHaveLength(0);
  });
});

describe('_resolveUserInstall: a newer file', () => {
  it('installs without asking, remembering what it replaces', async () => {
    const l = makeLoader({ store: { s: saved('1.2') } });
    expect(await l._resolveUserInstall(file('1.3'), 's')).toEqual({ action: 'install', installed: '1.2' });
    expect(l.dialogs).toHaveLength(0);
  });

  it('1.09 -> 1.10 is an update, and 1.1 counts as 1.10', async () => {
    const l = makeLoader({ store: { s: saved('1.09') } });
    expect((await l._resolveUserInstall(file('1.10'), 's')).action).toBe('install');
    expect(l.dialogs).toHaveLength(0);
  });

  it('trusts the saved study over a drifted record', async () => {
    const l = makeLoader({ store: { s: saved('1.2') }, records: { s: '9' } });   // record says 9, study is 1.2
    expect((await l._resolveUserInstall(file('1.3'), 's')).action).toBe('install');
    expect(l.dialogs).toHaveLength(0);
  });

  it('unversioned on both sides: the new file replaces, no question', async () => {
    const l = makeLoader({ store: { s: saved(undefined) } });
    expect((await l._resolveUserInstall(file(undefined), 's')).action).toBe('install');
    expect(l.dialogs).toHaveLength(0);
  });
});

describe('_resolveUserInstall: the same or an older file asks, with both numbers', () => {
  it('same version: explains, and "Keep what I have" opens the existing copy', async () => {
    const existing = saved('1.5');
    const l = makeLoader({ store: { s: existing } });
    const pending = l._resolveUserInstall(file('1.5'), 's');
    await dialogShown(l);
    const d = l.dialogs.at(-1);
    expect(d.title).toBe('You already have this version');
    expect(d.message).toBe('Theology: you have v1.5, and this file is also v1.5. If you were expecting changes, ask whoever gave you the file for a newer version.');
    expect(d.actions.map(a => a.label)).toEqual(['Install this file anyway', 'Keep what I have']);
    expect(d.actions.find(a => a.primary).label).toBe('Keep what I have');
    press(l, 'Keep what I have');
    expect(await pending).toEqual({ action: 'open-existing', existing });
  });

  it('older version: says so, and "Install this file anyway" installs it', async () => {
    const l = makeLoader({ store: { s: saved('1.12') } });
    const pending = l._resolveUserInstall(file('1.10'), 's');
    await dialogShown(l);
    const d = l.dialogs.at(-1);
    expect(d.title).toBe('This file is older than the one you have');
    expect(d.message).toBe('Theology: you have v1.12, but this file is v1.10, which is older. Keeping the version you have is usually right.');
    press(l, 'Install this file anyway');
    expect(await pending).toEqual({ action: 'install', installed: '1.12' });
  });

  it('a dialog that is replaced counts as "keep", so the loader never hangs', async () => {
    const existing = saved('2');
    const l = makeLoader({ store: { s: existing } });
    const pending = l._resolveUserInstall(file('1'), 's');
    await dialogShown(l);
    l.dialogs.at(-1).onCancel();
    expect(await pending).toEqual({ action: 'open-existing', existing });
  });

  it('a versioned study met by an unversioned file is "older"', async () => {
    const l = makeLoader({ store: { s: saved('1.2') } });
    const pending = l._resolveUserInstall(file(undefined), 's');
    await dialogShown(l);
    expect(l.dialogs.at(-1).message).toContain('this file is v0');
    press(l, 'Keep what I have');
    await pending;
  });
});

describe('storage trouble', () => {
  it('shows the storage error and stops, instead of failing silently', async () => {
    const l = makeLoader({ idbError: Object.assign(new Error('blocked'), { name: 'IDBUnavailable' }) });
    expect(await l._resolveUserInstall(file('1'), 's')).toEqual({ action: 'stop' });
    expect(l.pickerErrors).toHaveLength(1);
  });

  it('any other storage error is rethrown, for the caller to report', async () => {
    const l = makeLoader({ idbError: new Error('disk full') });
    await expect(l._resolveUserInstall(file('1'), 's')).rejects.toThrow('disk full');
  });
});

describe('_announceUpdate', () => {
  it('says "Updating … to vN" only when something is being replaced', () => {
    const l = makeLoader();
    l._announceUpdate(file('1.10'), 's', { action: 'install' });
    expect(l.toasts).toHaveLength(0);
    l._announceUpdate(file('1.10'), 's', { action: 'install', installed: '1.09' });
    expect(l.toasts).toEqual(['Updating Theology to v1.10…']);
  });
});

describe('wiring', () => {
  it('all three single-file paths ask through _resolveUserInstall and handle stop / open-existing', () => {
    expect(src.match(/await _resolveUserInstall\(/g)).toHaveLength(3);
    expect(src.match(/_decision\.action === 'stop'/g)).toHaveLength(3);
    expect(src.match(/_decision\.action === 'open-existing'/g)).toHaveLength(3);
  });

  it('the silent three-second "older version" toast and decimal parsing are gone from the install paths', () => {
    expect(src).not.toContain("studyloader_version_downgrade_blocked");
    expect(src).not.toMatch(/parseFloat\(\w*\.?studyMetadata\??\.studyVersion/);
  });

  it('the recorded version is stored as written, in every install path', () => {
    expect(src.match(/_setInstalledStudyVersion\([^)]*studyVersion\)|_setInstalledStudyVersion\(studyId, installedVer\)/g).length).toBeGreaterThanOrEqual(5);
  });

  it('the title page shows the study file version', () => {
    expect(read('js/render-pages.js')).toContain("t('main_titlepage_study_version'");
    expect(en.main_titlepage_study_version).toContain('{version}');
  });

  it('every versioncheck_* string used exists', () => {
    for (const key of ['same_title', 'older_title', 'same_body', 'older_body', 'keep', 'install_anyway']) {
      expect(en['versioncheck_' + key], key).toBeTypeOf('string');
    }
  });
});
