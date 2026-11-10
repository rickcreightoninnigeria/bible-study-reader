/**
 * app/js/backup.js: merging a backup into this device's data, checking a
 * backup file, building one from IndexedDB, and restoring it (studies
 * included). idb.js's per-field change times (record._t) are tested here too,
 * since the merge depends on them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS = f => readFileSync(join(__dirname, '../../app/js', f), 'utf8');

// Node has Blob but no FileReader, which JSZip uses to read Blobs.
class FileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(r => { this.result = r; this.onload && this.onload({ target: this }); },
      e => { this.error = e; this.onerror && this.onerror(e); });
  }
}

function sandbox({ store = {}, android = null } = {}) {
  const storage = { ...store };
  const calls = { fire: [], navigate: [], installs: [], android: [] };
  const localStorage = {
    getItem: k => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: k => { delete storage[k]; },
  };
  const sb = {
    console, Blob, Uint8Array, ArrayBuffer, TextDecoder, Promise, Date, JSON, Math, Number, String, Set, Map, Object, Array,
    setTimeout: () => 0, clearTimeout: () => {}, setImmediate, queueMicrotask, structuredClone, FileReader,
    indexedDB: new IDBFactory(), IDBKeyRange,
    localStorage,
    window: { appAboutData: { appVersion: '9.9.9' }, appLocale: 'en', addEventListener: () => {} },
    document: { addEventListener: () => {}, getElementById: () => null, querySelector: () => null },
    t: (k, vars) => (vars ? `${k} ${JSON.stringify(vars)}` : k),
    escapeHtml: s => String(s),
    safeSetItem: (k, v) => { storage[k] = String(v); },
    showToast: () => {},
    Swal: { fire: async opts => { calls.fire.push(opts); return { isConfirmed: true }; }, isVisible: () => false },
    Router: { navigate: async s => { calls.navigate.push(s); } },
    switchLibTab: () => {},
    initSettings: () => {},
    storageCache: new Map(),
    galleryFileNamesOf: data => (data.gallery || []),
    _installedStudyVersionRaw: id => storage[`bsr_studyver_${id}`] || '',
    _readZipEntry: (entry, type) => entry.async(type),
    _checkZipLimits: () => {},
  };
  if (android) sb.window.Android = android;
  vm.createContext(sb);
  // Object.keys(localStorage) must list the stored keys, as in a browser.
  sb.localStorage = new Proxy(localStorage, {
    ownKeys: () => Object.keys(storage),
    getOwnPropertyDescriptor: (_, k) => (k in storage ? { enumerable: true, configurable: true, value: storage[k] } : undefined),
  });
  vm.runInContext(JS('jszip.min.js'), sb);
  if (!sb.JSZip && sb.window.JSZip) sb.JSZip = sb.window.JSZip;
  vm.runInContext(JS('state.js'), sb);
  vm.runInContext(JS('idb.js').replace('const StudyIDB = ', 'var StudyIDB = '), sb);
  vm.runInContext(JS('backup.js'), sb, { filename: 'backup.js' });
  // The real installer is in study-loader.js; this one records what it was given.
  sb._installStudyFileQuietly = async (ab, name) => {
    const zip = await sb.JSZip.loadAsync(ab);
    const data = JSON.parse(await zip.file('study.json').async('string'));
    const id = data.studyMetadata.studyId;
    calls.installs.push({ name, id, files: Object.keys(zip.files).sort() });
    await sb.StudyIDB.set(`study_content_${id}`, data);
    const reg = JSON.parse(storage.study_registry || '[]');
    if (!reg.includes(id)) { reg.push(id); storage.study_registry = JSON.stringify(reg); }
    return { status: 'installed' };
  };
  return { sb, storage, calls };
}

describe('mergeChapterRecord', () => {
  const { sb } = sandbox();
  const merge = (a, b) => sb.mergeChapterRecord(a, b);

  it('takes the backup copy of a field that changed later there', () => {
    const out = merge({ q_a: 'old', _t: { q_a: 100 } }, { q_a: 'new', _t: { q_a: 200 } });
    expect(out.q_a).toBe('new');
    expect(out._t.q_a).toBe(200);
  });

  it('keeps the local copy of a field that changed later here', () => {
    expect(merge({ q_a: 'mine', _t: { q_a: 300 } }, { q_a: 'theirs', _t: { q_a: 200 } })).toBeNull();
  });

  it('merges field by field', () => {
    const out = merge(
      { q_a: 'local newer', q_b: 'local older', _t: { q_a: 500, q_b: 100 } },
      { q_a: 'backup older', q_b: 'backup newer', q_c: 'only in backup', _t: { q_a: 400, q_b: 200, q_c: 50 } },
    );
    expect(out).toMatchObject({ q_a: 'local newer', q_b: 'backup newer', q_c: 'only in backup' });
  });

  it('applies a later removal (an unstarred question)', () => {
    const out = merge({ star_a: '1', _t: { star_a: 100 } }, { _t: { star_a: 200 } });
    expect('star_a' in out).toBe(false);
  });

  it('without times, fills empty local fields and keeps the rest', () => {
    const out = merge({ q_a: 'mine', q_b: '' }, { q_a: 'theirs', q_b: 'theirs too', q_c: 'new' });
    expect(out).toMatchObject({ q_a: 'mine', q_b: 'theirs too', q_c: 'new' });
  });

  it('restores everything onto an empty device', () => {
    const out = merge(undefined, { q_a: 'x', likert_a_0: '3', _t: { q_a: 1 } });
    expect(out).toMatchObject({ q_a: 'x', likert_a_0: '3' });
  });
});

describe('mergeAnswerEntries', () => {
  const { sb } = sandbox();

  it('keeps the newer global notes, using their time key', () => {
    const w = sb.mergeAnswerEntries(
      { s_global_notes: 'local', s_global_notes_t: 100 },
      { s_global_notes: 'backup', s_global_notes_t: 200 },
    );
    expect(w).toEqual({ s_global_notes: 'backup', s_global_notes_t: 200 });
    expect(sb.mergeAnswerEntries(
      { s_global_notes: 'local', s_global_notes_t: 300 },
      { s_global_notes: 'backup', s_global_notes_t: 200 },
    )).toEqual({});
  });

  it('adds completion flags and positions only where missing', () => {
    const w = sb.mergeAnswerEntries(
      { s_lastPosition: '{"chapterIdx":4}' },
      { s_lastPosition: '{"chapterIdx":1}', s_celebrated_ch2: '1' },
    );
    expect(w).toEqual({ s_celebrated_ch2: '1' });
  });
});

describe('mergeLocalStorageEntries', () => {
  const { sb } = sandbox();
  const local = { lib_pinned: '["a","b"]', appSettings: '{"fontSize":16,"darkMode":false}', featureSeen_x: '1' };
  const get = k => (k in local ? local[k] : null);

  it('joins lists, keeps the backup settings over defaults, and adds missing flags', () => {
    const w = sb.mergeLocalStorageEntries(get, {
      lib_pinned: '["b","c"]',
      appSettings: '{"darkMode":true}',
      featureSeen_x: '0',
      featureSeen_y: '1',
    });
    expect(JSON.parse(w.lib_pinned)).toEqual(['a', 'b', 'c']);
    expect(JSON.parse(w.appSettings)).toEqual({ fontSize: 16, darkMode: true });
    expect(w.featureSeen_x).toBeUndefined();
    expect(w.featureSeen_y).toBe('1');
  });

  it('adds imported pathway groups and keeps the newer version of one in both', () => {
    const mine = { groups: [{ groupId: 'g1', version: 2, n: 'mine' }] };
    const theirs = { groups: [{ groupId: 'g1', version: 1, n: 'old' }, { groupId: 'g2', version: 1 }] };
    const w = sb.mergeLocalStorageEntries(k => (k === 'bsr_importedPathways' ? JSON.stringify(mine) : null),
      { bsr_importedPathways: JSON.stringify(theirs) });
    const groups = JSON.parse(w.bsr_importedPathways).groups;
    expect(groups.map(g => g.groupId)).toEqual(['g1', 'g2']);
    expect(groups[0].n).toBe('mine');
  });
});

describe('validateBackupManifest', () => {
  const { sb } = sandbox();
  const ok = { format: 'bsr-backup', formatVersion: 1, createdAt: 5, answers: {}, localStorage: {}, studies: [] };

  it('rejects files that are not backups, and backups from a newer app', () => {
    expect(() => sb.validateBackupManifest({})).toThrow('backup_restore_bad_file');
    expect(() => sb.validateBackupManifest({ ...ok, formatVersion: 2 })).toThrow('backup_restore_newer_format');
  });

  it('drops malformed records and keys it does not carry', () => {
    const m = sb.validateBackupManifest({
      ...ok,
      answers: {
        s_ch1: { q_a: 'fine', q_b: 7, _t: { q_a: 3, q_b: 'x' } },
        s_ch2: 'not an object',
        'bad key!': 'x',
        s_global_notes: 'notes',
      },
      localStorage: { appSettings: '{}', study_registry: '["evil"]', bsr_studyver_s: '9', featureSeen_a: '1' },
      studies: [{ id: 's', title: 'S', hasAnswers: true }, { id: '../x' }],
    });
    expect(m.answers).toEqual({ s_ch1: { q_a: 'fine', _t: { q_a: 3 } }, s_global_notes: 'notes' });
    expect(Object.keys(m.localStorage).sort()).toEqual(['appSettings', 'featureSeen_a']);
    expect(m.studies.map(s => s.id)).toEqual(['s']);
  });
});

describe('change times in idb.js', () => {
  it('stamps the fields a save changed, and removals too', async () => {
    const { sb } = sandbox();
    await sb.StudyIDB.updateChapterAnswers('s', 1, r => { r.q_a = 'one'; r.star_a = '1'; });
    const first = await sb.StudyIDB.getChapterAnswers('s', 1);
    expect(Object.keys(first._t).sort()).toEqual(['q_a', 'star_a']);
    await new Promise(r => globalThis.setTimeout(r, 5));
    await sb.StudyIDB.updateChapterAnswers('s', 1, r => { delete r.star_a; });
    const second = await sb.StudyIDB.getChapterAnswers('s', 1);
    expect(second._t.q_a).toBe(first._t.q_a);
    expect(second._t.star_a).toBeGreaterThan(first._t.star_a);
    expect('star_a' in second).toBe(false);
  });

  it('leaves the times alone when nothing changed', async () => {
    const { sb } = sandbox();
    await sb.StudyIDB.updateChapterAnswers('s', 1, r => { r.q_a = 'one'; });
    const before = await sb.StudyIDB.getChapterAnswers('s', 1);
    await sb.StudyIDB.updateChapterAnswers('s', 1, r => { r.q_a = 'one'; });
    expect((await sb.StudyIDB.getChapterAnswers('s', 1))._t).toEqual(before._t);
  });
});

describe('backing up and restoring', () => {
  const study = { studyMetadata: { studyId: 'gen', title: 'Genesis' }, chapters: [{ elements: [{ type: 'image', elementId: 'img1' }] }] };

  async function phoneWithData() {
    const env = sandbox({ store: { study_registry: '["gen"]', lib_pinned: '["gen"]', appSettings: '{"darkMode":true}' } });
    await env.sb.StudyIDB.set('study_content_gen', study);
    await env.sb.StudyIDB.setImage('gen_cover', new Blob(['cover']));
    await env.sb.StudyIDB.setImage('gen_img1', new Blob(['picture']));
    await env.sb.StudyIDB.updateChapterAnswers('gen', 1, r => { r.q_q1 = 'In the beginning'; r.star_q1 = '1'; });
    await env.sb.StudyIDB.setAnswerRaw('gen_global_notes', 'my notes');
    return env;
  }

  async function restoreOnNewPhone(blob) {
    const env = sandbox({ store: { appSettings: '{"fontSize":18}' } });
    const zip = await env.sb.JSZip.loadAsync(await blob.arrayBuffer());
    expect(env.sb.isBackupZip(zip)).toBe(true);
    expect(await env.sb.restoreBackupFromZip(zip)).toBe(true);
    return env;
  }

  it('brings answers, notes and settings to a new phone, and lists studies still to install', async () => {
    const old = await phoneWithData();
    const blob = await old.sb.buildBackupBlob();
    const fresh = await restoreOnNewPhone(blob);
    const rec = await fresh.sb.StudyIDB.getChapterAnswers('gen', 1);
    expect(rec).toMatchObject({ q_q1: 'In the beginning', star_q1: '1' });
    expect(await fresh.sb.StudyIDB.getAnswerRaw('gen_global_notes')).toBe('my notes');
    expect(JSON.parse(fresh.storage.appSettings)).toEqual({ fontSize: 18, darkMode: true });
    expect(fresh.storage.lib_pinned).toBe('["gen"]');
    expect(fresh.storage.study_registry).toBeUndefined();          // studies were not included
    expect(fresh.calls.installs).toEqual([]);
    const done = fresh.calls.fire.at(-1);
    expect(done.title).toBe('backup_restore_done');
    expect(done.html).toContain('Genesis');
  });

  it('with "Include studies", packs each study as an .estudy and installs it on restore', async () => {
    const old = await phoneWithData();
    const fresh = await restoreOnNewPhone(await old.sb.buildBackupBlob({ includeStudies: true }));
    expect(fresh.calls.installs).toEqual([
      { name: 'gen.estudy', id: 'gen', files: ['images/', 'images/cover.webp', 'images/img1.webp', 'study.json'] },
    ]);
    expect(fresh.calls.fire.at(-1).html).toBe('');                  // nothing left to install
  });

  it('asks before restoring, and changes nothing when the reader cancels', async () => {
    const old = await phoneWithData();
    const blob = await old.sb.buildBackupBlob();
    const fresh = sandbox();
    fresh.sb.Swal.fire = async opts => { fresh.calls.fire.push(opts); return { isConfirmed: false }; };
    const zip = await fresh.sb.JSZip.loadAsync(await blob.arrayBuffer());
    expect(await fresh.sb.restoreBackupFromZip(zip)).toBe(false);
    expect(fresh.calls.fire[0].title).toBe('backup_restore_confirm_title');
    expect(await fresh.sb.StudyIDB.getAllAnswerEntries()).toEqual([]);
  });
});

describe('reminder', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('starts the clock on first use, then is due after 30 days', () => {
    const { sb, storage } = sandbox();
    expect(sb.backupReminderDue(1000)).toBe(false);
    expect(storage.bsr_backup_reminded_at).toBe('1000');
    expect(sb.backupReminderDue(1000 + 29 * DAY)).toBe(false);
    expect(sb.backupReminderDue(1000 + 30 * DAY)).toBe(true);
  });

  it('counts from the last backup when that is later', () => {
    const { sb } = sandbox({ store: { bsr_backup_reminded_at: '0', bsr_backup_last_at: String(40 * DAY) } });
    expect(sb.backupReminderDue(60 * DAY)).toBe(false);
    expect(sb.backupReminderDue(70 * DAY)).toBe(true);
  });
});

describe('Android automatic backup copy', () => {
  it('is only written when the wrapper offers saveAutoBackup', () => {
    const { sb } = sandbox();
    expect(sb._hasAutoBackupBridge()).toBe(false);
    const withBridge = sandbox({ android: { saveAutoBackup: () => {} } });
    expect(withBridge.sb._hasAutoBackupBridge()).toBe(true);
  });
});
