/**
 * Starred questions in Share and Print: share-print.js is run in a vm sandbox
 * with the real starred.js and the real field-key helpers from state.js.
 *
 *  - Share (text): a starred question starts with a star, answered or not.
 *  - Share all / Print all: a starred question is included even when blank,
 *    and a chapter with only starred questions is not skipped.
 *  - Print: a starred question has a star in its reference bar.
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

const q = (id, ref, text) => ({ elementId: id, ref, text });

function makeSandbox({ records, fieldValues = {} }) {
  const shared = [];
  const chapter = {
    chapterNumber: 1, chapterTitle: 'Running Scared',
    sections: [{ questions: [q('ch01-el02', 'Ex 3:1', 'Who appeared?'), q('ch01-el03', 'Ex 3:2', 'What burned?')] }],
    reflection: ['What scares you?'],
    elements: [{ type: 'question', subtype: 'reflection', elementId: 'ch01-el04', question: 'What scares you?' }],
  };
  const sandbox = {
    console, CSS: { escape: s => s },
    window: { activeStudyId: 's', titlePageData: { title: 'Exodus' }, Android: { share: s => shared.push(s) } },
    appSettings: { shareFormat: 'plain' },
    chapters: [chapter], currentChapter: 0,
    t: k => k,
    studyText: (el, f) => el[f],
    escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    resolveLanguage: () => 'en',
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    expandInlineMarkers: h => h,
    globalNotesIDBKey: id => `${id}_global_notes`,
    StudyIDB: {
      getChapterAnswers: async (_s, n) => records[n] || {},
      getAnswerRaw: async () => '',
    },
    document: {
      documentElement: {},
      querySelector: sel => {
        const m = sel.match(/data-type="(\w)"\]\[data-index="([^"]+)"/);
        const v = m && fieldValues[`${m[1]}_${m[2]}`];
        return v === undefined ? null : { value: v };
      },
    },
  };
  vm.createContext(sandbox);
  // Real helpers: field keys from state.js, isStarredFromCache from starred.js.
  const state = read('js/state.js');
  const keyFns = ['answerFieldKey', 'likertFieldKey', 'starFieldKey'].map(n => {
    const a = state.indexOf(`function ${n}(`);
    return state.slice(a, state.indexOf('\n}\n', a) + 3);
  }).join('\n');
  vm.runInContext(keyFns, sandbox, { filename: 'state-keys' });
  const starred = read('js/starred.js');
  const a = starred.indexOf('function isStarredFromCache(');
  vm.runInContext(starred.slice(a, starred.indexOf('\n}\n', a) + 3), sandbox, { filename: 'starred-read' });
  vm.runInContext(read('js/share-print.js'), sandbox, { filename: 'share-print.js' });
  sandbox.__shared = shared;
  return sandbox;
}

const STAR = '⭐ ';

describe('Share chapter', () => {
  it('puts a star at the start of a starred question, answered or not', async () => {
    const sb = makeSandbox({
      records: { 1: { 'star_ch01-el02': '1', 'star_ch01-el03': '1' } },
      fieldValues: { 'q_ch01-el02': 'God did' },
    });
    await sb.shareAnswers();
    const report = sb.__shared[0];
    expect(report).toContain(`${STAR}shareprint_label_ref Ex 3:1`);
    expect(report).toContain(`${STAR}shareprint_label_ref Ex 3:2`);
  });

  it('leaves unstarred questions and reflections exactly as before', async () => {
    const sb = makeSandbox({ records: { 1: { 'star_ch01-el03': '1' } } });
    await sb.shareAnswers();
    const lines = sb.__shared[0].split('\n');
    expect(lines).toContain('shareprint_label_ref Ex 3:1');
    expect(lines).toContain(`${STAR}shareprint_label_ref Ex 3:2`);
    expect(lines).toContain('shareprint_label_q What scares you?');
  });

  it('stars a starred reflection on its Q line', async () => {
    const sb = makeSandbox({ records: { 1: { 'star_ch01-el04': '1' } } });
    await sb.shareAnswers();
    expect(sb.__shared[0]).toContain(`${STAR}shareprint_label_q What scares you?`);
    expect(sb.__shared[0]).not.toContain(`${STAR}shareprint_label_ref`);
  });

  it('still shares, without stars, when the IDB read fails', async () => {
    const sb = makeSandbox({ records: {}, fieldValues: { 'q_ch01-el02': 'God did' } });
    sb.StudyIDB.getChapterAnswers = async () => { throw new Error('idb'); };
    await sb.shareAnswers();
    expect(sb.__shared[0]).toContain('God did');
    expect(sb.__shared[0]).not.toContain('⭐');
  });

  it('still includes notes from the same record', async () => {
    const sb = makeSandbox({ records: { 1: { notes_0: 'My note' } } });
    await sb.shareAnswers();
    expect(sb.__shared[0]).toContain('My note');
  });
});

describe('Share all answers', () => {
  it('includes a starred question that has no answer, marked as unanswered', async () => {
    const sb = makeSandbox({ records: { 1: { 'q_ch01-el02': 'God did', 'star_ch01-el03': '1' } } });
    await sb.exportStudyAnswers();
    const report = sb.__shared[0];
    expect(report).toContain('shareprint_label_ref Ex 3:1');
    expect(report).toContain(`${STAR}shareprint_label_ref Ex 3:2`);
    expect(report).toContain('shareprint_label_a shareprint_no_answer');
  });

  it('omits an unstarred question that has no answer', async () => {
    const sb = makeSandbox({ records: { 1: { 'q_ch01-el02': 'God did' } } });
    await sb.exportStudyAnswers();
    expect(sb.__shared[0]).not.toContain('Ex 3:2');
  });

  it('includes a starred reflection with no answer, and does not skip a chapter that has only stars', async () => {
    const sb = makeSandbox({ records: { 1: { 'star_ch01-el04': '1' } } });
    await sb.exportStudyAnswers();
    expect(sb.__shared).toHaveLength(1);
    expect(sb.__shared[0]).toContain(`${STAR}shareprint_label_q What scares you?`);
  });
});

describe('Print', () => {
  const printed = sb => {
    const out = [];
    sb.window.Android = { printContent: h => out.push(h) };
    return out;
  };

  it('puts a star in the reference bar of a starred question only', async () => {
    const sb = makeSandbox({ records: { 1: { 'star_ch01-el03': '1', 'q_ch01-el03': 'A bush' } } });
    const out = printed(sb);
    await sb.printChapter();
    const html = out[0];
    const bars = html.match(/<div class="question-ref">.*?<\/div>/g);
    expect(bars).toHaveLength(3);
    expect(bars[0]).not.toContain('q-star');
    expect(bars[1]).toContain('Ex 3:2');
    expect(bars[1]).toContain('class="q-star"');
    expect(bars[1]).toContain('<svg');
    expect(bars[1]).toContain('renderchapter_star_btn_starred');
    expect(bars[2]).not.toContain('q-star');
  });

  it('stars a starred reflection', async () => {
    const sb = makeSandbox({ records: { 1: { 'star_ch01-el04': '1' } } });
    const out = printed(sb);
    await sb.printChapter();
    const bars = out[0].match(/<div class="question-ref">.*?<\/div>/g);
    expect(bars[2]).toContain('shareprint_print_reflection_label');
    expect(bars[2]).toContain('q-star');
  });

  it('styles the star in the print stylesheet', async () => {
    const sb = makeSandbox({ records: {} });
    const out = printed(sb);
    await sb.printChapter();
    expect(out[0]).toContain('.q-star {');
  });

  it('prints a chapter that has only stars when printing all', async () => {
    const sb = makeSandbox({ records: { 1: { 'star_ch01-el03': '1' } } });
    const out = printed(sb);
    await sb.printAllChapters();
    expect(out[0]).toContain('shareprint_print_chapter_h2');
    expect(out[0]).toContain('class="q-star"');
  });

  it('still skips a chapter with nothing saved or starred', async () => {
    const sb = makeSandbox({ records: { 1: {} } });
    const out = printed(sb);
    await sb.printAllChapters();
    expect(out[0]).not.toContain('shareprint_print_chapter_h2');
  });

  it('does not star the blank-study print', () => {
    const sb = makeSandbox({ records: {} });
    const out = printed(sb);
    sb.printBlankStudy();
    expect(out[0]).not.toContain('q-star"');
  });
});
