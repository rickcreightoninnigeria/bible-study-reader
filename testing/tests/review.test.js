/**
 * Review (app/js/review.js): the pure logic for the multiple-choice recap, and
 * the validator rules for reviewData (py/validate_study.py check_review).
 * The page itself (DOM) is checked by hand; everything that decides what a
 * reader is shown is here.
 *
 * Paths are relative to testing/tests/ — the app is in ../../app/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SRC = readFileSync(join(ROOT, 'app/js/review.js'), 'utf8');

const sb = { console };
vm.createContext(sb);
vm.runInContext(SRC, sb, { filename: 'review.js' });
const R = sb;

// A repeatable "random": a small linear congruential generator.
function seeded(seed = 1) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

const Q = (id, extra = {}) => ({ id, question: `Question ${id}?`, correct: `Right ${id}`, wrong: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'], ...extra });

describe('reviewPickOptions', () => {
  it('serves the right answer plus exactly three wrong ones, in some order', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const o = R.reviewPickOptions(Q('a'), seeded(seed));
      expect(o).toHaveLength(4);
      expect(o.filter(x => x.correct)).toHaveLength(1);
      expect(o.find(x => x.correct).text).toBe('Right a');
      expect(new Set(o.map(x => x.text)).size).toBe(4);
    }
  });

  it('draws different wrong answers and orders from one draw to the next', () => {
    const seen = new Set();
    const positions = new Set();
    const r = seeded(7);
    for (let i = 0; i < 60; i++) {
      const o = R.reviewPickOptions(Q('a'), r);
      seen.add(o.map(x => x.text).join('|'));
      positions.add(o.findIndex(x => x.correct));
    }
    expect(seen.size).toBeGreaterThan(20);
    expect(positions.size).toBe(4);       // the right answer lands in every position
  });

  it('every wrong answer in the pool gets used over many draws', () => {
    const used = new Set();
    const r = seeded(3);
    for (let i = 0; i < 80; i++) for (const x of R.reviewPickOptions(Q('a'), r)) used.add(x.text);
    expect(used.size).toBe(8);
  });

  it('never shows a wrong answer equal to the right one, or a repeat, ignoring case and spacing', () => {
    const q = Q('a', { wrong: ['RIGHT  a', 'right a', 'x', 'X', 'y', 'z', ''] });
    for (let seed = 1; seed <= 30; seed++) {
      const o = R.reviewPickOptions(q, seeded(seed));
      const keys = o.map(x => x.text.trim().replace(/\s+/g, ' ').toLowerCase());
      expect(new Set(keys).size).toBe(keys.length);
      expect(o.filter(x => !x.correct).every(x => x.text.toLowerCase().replace(/\s+/g, ' ') !== 'right a')).toBe(true);
    }
  });

  it('shows what there is when the pool is small, and always includes the right answer', () => {
    const o = R.reviewPickOptions(Q('a', { wrong: ['only'] }), seeded(1));
    expect(o.map(x => x.text).sort()).toEqual(['Right a', 'only']);
    expect(R.reviewPickOptions(Q('a', { wrong: [] }), seeded(1))).toEqual([{ text: 'Right a', correct: true }]);
  });

  it('does not change the question it is given', () => {
    const q = Q('a');
    const before = JSON.stringify(q);
    R.reviewPickOptions(q, seeded(2));
    expect(JSON.stringify(q)).toBe(before);
  });
});

describe('reviewSelect', () => {
  const pool = Array.from({ length: 12 }, (_, i) => Q(`q${i + 1}`));

  it('keeps the pool order when asked, taking the first n', () => {
    expect(R.reviewSelect(pool, 5, true).map(q => q.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5']);
  });

  it('takes n different questions at random otherwise', () => {
    const got = R.reviewSelect(pool, 8, false, seeded(5));
    expect(got).toHaveLength(8);
    expect(new Set(got.map(q => q.id)).size).toBe(8);
    expect(got.map(q => q.id).join()).not.toBe(pool.slice(0, 8).map(q => q.id).join());
  });

  it('clamps n to the pool, and to at least one', () => {
    expect(R.reviewSelect(pool, 99, true)).toHaveLength(12);
    expect(R.reviewSelect(pool, 0, true)).toHaveLength(1);
    expect(R.reviewSelect([], 5, true)).toEqual([]);
  });
});

describe('reviewBuildPool: automatic questions', () => {
  const labels = {
    about: (n, title) => `What is chapter ${n} about?`,
    which: () => 'Which chapter is this verse from?',
    chapterOption: (n, title) => (title ? `Chapter ${n}: ${title}` : `Chapter ${n}`),
  };
  const chs = [1, 2, 3, 4, 5].map(n => ({ number: n, title: `T${n}`, summary: `Summary ${n}`, verses: [`Verse ${n}a`, `Verse ${n}b`], notWith: [] }));

  it('lists written questions first, then the "about" ones, then the verse ones, in chapter order', () => {
    const pool = R.reviewBuildPool([Q('w1')], { aboutChapter: true, whichChapter: true }, chs, labels);
    expect(pool.map(q => q.id)).toEqual([
      'w1',
      'auto-about-1', 'auto-about-2', 'auto-about-3', 'auto-about-4', 'auto-about-5',
      'auto-which-1-1', 'auto-which-1-2', 'auto-which-2-1', 'auto-which-2-2', 'auto-which-3-1', 'auto-which-3-2',
      'auto-which-4-1', 'auto-which-4-2', 'auto-which-5-1', 'auto-which-5-2',
    ]);
  });

  it('"about": the right answer is that chapter\'s summary and the wrong ones are the other chapters\'', () => {
    const q = R.reviewBuildPool([], { aboutChapter: true }, chs, labels)[1];
    expect(q.question).toBe('What is chapter 2 about?');
    expect(q.correct).toBe('Summary 2');
    expect(q.wrong.sort()).toEqual(['Summary 1', 'Summary 3', 'Summary 4', 'Summary 5']);
  });

  it('"about": reviewNotWith keeps a confusable chapter out of the wrong answers', () => {
    const c = chs.map(x => x.number === 2 ? { ...x, notWith: [3] } : x);
    const q = R.reviewBuildPool([], { aboutChapter: true }, c, labels).find(x => x.id === 'auto-about-2');
    expect(q.wrong).not.toContain('Summary 3');
    expect(q.wrong).toHaveLength(3);
  });

  it('"which chapter": the verse is the quote, the right answer is that chapter, wrong ones are the others', () => {
    const q = R.reviewBuildPool([], { whichChapter: true }, chs, labels)[0];
    expect(q.question).toBe('Which chapter is this verse from?');
    expect(q.quote).toBe('Verse 1a');
    expect(q.correct).toBe('Chapter 1: T1');
    expect(q.wrong).toEqual(['Chapter 2: T2', 'Chapter 3: T3', 'Chapter 4: T4', 'Chapter 5: T5']);
  });

  it('uses at most three verses a chapter', () => {
    const c = chs.map(x => x.number === 1 ? { ...x, verses: ['a', 'b', 'c', 'd', 'e'] } : x);
    expect(R.reviewBuildPool([], { whichChapter: true }, c, labels).filter(q => q.chapter === 1)).toHaveLength(3);
  });

  it('makes no automatic questions for a study of fewer than four chapters', () => {
    expect(R.reviewBuildPool([], { aboutChapter: true, whichChapter: true }, chs.slice(0, 3), labels)).toEqual([]);
  });

  it('skips "about" when too few chapters have a summary, but still makes the verse questions', () => {
    const c = chs.map((x, i) => i < 2 ? x : { ...x, summary: '' });
    const pool = R.reviewBuildPool([], { aboutChapter: true, whichChapter: true }, c, labels);
    expect(pool.some(q => q.id.startsWith('auto-about'))).toBe(false);
    expect(pool.some(q => q.id.startsWith('auto-which'))).toBe(true);
  });

  it('leaves out a written question that has no right answer or no wrong answers', () => {
    const pool = R.reviewBuildPool([Q('ok'), Q('a', { correct: '' }), Q('b', { wrong: [] }), null], {}, [], labels);
    expect(pool.map(q => q.id)).toEqual(['ok']);
  });
});

describe('scoring and the saved best', () => {
  it('bands: all, high, mid, low', () => {
    expect(R.reviewBand(10, 10)).toBe('all');
    expect(R.reviewBand(8, 10)).toBe('high');
    expect(R.reviewBand(5, 10)).toBe('mid');
    expect(R.reviewBand(4, 10)).toBe('low');
    expect(R.reviewBand(0, 0)).toBe('low');
  });

  it('keeps a best score for each number of questions, never lowering it', () => {
    let rec = R.reviewParseRecord(null);
    expect(rec).toEqual({ done: false, best: {} });
    let r = R.reviewApplyResult(rec, 10, 6);
    expect(r.status).toBe('first');
    expect(r.record).toEqual({ done: true, best: { 10: 6 } });
    r = R.reviewApplyResult(r.record, 10, 8);
    expect(r.status).toBe('new');
    expect(r.previous).toBe(6);
    expect(r.record.best[10]).toBe(8);
    r = R.reviewApplyResult(r.record, 10, 8);
    expect(r.status).toBe('matched');
    r = R.reviewApplyResult(r.record, 10, 3);
    expect(r.status).toBe('below');
    expect(r.record.best[10]).toBe(8);
    r = R.reviewApplyResult(r.record, 20, 9);       // another count is a separate best
    expect(r.status).toBe('first');
    expect(r.record.best).toEqual({ 10: 8, 20: 9 });
  });

  it('survives a damaged saved record', () => {
    expect(R.reviewParseRecord('{not json')).toEqual({ done: false, best: {} });
    expect(R.reviewParseRecord(JSON.stringify({ done: true, best: { 10: 'x', 5: 4, bad: -2 } }))).toEqual({ done: true, best: { 5: 4 } });
  });

  it('keys the record under the study id, so deleting the study deletes it', () => {
    expect(R.reviewRecordKey('my_study')).toBe('my_study_review_best');
  });
});

describe('the Contents menu entry and its wiring', () => {
  const read = f => readFileSync(join(ROOT, f), 'utf8');

  it('sits between Study Group and Leaders\' Notes and is guarded by reviewVisibleInMenu()', () => {
    const src = read('app/js/render-progress.js');
    const group = src.indexOf("page: 'group'");
    const review = src.indexOf("page: 'review'");
    const leaders = src.indexOf("page: 'leaders'");
    expect(group).toBeGreaterThan(-1);
    expect(review).toBeGreaterThan(group);
    expect(leaders).toBeGreaterThan(review);
    expect(src).toContain('if (reviewVisibleInMenu())');
  });

  it('is hidden in Basic mode and when the setting is off, shown otherwise', () => {
    const run = (mode, setting, data) => {
      const s = { console, window: { reviewData: data }, appSettings: { showPageReview: setting }, getInterfaceMode: () => mode };
      vm.createContext(s);
      vm.runInContext(SRC, s);
      return s.reviewVisibleInMenu();
    };
    const data = { questions: [Q('a')] };
    expect(run('basic', true, data)).toBe(false);
    expect(run('intermediate', true, data)).toBe(true);
    expect(run('advanced', true, data)).toBe(true);
    expect(run('intermediate', false, data)).toBe(false);
    expect(run('intermediate', undefined, data)).toBe(true);        // on by default
    expect(run('intermediate', true, null)).toBe(false);
    expect(run('intermediate', true, { questions: [] })).toBe(false);
    expect(run('intermediate', true, { auto: { aboutChapter: true } })).toBe(true);
  });

  it('is routed, restored on reload, loaded and cleared with the study, and on by default', () => {
    expect(read('app/js/router.js')).toContain("case 'review':");
    expect(read('app/js/app-init.js')).toContain("case 'review':");
    const loader = read('app/js/study-loader.js');
    expect(loader).toContain('window.reviewData       = data.reviewData       || null;');
    expect(loader).toContain('window.reviewData    = null;');
    expect(read('app/js/settings.js')).toContain('showPageReview     :true');
    expect(read('app/js/render-pages.js')).toContain("tog('showPageReview')");
  });

  it('every review string the code asks for exists in English', () => {
    const en = JSON.parse(read('app/js/locales/en/ui_en.json'));
    const keys = new Set([...SRC.matchAll(/t\(\s*['"`](review_[a-z0-9_]+|main_menu_review)['"`]/g)].map(m => m[1]));
    for (const b of ['all', 'high', 'mid', 'low']) keys.add(`review_band_${b}`);
    expect(keys.size).toBeGreaterThan(20);
    expect([...keys].filter(k => typeof en[k] !== 'string')).toEqual([]);
    expect(typeof en.renderpages_settings_review_label).toBe('string');
    expect(typeof en.renderpages_settings_review_desc).toBe('string');
  });
});

// ── validator ───────────────────────────────────────────────────────────────
const hasPython = spawnSync('python3', ['--version']).status === 0;
const SCRIPT = join(ROOT, 'py/validate_study.py');

function validate(obj) {
  const dir = mkdtempSync(join(tmpdir(), 'bsr-review-'));
  try {
    const file = join(dir, 'study.json');
    writeFileSync(file, JSON.stringify(obj));
    return spawnSync('python3', ['-I', SCRIPT, file], { encoding: 'utf8' }).stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const study = (reviewData, chapterExtra = {}, n = 5) => ({
  studyMetadata: { studyId: 't', studyVersion: 1, language: 'en' },
  chapters: Array.from({ length: n }, (_, i) => ({ chapterNumber: i + 1, chapterTitle: `C${i + 1}`, elements: [], ...chapterExtra })),
  reviewData,
});
const GOOD = (id = 'r1', extra = {}) => ({ id, question: 'What does John say?', correct: 'God is light', wrong: ['God is distant', 'God is hidden', 'God is silent', 'God is a judge only', 'God is unknowable', 'God is far'], chapter: 1, ...extra });

describe.skipIf(!hasPython)('validate_study.py reviewData checks', () => {
  it('accepts a good question', () => {
    const out = validate(study({ questions: [GOOD()] }));
    expect(out).not.toMatch(/review question/);
  });

  it('requires an id, a question and a right answer; rejects duplicate ids and unknown chapters', () => {
    const out = validate(study({ questions: [GOOD('a'), GOOD('a'), GOOD('b', { question: '' }), GOOD('c', { chapter: 9 }), { ...GOOD('d'), id: undefined }] }));
    expect(out).toMatch(/ERROR\s+review question a: duplicate id/);
    expect(out).toMatch(/ERROR\s+review question b: question is missing/);
    expect(out).toMatch(/ERROR\s+review question c: chapter 9 is not a chapter/);
    expect(out).toMatch(/ERROR\s+reviewData.questions\[4\]: id is required/);
  });

  it('needs at least 4 distinct wrong answers, and asks for 6', () => {
    expect(validate(study({ questions: [GOOD('a', { wrong: ['x', 'y', 'z'] })] }))).toMatch(/ERROR\s+review question a: only 3 distinct wrong answers; at least 4/);
    expect(validate(study({ questions: [GOOD('a', { wrong: ['x', 'y', 'z', 'w'] })] }))).toMatch(/warning\s+review question a: 4 wrong answers; 6 or more/);
    expect(validate(study({ questions: [GOOD('a', { wrong: ['x', 'x', 'y', 'z', 'w', 'v', 'u'] })] }))).toMatch(/wrong answer 'x' is listed twice/);
  });

  it('rejects the right answer also listed as wrong', () => {
    const out = validate(study({ questions: [GOOD('a', { wrong: ['God is light', 'b', 'c', 'd', 'e', 'f'] })] }));
    expect(out).toMatch(/ERROR\s+review question a: the right answer 'God is light' is also listed as a wrong answer/);
  });

  it('warns when the right answer is much longer, or much shorter, than every wrong answer', () => {
    const long = validate(study({ questions: [GOOD('a', { correct: 'God is light and in him there is no darkness at all, as John writes', wrong: ['Distant', 'Hidden', 'Silent', 'A judge', 'Unknowable', 'Far away'] })] }));
    expect(long).toMatch(/warning\s+review question a: the right answer is much longer than every wrong answer/);
    const short = validate(study({ questions: [GOOD('a', { correct: 'Light', wrong: ['God is distant and does not speak to us', 'God is hidden from the whole world', 'God is silent and far away from us', 'God is a judge and nothing more at all', 'God is unknowable to every person', 'God is far from every one of us'] })] }));
    expect(short).toMatch(/warning\s+review question a: the right answer is much shorter than every wrong answer/);
    const fair = validate(study({ questions: [GOOD('a', { correct: 'God is light', wrong: ['God is hidden', 'God is silent', 'God is a judge', 'God is distant', 'God is far off', 'God is remote'] })] }));
    expect(fair).not.toMatch(/gives it away/);
  });

  it('warns about wrong answers that are almost the same words', () => {
    const out = validate(study({ questions: [GOOD('a', { wrong: ['God is very far away from us', 'God is far away from us', 'b', 'c', 'd', 'e'] })] }));
    expect(out).toMatch(/almost the same words/);
  });

  it('checks the automatic types and the chapter fields they use', () => {
    const ok = validate(study({ auto: { aboutChapter: true, whichChapter: true } }, { reviewSummary: 'About something', reviewVerses: ['A verse'] }));
    expect(ok).not.toMatch(/ERROR/);
    expect(validate(study({ auto: { aboutChapter: true } }, {}))).toMatch(/only 0 chapters have a reviewSummary/);
    expect(validate(study({ auto: { whichChapter: true } }, {}))).toMatch(/no chapter has reviewVerses/);
    expect(validate(study({ auto: { aboutChapter: true } }, { reviewSummary: 'x' }, 3))).toMatch(/needs at least 4|need at least 4/);
    expect(validate(study({ auto: { aboutChapter: 'yes' } }, {}))).toMatch(/ERROR\s+reviewData.auto.aboutChapter must be true or false/);
    expect(validate(study({ auto: { whichChapter: true } }, { reviewVerses: 'not a list' }))).toMatch(/ERROR\s+chapter 1: reviewVerses must be an array/);
    expect(validate(study({ auto: { aboutChapter: true } }, { reviewSummary: 's', reviewNotWith: [99] }))).toMatch(/ERROR\s+chapter 1: reviewNotWith lists chapter 99/);
  });

  it('rejects a reviewData that is not an object, and warns about an empty one', () => {
    expect(validate(study('nope'))).toMatch(/ERROR\s+reviewData must be an object/);
    expect(validate(study({ questions: [] }))).toMatch(/warning\s+reviewData has no questions/);
  });

  it('in a multilingual study wants numbered slots, falling back to slot 1 with a warning', () => {
    const ml = {
      studyMetadata: { studyId: 't', studyVersion: 1, language1: 'en', language2: 'es' },
      chapters: [{ chapterNumber: 1, elements: [] }],
      reviewData: { questions: [{ id: 'a', question1: 'Q?', correct1: 'Right answer here', wrong1: ['a1', 'b1', 'c1', 'd1', 'e1', 'f1'], question2: 'P?' }] },
    };
    const out = validate(ml);
    expect(out).toMatch(/warning\s+review question a \(language 2\): correct2 is missing \(the app falls back to language 1\)/);
    expect(out).not.toMatch(/ERROR\s+review question/);
    const bad = { ...ml, reviewData: { questions: [{ id: 'a', question: 'Q?', correct: 'R', wrong: ['a', 'b', 'c', 'd'] }] } };
    expect(validate(bad)).toMatch(/ERROR\s+review question a \(language 1\): question1 is missing/);
  });
});
