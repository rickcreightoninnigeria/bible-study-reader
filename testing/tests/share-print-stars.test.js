/**
 * Starred questions in Share and Print: share-print.js is run in a vm sandbox
 * with the real starred.js and the real field-key helpers from state.js.
 *
 *  - Share (text): a starred question starts with a star, answered or not.
 *  - Share all / Print all: a starred question is included even when blank,
 *    and a chapter with only starred questions is not skipped.
 *  - Print: a starred question has a star in its reference bar.
 *  - The "All questions / Starred only" choice: asked only when something is
 *    starred, 'starred' leaves out everything but the starred questions, and
 *    Share all / Print all open with a list of the starred questions.
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
    intro: 'Intro text',
    sections: [{ bridge: 'Bridge text', questions: [q('ch01-el02', 'Ex 3:1', 'Who appeared?'), q('ch01-el03', 'Ex 3:2', 'What burned?')] }],
    closing: 'Closing text',
    reflection: ['What scares you?'],
    elements: [{ type: 'question', subtype: 'reflection', elementId: 'ch01-el04', question: 'What scares you?' }],
  };
  const chapter2 = {
    chapterNumber: 2, chapterTitle: 'The Name',
    sections: [{ questions: [q('ch02-el02', 'Ex 3:13', 'What is his name?')] }],
    reflection: [], elements: [],
  };
  const modal = fakeModal();
  const sandbox = {
    console, CSS: { escape: s => s },
    window: { activeStudyId: 's', titlePageData: { title: 'Exodus' }, Android: { share: s => shared.push(s) } },
    appSettings: { shareFormat: 'plain' },
    chapters: [chapter, chapter2], currentChapter: 0,
    ICONS: { starFilled: '<star/>' },
    t: (k, p) => p ? k + JSON.stringify(p) : k,
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
      createElement: () => modal,
      body: { appendChild: o => { modal.appended = o; } },
      addEventListener: (type, fn) => { modal.keyHandler = fn; },
      removeEventListener: () => { modal.keyHandler = null; },
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
  const fns = ['function isStarredFromCache(', 'async function getStarredQuestions('].map(sig => {
    const a = starred.indexOf(sig);
    return starred.slice(a, starred.indexOf('\n}\n', a) + 3);
  }).join('\n');
  vm.runInContext(fns, sandbox, { filename: 'starred-read' });
  vm.runInContext(read('js/share-print.js'), sandbox, { filename: 'share-print.js' });
  sandbox.__shared = shared;
  sandbox.__modal = modal;
  return sandbox;
}

// Stand-in for the chooser overlay that _askStarScope builds.
function fakeModal() {
  const m = {
    created: false, appended: null, removed: false, choice: 'all', handlers: {}, keyHandler: null,
    _html: '',
    set innerHTML(h) { this._html = h; this.created = true; },
    get innerHTML() { return this._html; },
    addEventListener(type, fn) { this.handlers[type] = fn; },
    remove() { this.removed = true; },
    querySelector(sel) {
      if (sel === 'input:checked') return { focus() {} };
      if (sel === 'input[name="starScope"]:checked') return { value: m.choice };
      return null;
    },
    // Tap OK with the given radio selected, or Cancel.
    ok(choice) { m.choice = choice; m.handlers.click({ target: { closest: () => ({ dataset: { act: 'ok' } }) } }); },
    cancel()   { m.handlers.click({ target: { closest: () => ({ dataset: { act: 'cancel' } }) } }); },
    tapOutside() { m.handlers.click({ target: m }); },
  };
  return m;
}
const settle = () => new Promise(r => setTimeout(r, 0));

const STAR = '⭐ ';

describe('Share chapter', () => {
  it('puts a star at the start of a starred question, answered or not', async () => {
    const sb = makeSandbox({
      records: { 1: { 'star_ch01-el02': '1', 'star_ch01-el03': '1' } },
      fieldValues: { 'q_ch01-el02': 'God did' },
    });
    await sb.shareAnswers('all');
    const report = sb.__shared[0];
    expect(report).toContain(`${STAR}shareprint_label_ref Ex 3:1`);
    expect(report).toContain(`${STAR}shareprint_label_ref Ex 3:2`);
  });

  it('leaves unstarred questions and reflections exactly as before', async () => {
    const sb = makeSandbox({ records: { 1: { 'star_ch01-el03': '1' } } });
    await sb.shareAnswers('all');
    const lines = sb.__shared[0].split('\n');
    expect(lines).toContain('shareprint_label_ref Ex 3:1');
    expect(lines).toContain(`${STAR}shareprint_label_ref Ex 3:2`);
    expect(lines).toContain('shareprint_label_q What scares you?');
  });

  it('stars a starred reflection on its Q line', async () => {
    const sb = makeSandbox({ records: { 1: { 'star_ch01-el04': '1' } } });
    await sb.shareAnswers('all');
    expect(sb.__shared[0]).toContain(`${STAR}shareprint_label_q What scares you?`);
    expect(sb.__shared[0]).not.toContain(`${STAR}shareprint_label_ref`);
  });

  it('still shares, without stars, when the IDB read fails', async () => {
    const sb = makeSandbox({ records: {}, fieldValues: { 'q_ch01-el02': 'God did' } });
    sb.StudyIDB.getChapterAnswers = async () => { throw new Error('idb'); };
    await sb.shareAnswers('all');
    expect(sb.__shared[0]).toContain('God did');
    expect(sb.__shared[0]).not.toContain('⭐');
  });

  it('still includes notes from the same record', async () => {
    const sb = makeSandbox({ records: { 1: { notes_0: 'My note' } } });
    await sb.shareAnswers('all');
    expect(sb.__shared[0]).toContain('My note');
  });
});

describe('Share all answers', () => {
  it('includes a starred question that has no answer, marked as unanswered', async () => {
    const sb = makeSandbox({ records: { 1: { 'q_ch01-el02': 'God did', 'star_ch01-el03': '1' } } });
    await sb.exportStudyAnswers('all');
    const report = sb.__shared[0];
    expect(report).toContain('shareprint_label_ref Ex 3:1');
    expect(report).toContain(`${STAR}shareprint_label_ref Ex 3:2`);
    expect(report).toContain('shareprint_label_a shareprint_no_answer');
  });

  it('omits an unstarred question that has no answer', async () => {
    const sb = makeSandbox({ records: { 1: { 'q_ch01-el02': 'God did' } } });
    await sb.exportStudyAnswers('all');
    expect(sb.__shared[0]).not.toContain('Ex 3:2');
  });

  it('includes a starred reflection with no answer, and does not skip a chapter that has only stars', async () => {
    const sb = makeSandbox({ records: { 1: { 'star_ch01-el04': '1' } } });
    await sb.exportStudyAnswers('all');
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
    await sb.printChapter('all');
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
    await sb.printChapter('all');
    const bars = out[0].match(/<div class="question-ref">.*?<\/div>/g);
    expect(bars[2]).toContain('shareprint_print_reflection_label');
    expect(bars[2]).toContain('q-star');
  });

  it('styles the star in the print stylesheet', async () => {
    const sb = makeSandbox({ records: {} });
    const out = printed(sb);
    await sb.printChapter('all');
    expect(out[0]).toContain('.q-star {');
  });

  it('prints a chapter that has only stars when printing all', async () => {
    const sb = makeSandbox({ records: { 1: { 'star_ch01-el03': '1' } } });
    const out = printed(sb);
    await sb.printAllChapters('all');
    expect(out[0]).toContain('shareprint_print_chapter_h2');
    expect(out[0]).toContain('class="q-star"');
  });

  it('still skips a chapter with nothing saved or starred', async () => {
    const sb = makeSandbox({ records: { 1: {} } });
    const out = printed(sb);
    await sb.printAllChapters('all');
    expect(out[0]).not.toContain('shareprint_print_chapter_h2');
  });

  it('does not star the blank-study print', () => {
    const sb = makeSandbox({ records: {} });
    const out = printed(sb);
    sb.printBlankStudy();
    expect(out[0]).not.toContain('q-star"');
  });
});


describe('The "All questions / Starred only" choice', () => {
  const fieldValues = { 'q_ch01-el02': 'God did', 'q_ch01-el03': 'A bush' };
  const records = { 1: { 'star_ch01-el03': '1', 'notes_0': 'My note' } };
  const printed = sb => { const out = []; sb.window.Android = { printContent: h => out.push(h) }; return out; };

  it('is not asked when nothing is starred', async () => {
    const sb = makeSandbox({ records: { 1: {} }, fieldValues });
    await sb.shareAnswers();
    expect(sb.__modal.created).toBe(false);
    expect(sb.__shared[0]).toContain('God did');
  });

  it('is asked when something is starred, with the count and the action name', async () => {
    const sb = makeSandbox({ records, fieldValues });
    const done = sb.shareAnswers();
    await settle();
    const html = sb.__modal.innerHTML;
    expect(html).toContain('shareprint_scope_all');
    expect(html).toContain('shareprint_scope_starred{"count":1}');
    expect(html).toContain('renderchapter_share_btn');
    sb.__modal.ok('all');
    await done;
    expect(sb.__modal.removed).toBe(true);
    expect(sb.__shared[0]).toContain('Ex 3:1');
    expect(sb.__shared[0]).toContain('My note');
  });

  it('shares only the starred questions, with a heading and no notes, when "starred" is chosen', async () => {
    const sb = makeSandbox({ records, fieldValues });
    const done = sb.shareAnswers();
    await settle();
    sb.__modal.ok('starred');
    await done;
    const report = sb.__shared[0];
    expect(report).toContain(`${STAR}shareprint_label_ref Ex 3:2`);
    expect(report).not.toContain('Ex 3:1');
    expect(report).not.toContain('shareprint_reflection_heading');
    expect(report).not.toContain('My note');
    expect(report).toContain(`${STAR}shareprint_starred_summary_heading`);
  });

  it('shares nothing when cancelled, tapped outside, or dismissed with Escape', async () => {
    for (const how of ['cancel', 'tapOutside', 'escape']) {
      const sb = makeSandbox({ records, fieldValues });
      const done = sb.shareAnswers();
      await settle();
      if (how === 'escape') sb.__modal.keyHandler({ key: 'Escape' });
      else sb.__modal[how]();
      await done;
      expect(sb.__shared).toHaveLength(0);
      expect(sb.__modal.removed).toBe(true);
      expect(sb.__modal.keyHandler).toBe(null);
    }
  });

  it('prints only the starred question blocks, with a note, when "starred" is chosen', async () => {
    const sb = makeSandbox({ records });
    const out = printed(sb);
    const done = sb.printChapter();
    await settle();
    expect(sb.__modal.innerHTML).toContain('renderchapter_print_btn');
    sb.__modal.ok('starred');
    await done;
    const html = out[0];
    expect(html.match(/<div class="question-ref">/g)).toHaveLength(1);
    expect(html).toContain('Ex 3:2');
    expect(html).not.toContain('Ex 3:1');
    expect(html).not.toContain('Intro text');
    expect(html).not.toContain('Bridge text');
    expect(html).not.toContain('Closing text');
    expect(html).not.toContain('reflection-heading">');
    expect(html).not.toContain('My note');
    expect(html).toContain('<div class="scope-note">shareprint_starred_summary_heading</div>');
  });

  it('keeps the intro, bridge, closing and notes when "all" is chosen', async () => {
    const sb = makeSandbox({ records });
    const out = printed(sb);
    await sb.printChapter('all');
    expect(out[0]).toContain('Intro text');
    expect(out[0]).toContain('Bridge text');
    expect(out[0]).toContain('Closing text');
    expect(out[0]).toContain('My note');
    expect(out[0]).not.toContain('scope-note">');
  });

  it('prints the starred reflection, with its heading, when only a reflection is starred', async () => {
    const sb = makeSandbox({ records: { 1: { 'star_ch01-el04': '1' } } });
    const out = printed(sb);
    await sb.printChapter('starred');
    expect(out[0]).toContain('reflection-heading">');
    expect(out[0].match(/<div class="question-ref">/g)).toHaveLength(1);
  });
});

describe('Starred summary in Share all and Print all', () => {
  const records = {
    1: { 'q_ch01-el02': 'God did', 'star_ch01-el03': '1', 'star_ch01-el04': '1' },
    2: { 'q_ch02-el02': 'I AM', 'star_ch02-el02': '1' },
  };
  const printed = sb => { const out = []; sb.window.Android = { printContent: h => out.push(h) }; return out; };

  it('Share all opens with the starred questions grouped by chapter', async () => {
    const sb = makeSandbox({ records });
    await sb.exportStudyAnswers('all');
    const report = sb.__shared[0];
    expect(report).toContain(`${STAR}shareprint_starred_summary_heading`);
    // The summary runs from its heading to the first full answer entry.
    const at      = report.indexOf('shareprint_starred_summary_heading');
    const summary = report.slice(at, report.indexOf('shareprint_label_ref'));
    expect(summary).toContain('• Ex 3:2 — What burned?');
    expect(summary).toContain('• starred_reflection_ref{"number":1} — What scares you?');
    expect(summary).toContain('• Ex 3:13 — What is his name?');
    expect(summary).not.toContain('Who appeared?');
  });

  it('Share all has no summary when nothing is starred', async () => {
    const sb = makeSandbox({ records: { 1: { 'q_ch01-el02': 'God did' } } });
    await sb.exportStudyAnswers('all');
    expect(sb.__shared[0]).not.toContain('shareprint_starred_summary_heading');
  });

  it('Share all "starred" lists only starred questions, with no summary of its own', async () => {
    const sb = makeSandbox({ records });
    await sb.exportStudyAnswers('starred');
    const report = sb.__shared[0];
    expect(report).not.toContain('Who appeared?');
    expect(report).not.toContain('God did');
    expect(report).toContain('shareprint_label_ref Ex 3:2');
    expect(report).toContain('shareprint_label_ref Ex 3:13');
    expect(report).not.toContain('• Ex 3:2');
  });

  it('Share all asks first when anything is starred, and stops on cancel', async () => {
    const sb = makeSandbox({ records });
    const done = sb.exportStudyAnswers();
    await settle();
    expect(sb.__modal.innerHTML).toContain('shareprint_scope_starred{"count":3}');
    sb.__modal.cancel();
    await done;
    expect(sb.__shared).toHaveLength(0);
  });

  it('Print all opens with a starred list, then the chapters', async () => {
    const sb = makeSandbox({ records });
    const out = printed(sb);
    await sb.printAllChapters('all');
    const html = out[0];
    expect(html).toContain('class="star-summary"');
    expect(html).toContain('class="h-star"');
    expect(html.indexOf('class="star-summary"')).toBeLessThan(html.indexOf('class="question-block"'));
    expect(html).toContain('<span class="star-summary-ref">Ex 3:2</span> What burned?');
    expect(html).not.toContain('scope-note">');
  });

  it('Print all has no summary when nothing is starred', async () => {
    const sb = makeSandbox({ records: { 1: { 'q_ch01-el02': 'God did' } } });
    const out = printed(sb);
    await sb.printAllChapters('all');
    expect(out[0]).not.toContain('class="star-summary"');
  });

  it('Print all "starred" prints only chapters and questions that are starred, with a note and no summary', async () => {
    const sb = makeSandbox({ records: { 1: { 'q_ch01-el02': 'God did', 'star_ch01-el03': '1' }, 2: { 'q_ch02-el02': 'I AM' } } });
    const out = printed(sb);
    await sb.printAllChapters('starred');
    const html = out[0];
    expect(html).toContain('<div class="scope-note">shareprint_starred_summary_heading</div>');
    expect(html).not.toContain('class="star-summary"');
    expect(html).toContain('Ex 3:2');
    expect(html).not.toContain('Ex 3:1');
    expect(html).not.toContain('Ex 3:13');
    expect(html.match(/<h2>shareprint_print_chapter_h2/g)).toHaveLength(1);
  });
});
