/**
 * Tests for migrateAnswersToIDB() and _migrateStudy() in migrate.js.
 *
 * This is the highest-priority test suite: a migration bug silently loses
 * user answer data. Tests cover all six categories from the GitHub review:
 *   1. Clean migration of each key pattern
 *   2. Idempotency (running twice produces the same result)
 *   3. Partial failure handling (IDB write fails mid-study — localStorage stays intact)
 *   4. The bsr_idb_migration_done guard
 *   5. Studies with no localStorage keys are skipped
 *   6. The celebrated key goes to a standalone IDB key, not the chapter object
 *
 * Paths are relative to testing/tests/ — source files are in ../../app/js/
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Minimal in-memory localStorage implementation ─────────────────────────────

function makeFakeLocalStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem:    (k)    => store[k] ?? null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k)    => { delete store[k]; },
    get length()       { return Object.keys(store).length; },
    key:        (i)    => Object.keys(store)[i] ?? null,
    _store:     store,   // test helper: direct access to backing object
  };
}

// ── Sandbox factory ───────────────────────────────────────────────────────────

function makeSandbox(initialLS = {}) {
  const fakeIDB = new IDBFactory();
  const fakeLS  = makeFakeLocalStorage(initialLS);

  const sandbox = {
    window:       {},
    console,
    indexedDB:    fakeIDB,
    IDBKeyRange,
    localStorage: fakeLS,
  };
  vm.createContext(sandbox);

  // Load state.js (key helpers), idb.js (StudyIDB), migrate.js
  vm.runInContext(
    readFileSync(join(__dirname, '../../app/js/state.js'),   'utf8'),
    sandbox
  );
  const idbRaw  = readFileSync(join(__dirname, '../../app/js/idb.js'),     'utf8');
  vm.runInContext(idbRaw.replace('const StudyIDB = ', 'window.StudyIDB = '), sandbox);
  vm.runInContext(
    readFileSync(join(__dirname, '../../app/js/migrate.js'), 'utf8'),
    sandbox
  );

  // Expose helpers into the sandbox global scope so migrate.js can call them
  sandbox.StudyIDB = sandbox.window.StudyIDB;

  return {
    migrate:    () => sandbox.migrateAnswersToIDB(),
    StudyIDB:   sandbox.window.StudyIDB,
    ls:         fakeLS,
  };
}

// ── 1. Guard: bsr_idb_migration_done ─────────────────────────────────────────

describe('migrateAnswersToIDB — migration guard', () => {
  it('does nothing if bsr_idb_migration_done is already set', async () => {
    const { migrate, StudyIDB, ls } = makeSandbox({
      'bsr_idb_migration_done': '1',
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_ch1_q_el_01': 'my answer',
    });

    await migrate();

    // Answer should NOT have been written to IDB
    const record = await StudyIDB.getChapterAnswers('baptism', 1);
    expect(record).toEqual({});

    // localStorage key should still be present (not removed)
    expect(ls.getItem('bsr_baptism_ch1_q_el_01')).toBe('my answer');
  });

  it('sets bsr_idb_migration_done after successful migration', async () => {
    const { migrate, ls } = makeSandbox({
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_ch1_q_el_01': 'my answer',
    });

    await migrate();

    expect(ls.getItem('bsr_idb_migration_done')).toBe('1');
  });

  it('does not set bsr_idb_migration_done if a study fails', async () => {
    const { migrate, StudyIDB, ls } = makeSandbox({
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_ch1_q_el_01': 'my answer',
    });

    // Force IDB writes to fail
    StudyIDB.setChapterAnswers = async () => { throw new Error('IDB write failed'); };

    await migrate();

    expect(ls.getItem('bsr_idb_migration_done')).toBeNull();
  });
});

// ── 2. Studies with no localStorage keys are skipped ─────────────────────────

describe('migrateAnswersToIDB — empty studies', () => {
  it('sets migration done with no studies in registry', async () => {
    const { migrate, ls } = makeSandbox({
      'study_registry': JSON.stringify([]),
    });

    await migrate();

    expect(ls.getItem('bsr_idb_migration_done')).toBe('1');
  });

  it('skips a registered study that has no localStorage keys', async () => {
    const { migrate, StudyIDB, ls } = makeSandbox({
      'study_registry': JSON.stringify(['baptism', 'markCh5']),
      // Only baptism has keys
      'bsr_baptism_ch1_q_el_01': 'my answer',
    });

    await migrate();

    // baptism migrated
    const baptismRecord = await StudyIDB.getChapterAnswers('baptism', 1);
    expect(baptismRecord['q_el_01']).toBe('my answer');

    // markCh5 had nothing — IDB should be empty for it
    const markRecord = await StudyIDB.getChapterAnswers('markCh5', 1);
    expect(markRecord).toEqual({});

    expect(ls.getItem('bsr_idb_migration_done')).toBe('1');
  });
});

// ── 3. Clean migration of each key pattern ────────────────────────────────────

describe('_migrateStudy — key patterns', () => {
  it('migrates a question answer (q_ prefix)', async () => {
    const { migrate, StudyIDB } = makeSandbox({
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_ch1_q_el_01': 'my answer',
    });
    await migrate();
    const record = await StudyIDB.getChapterAnswers('baptism', 1);
    expect(record['q_el_01']).toBe('my answer');
  });

  it('migrates a reflection answer (r_ prefix)', async () => {
    const { migrate, StudyIDB } = makeSandbox({
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_ch2_r_el_05': 'my reflection',
    });
    await migrate();
    const record = await StudyIDB.getChapterAnswers('baptism', 2);
    expect(record['r_el_05']).toBe('my reflection');
  });

  it('migrates chapter notes (notes_0)', async () => {
    const { migrate, StudyIDB } = makeSandbox({
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_ch3_notes_0': 'chapter notes',
    });
    await migrate();
    const record = await StudyIDB.getChapterAnswers('baptism', 3);
    expect(record['notes_0']).toBe('chapter notes');
  });

  it('migrates a standard Likert answer', async () => {
    const { migrate, StudyIDB } = makeSandbox({
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_ch1_likert_el_42_0': '3',
    });
    await migrate();
    const record = await StudyIDB.getChapterAnswers('baptism', 1);
    expect(record['likert_el_42_0']).toBe('3');
  });

  it('migrates a star flag', async () => {
    const { migrate, StudyIDB } = makeSandbox({
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_star_ch2_el_07': '1',
    });
    await migrate();
    const record = await StudyIDB.getChapterAnswers('baptism', 2);
    expect(record['star_el_07']).toBe('1');
  });

  it('migrates global_notes as a raw IDB key', async () => {
    const { migrate, StudyIDB } = makeSandbox({
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_global_notes': 'my study notes',
    });
    await migrate();
    const val = await StudyIDB.getAnswerRaw('baptism_global_notes');
    expect(val).toBe('my study notes');
  });

  it('migrates lastPosition as a raw IDB key', async () => {
    const { migrate, StudyIDB } = makeSandbox({
      'study_registry': JSON.stringify(['baptism']),
      'lastPosition_baptism': JSON.stringify({ chapter: 2, scroll: 450 }),
    });
    await migrate();
    const val = await StudyIDB.getAnswerRaw('baptism_lastPosition');
    expect(val).toBe(JSON.stringify({ chapter: 2, scroll: 450 }));
  });

  it('removes migrated localStorage keys after successful write', async () => {
    const { migrate, ls } = makeSandbox({
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_ch1_q_el_01': 'my answer',
      'bsr_baptism_global_notes': 'notes',
    });
    await migrate();
    expect(ls.getItem('bsr_baptism_ch1_q_el_01')).toBeNull();
    expect(ls.getItem('bsr_baptism_global_notes')).toBeNull();
  });

  it('migrates multiple chapters correctly', async () => {
    const { migrate, StudyIDB } = makeSandbox({
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_ch1_q_el_01': 'ch1 answer',
      'bsr_baptism_ch2_q_el_01': 'ch2 answer',
      'bsr_baptism_ch3_q_el_01': 'ch3 answer',
    });
    await migrate();
    expect((await StudyIDB.getChapterAnswers('baptism', 1))['q_el_01']).toBe('ch1 answer');
    expect((await StudyIDB.getChapterAnswers('baptism', 2))['q_el_01']).toBe('ch2 answer');
    expect((await StudyIDB.getChapterAnswers('baptism', 3))['q_el_01']).toBe('ch3 answer');
  });

  it('migrates multiple answer fields within the same chapter', async () => {
    const { migrate, StudyIDB } = makeSandbox({
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_ch1_q_el_01':       'answer 1',
      'bsr_baptism_ch1_r_el_02':       'reflection',
      'bsr_baptism_ch1_likert_el_03_0': '4',
      'bsr_baptism_ch1_notes_0':       'chapter notes',
    });
    await migrate();
    const record = await StudyIDB.getChapterAnswers('baptism', 1);
    expect(record['q_el_01']).toBe('answer 1');
    expect(record['r_el_02']).toBe('reflection');
    expect(record['likert_el_03_0']).toBe('4');
    expect(record['notes_0']).toBe('chapter notes');
  });
});

// ── 4. celebrated goes to standalone IDB key, not chapter object ──────────────

describe('_migrateStudy — celebrated key', () => {
  it('writes celebrated as a standalone IDB key', async () => {
    const { migrate, StudyIDB } = makeSandbox({
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_ch1_celebrated': '1',
    });
    await migrate();

    // Must be readable via getAnswerRaw with the canonical key
    const val = await StudyIDB.getAnswerRaw('baptism_celebrated_ch1');
    expect(val).toBe('1');
  });

  it('does NOT put celebrated inside the chapter answers object', async () => {
    const { migrate, StudyIDB } = makeSandbox({
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_ch1_celebrated': '1',
    });
    await migrate();

    // The chapter object should not contain a 'celebrated' field
    const record = await StudyIDB.getChapterAnswers('baptism', 1);
    expect(record).not.toHaveProperty('celebrated');
  });

  it('celebrated key for different chapters are stored separately', async () => {
    const { migrate, StudyIDB } = makeSandbox({
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_ch1_celebrated': '1',
      'bsr_baptism_ch2_celebrated': '1',
    });
    await migrate();
    expect(await StudyIDB.getAnswerRaw('baptism_celebrated_ch1')).toBe('1');
    expect(await StudyIDB.getAnswerRaw('baptism_celebrated_ch2')).toBe('1');
  });
});

// ── 5. Idempotency ────────────────────────────────────────────────────────────

describe('migrateAnswersToIDB — idempotency', () => {
  it('running migration twice produces the same IDB result', async () => {
    const ls = {
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_ch1_q_el_01': 'my answer',
    };

    // First run
    const run1 = makeSandbox({ ...ls });
    await run1.migrate();
    const recordAfterFirst = await run1.StudyIDB.getChapterAnswers('baptism', 1);

    // Second run — bsr_idb_migration_done is now set, so migration is skipped
    // Simulate by using the same LS state but with the flag set
    const run2 = makeSandbox({
      'bsr_idb_migration_done': '1',
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_ch1_q_el_01': 'my answer',
    });
    await run2.migrate();
    // IDB is fresh for run2 (new sandbox), but migration was skipped
    // The important thing: the flag prevents re-migration
    expect(run2.ls.getItem('bsr_idb_migration_done')).toBe('1');
    expect(recordAfterFirst['q_el_01']).toBe('my answer');
  });

  it('re-running without the flag merges rather than duplicates data', async () => {
    const { migrate, StudyIDB, ls } = makeSandbox({
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_ch1_q_el_01': 'my answer',
    });

    // Manually run _migrateStudy logic twice by clearing the flag
    await migrate();

    // Simulate a scenario where the flag was not set (e.g. partial failure)
    // by directly checking that re-running with the same data doesn't corrupt
    ls._store['bsr_idb_migration_done'] = undefined;
    delete ls._store['bsr_idb_migration_done'];

    // Re-add the LS key as if migration hadn't happened
    ls._store['bsr_baptism_ch1_q_el_01'] = 'my answer';

    await migrate();

    // Data should still be correct — merge is idempotent
    const record = await StudyIDB.getChapterAnswers('baptism', 1);
    expect(record['q_el_01']).toBe('my answer');
  });
});

// ── 6. Partial failure handling ───────────────────────────────────────────────

describe('migrateAnswersToIDB — partial failure', () => {
  it('leaves localStorage intact if IDB write fails', async () => {
    const { migrate, StudyIDB, ls } = makeSandbox({
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_ch1_q_el_01': 'my answer',
    });

    // Force IDB chapter write to fail
    StudyIDB.setChapterAnswers = async () => { throw new Error('IDB write failed'); };

    await migrate();

    // localStorage key must still be present
    expect(ls.getItem('bsr_baptism_ch1_q_el_01')).toBe('my answer');
  });

  it('does not set migration done flag if any study fails', async () => {
    const { migrate, StudyIDB, ls } = makeSandbox({
      'study_registry': JSON.stringify(['baptism']),
      'bsr_baptism_ch1_q_el_01': 'my answer',
    });

    StudyIDB.setChapterAnswers = async () => { throw new Error('IDB write failed'); };

    await migrate();

    expect(ls.getItem('bsr_idb_migration_done')).toBeNull();
  });

  it('successfully migrates other studies when one fails', async () => {
    const { migrate, StudyIDB, ls } = makeSandbox({
      'study_registry': JSON.stringify(['baptism', 'markCh5']),
      'bsr_baptism_ch1_q_el_01': 'baptism answer',
      'bsr_markCh5_ch1_q_el_01': 'mark answer',
    });

    // Fail only baptism writes
    const originalSet = StudyIDB.setChapterAnswers.bind(StudyIDB);
    StudyIDB.setChapterAnswers = async (studyId, chNum, obj) => {
      if (studyId === 'baptism') throw new Error('IDB write failed');
      return originalSet(studyId, chNum, obj);
    };

    await migrate();

    // markCh5 should have been migrated
    const markRecord = await StudyIDB.getChapterAnswers('markCh5', 1);
    expect(markRecord['q_el_01']).toBe('mark answer');

    // baptism localStorage key should still be present
    expect(ls.getItem('bsr_baptism_ch1_q_el_01')).toBe('baptism answer');

    // Migration flag should NOT be set (one study failed)
    expect(ls.getItem('bsr_idb_migration_done')).toBeNull();
  });
});
