/**
 * app/js/groups.js: study-group invites and progress reports. Checking
 * files, merging reports into a leader's group, the counts the leader's page
 * shows, and building a member's report from IndexedDB at each of the three
 * levels the member can choose (progress only, starred answers, all answers).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS = f => readFileSync(join(__dirname, '../../app/js', f), 'utf8');

function sandbox() {
  const storage = {};
  const sb = {
    console, Date, JSON, Math, Number, String, Set, Map, Object, Array, Promise, Uint8Array,
    setTimeout: () => 0, clearTimeout: () => {},
    indexedDB: new IDBFactory(), IDBKeyRange,
    localStorage: { getItem: k => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); }, removeItem: k => { delete storage[k]; } },
    window: { crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) % 256; return a; } } },
    crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) % 256; return a; } },
    t: (k, vars) => (vars ? `${k} ${JSON.stringify(vars)}` : k),
    escapeHtml: s => String(s),
    safeSetItem: (k, v) => { storage[k] = String(v); },
  };
  vm.createContext(sb);
  vm.runInContext(JS('state.js'), sb);
  vm.runInContext(JS('idb.js').replace('const StudyIDB = ', 'var StudyIDB = '), sb);
  // Study normalisers and the progress counter the report reuses.
  const loader = JS('study-loader.js');
  for (const fn of ['_plainField', '_extractReflectionQuestions', '_buildSectionsFromElements']) {
    const m = loader.match(new RegExp(`function ${fn}\\([\\s\\S]*?\\n}\\n`));
    if (m) vm.runInContext(m[0], sb);
  }
  if (!sb._plainField) vm.runInContext("function _plainField(o, f) { return o[f] || ''; }", sb);
  const progress = JS('render-progress.js').match(/function _getChapterProgressFromRecord\([\s\S]*?\n}\n/)[0];
  vm.runInContext(progress, sb);
  vm.runInContext(JS('groups.js'), sb, { filename: 'groups.js' });
  return { sb, storage };
}

const GID = 'abcdef123456';
const report = (members, createdAt = 1000) => ({ format: 'bsr-progress', formatVersion: 1, groupId: GID, studyId: 'gen_v001', createdAt, members });
const member = (memberId, name, extra = {}) => ({
  memberId, name, scope: 'progress', lastStudied: 500,
  chapters: [{ chapterNumber: 1, answered: 2, total: 2, starred: ['q1'] }, { chapterNumber: 2, answered: 1, total: 3, starred: [] }],
  answers: {}, ...extra,
});

describe('checking files', () => {
  const { sb } = sandbox();

  it('accepts a good invite and rejects other files', () => {
    const inv = sb.validateGroupInvite({ format: 'bsr-group-invite', formatVersion: 1, groupId: GID, groupName: '  Tuesday   group ', leaderName: 'Rick', studyId: 'gen_v001', studyTitle: 'Genesis' });
    expect(inv).toMatchObject({ groupId: GID, groupName: 'Tuesday group', leaderName: 'Rick' });
    expect(() => sb.validateGroupInvite({ format: 'bsr-backup' })).toThrow('group_err_bad_file');
    expect(() => sb.validateGroupInvite({ format: 'bsr-group-invite', formatVersion: 9, groupId: GID, studyId: 's' })).toThrow('group_err_newer_format');
    expect(() => sb.validateGroupInvite({ format: 'bsr-group-invite', groupId: 'x', studyId: 's' })).toThrow('group_err_bad_file');
  });

  it('cleans a report: bad members, ids and answers are dropped, long answers cut', () => {
    const r = sb.validateProgressReport(report([
      member('mem000001', 'Ada', { scope: 'weird', answers: { q1: 'x'.repeat(30000), 'bad id!': 'y', q2: '   ' } }),
      { memberId: 'no' },
    ]));
    expect(r.members).toHaveLength(1);
    expect(r.members[0].scope).toBe('progress');
    expect(Object.keys(r.members[0].answers)).toEqual(['q1']);
    expect(r.members[0].answers.q1).toHaveLength(20000);
    expect(() => sb.validateProgressReport(report([]))).toThrow('group_err_bad_file');
  });

  it('recognises group files by their format name', () => {
    expect(sb.looksLikeGroupFile('{"format":"bsr-progress"}')).toBe(true);
    expect(sb.looksLikeGroupFile('{"format":"bsr-group-invite"}')).toBe(true);
    expect(sb.looksLikeGroupFile('{"studyMetadata":{}}')).toBe(false);
  });
});

describe('merging reports into a group', () => {
  const { sb } = sandbox();

  it('adds members, replaces a member with a newer report, and skips an older one', () => {
    const group = { groupId: GID, members: {} };
    expect(sb.mergeReportIntoGroup(group, sb.validateProgressReport(report([member('mem000001', 'Ada'), member('mem000002', 'Ben')], 1000)), 5).updated).toEqual(['Ada', 'Ben']);
    const newer = sb.mergeReportIntoGroup(group, sb.validateProgressReport(report([member('mem000001', 'Ada M')], 2000)), 6);
    expect(newer.updated).toEqual(['Ada M']);
    expect(group.members.mem000001.receivedAt).toBe(6);
    const older = sb.mergeReportIntoGroup(group, sb.validateProgressReport(report([member('mem000001', 'Ada')], 1500)), 7);
    expect(older).toEqual({ updated: [], skipped: ['Ada'] });
    expect(sb.groupMembersList(group).map(m => m.name)).toEqual(['Ada M', 'Ben']);
  });

  it('counts stars across members and lists shared answers by question', () => {
    const group = { groupId: GID, members: {} };
    sb.mergeReportIntoGroup(group, sb.validateProgressReport(report([
      member('mem000001', 'Ada', { answers: { q1: 'Ada says' } }),
      member('mem000002', 'Ben'),
    ])));
    expect(sb.groupStarCounts(group).get('q1')).toEqual({ count: 2, names: ['Ada', 'Ben'] });
    expect(sb.groupAnswersFor(group, 'q1')).toEqual([{ name: 'Ada', text: 'Ada says' }]);
    expect(sb.chapterStatus({ answered: 2, total: 2 })).toBe('done');
    expect(sb.chapterStatus({ answered: 1, total: 3 })).toBe('started');
    expect(sb.chapterStatus({ answered: 0, total: 3 })).toBe('none');
  });
});

describe("building a member's report", () => {
  const study = {
    studyMetadata: { studyId: 'gen_v001', studyVersion: '1.2' },
    chapters: [
      { chapterNumber: 1, elements: [
        { type: 'question', subtype: 'standard', elementId: 'q1', question: 'Who made the world?' },
        { type: 'question', subtype: 'standard', elementId: 'q2', question: 'Why?' },
        { type: 'question', subtype: 'reflection', elementId: 'r1', question: 'What will you do?' },
      ] },
      { chapterNumber: 2, elements: [{ type: 'question', subtype: 'standard', elementId: 'q3', question: 'Next?' }] },
    ],
  };
  const membership = { groupId: GID, memberId: 'mem000001', memberName: 'Ada', studyId: 'gen_v001', studyTitle: 'Genesis' };

  async function setUp() {
    const env = sandbox();
    await env.sb.StudyIDB.set('study_content_gen_v001', study);
    await env.sb.StudyIDB.updateChapterAnswers('gen_v001', 1, r => {
      r.q_q1 = 'God'; r.q_q2 = 'Love'; r.r_r1 = 'Pray'; r.star_q2 = '1'; r.notes_0 = 'private notes';
    });
    return env;
  }

  it('progress only: sessions, stars and when last studied, but no answers', async () => {
    const { sb } = await setUp();
    const r = await sb.buildProgressReport(membership, 'progress');
    expect(r.members[0].chapters).toEqual([
      { chapterNumber: 1, answered: 3, total: 3, starred: ['q2'] },
      { chapterNumber: 2, answered: 0, total: 1, starred: [] },
    ]);
    expect(r.members[0].answers).toEqual({});
    expect(r.members[0].lastStudied).toBeGreaterThan(0);
    expect(JSON.stringify(r)).not.toContain('private notes');
    expect(() => sb.validateProgressReport(r)).not.toThrow();
  });

  it('starred: adds only the answers to starred questions', async () => {
    const { sb } = await setUp();
    expect((await sb.buildProgressReport(membership, 'starred')).members[0].answers).toEqual({ q2: 'Love' });
  });

  it('all answers: every question, reflections included, never the notes', async () => {
    const { sb } = await setUp();
    const r = await sb.buildProgressReport(membership, 'all');
    expect(r.members[0].answers).toEqual({ q1: 'God', q2: 'Love', r1: 'Pray' });
    expect(JSON.stringify(r)).not.toContain('private notes');
  });
});

describe('groups store in idb.js', () => {
  it('saves, lists and removes groups, and clearAll empties it', async () => {
    const { sb } = sandbox();
    await sb.StudyIDB.setGroup({ groupId: GID, studyId: 's', members: {} });
    expect((await sb.StudyIDB.getAllGroups()).map(g => g.groupId)).toEqual([GID]);
    await sb.StudyIDB.clearAll();
    expect(await sb.StudyIDB.getGroup(GID)).toBeNull();
    await sb.StudyIDB.setGroup({ groupId: GID, studyId: 's', members: {} });
    await sb.StudyIDB.removeGroup(GID);
    expect(await sb.StudyIDB.getAllGroups()).toEqual([]);
  });
});
