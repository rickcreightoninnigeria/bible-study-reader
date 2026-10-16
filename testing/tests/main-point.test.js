/**
 * Question fields in Briefing 2: keyTerms, mainPoint, mainPointFormat, and the
 * move of sampleAnswer / questionHint out of data-* attributes.
 *
 *  1. renderQuestion(): no study text in attributes; the Main point button
 *     appears only when the question has a mainPoint.
 *  2. validation.js: the question element is found by the card's id and its
 *     fields are resolved (numbered slots, the number 0, hostile values).
 *  3. wireLocalValidateCards(): buttons removed from ineligible cards, enabled
 *     and disabled with the answer.
 *  4. The Main point modal: format handling, size cap, the delegated click.
 *  5. Messages: every t() key the new code uses exists in ui_en.json.
 *
 * Whether the formatted text is made inert (<script>, onerror, javascript: links)
 * is the job of renderFormatted() and safeSetHtml(), which need a real DOM; that
 * is checked in a browser, not here.
 *
 * Paths are relative to testing/tests/ — source files are in ../../app/js/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';
import { makeValidationSandbox, APP_JS } from './helpers/validation-sandbox.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(APP_JS, f), 'utf8');

// ── 1. renderQuestion ─────────────────────────────────────────────────────────
function renderQuestionSandbox() {
  const sandbox = {
    console,
    window: { studyMetadata: {} },
    verseData: {},
    ICONS: new Proxy({}, { get: (_t, k) => `<i data-icon="${String(k)}"></i>` }),
    t: k => k,
    escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    renderFormatted: s => s,
    answerFieldKey: (type, id) => `${type}_${id}`,
    isStarredFromCache: () => false,
    voiceInputAvailable: () => false,
  };
  vm.createContext(sandbox);
  vm.runInContext(read('render-chapter-elements.js'), sandbox, { filename: 'render-chapter-elements.js' });
  return sandbox;
}

function render(el, { answer = '', langMap = {}, activeLang = 'en' } = {}) {
  const sb = renderQuestionSandbox();
  return sb.renderQuestion({
    el: { type: 'question', subtype: 'standard', question: 'Why?', elementId: 'q1', ...el },
    ch: { chapterNumber: 1 }, noPad: '', answerRowInfoHtml: '', activeLang, langMap,
    chapterAnswers: answer ? { q_q1: answer } : {},
  });
}

describe('renderQuestion: no study text in attributes', () => {
  const NASTY = 'A &amp; B "quoted" \'single\' </textarea><img src=x onerror=alert(1)> end';

  it('emits no data-sample-answer, data-question-hint, threshold or skip attribute', () => {
    const html = render({
      sampleAnswer: NASTY, questionHint: NASTY, shortAnswerThreshold: 3, skipBibleVerseCheck: true,
      keyTerms: ['faith', NASTY], mainPoint: 'Point', linkedPassage: 'John 3:16',
    });
    for (const attr of ['data-sample-answer', 'data-question-hint', 'data-short-answer-threshold', 'data-skip-bible-verse-check', 'data-main-point=']) {
      expect(html.includes(attr), attr).toBe(false);
    }
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('keyTerms');
  });

  it('emits no study text for a multilingual question either', () => {
    const html = render({ sampleAnswer1: NASTY, sampleAnswer2: NASTY, questionHint1: NASTY }, { langMap: { en: 1, ha: 2 }, activeLang: 'ha' });
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('data-sample-answer');
  });
});

describe('renderQuestion: Main point button', () => {
  it('is absent when the question has no mainPoint', () => {
    expect(render({})).not.toContain('main-point-btn');
    expect(render({ mainPoint: '   ' })).not.toContain('main-point-btn');
    expect(render({ mainPoint: 42 })).not.toContain('main-point-btn');
    expect(render({ mainPoint: ['x'] })).not.toContain('main-point-btn');
  });

  it('is present, carrying only the element id, when there is a mainPoint', () => {
    const html = render({ mainPoint: 'We are **declared righteous** by faith.' });
    expect(html).toContain('class="main-point-btn"');
    expect(html).toContain('data-main-point-id="q1"');
    expect(html).not.toContain('onclick="openMainPoint');
    expect(html).not.toContain('declared righteous');            // the text itself is not in the page
  });

  it('is disabled until there is an answer, like the validate button', () => {
    expect(render({ mainPoint: 'P' })).toMatch(/class="main-point-btn"[^>]*\sdisabled/);
    expect(render({ mainPoint: 'P' }, { answer: 'My answer' })).not.toMatch(/class="main-point-btn"[^>]*\sdisabled/);
  });

  it('escapes the element id in its own attribute', () => {
    // (Other attributes use the id as-is: sanitizeStudyData already restricts ids to [A-Za-z0-9_.-] at load.)
    const html = render({ elementId: 'q"><script>', mainPoint: 'P' });
    expect(html).toContain('data-main-point-id="q&quot;&gt;&lt;script&gt;"');
  });

  it('follows the active language slot, falling back to slot 1', () => {
    expect(render({ mainPoint1: 'One' }, { langMap: { en: 1, ha: 2 }, activeLang: 'ha' })).toContain('main-point-btn');
    expect(render({ mainPoint2: 'Biyu' }, { langMap: { en: 1, ha: 2 }, activeLang: 'ha' })).toContain('main-point-btn');
    expect(render({ mainPoint1: '', mainPoint2: '' }, { langMap: { en: 1, ha: 2 }, activeLang: 'ha' })).not.toContain('main-point-btn');
  });
});

// ── 2. The element lookup and field resolution in validation.js ──────────────
function validationWith(elements, extra = {}) {
  return makeValidationSandbox({
    chapters: [{ chapterNumber: 1, elements }],
    currentChapter: 0,
    ...extra,
  });
}
const cardFor = (id, text = 'Why?') => ({
  id,
  querySelector: sel => (sel === '.question-text' ? { innerText: text } : null),
  closest: () => null,
});

describe('validation.js finds the question by the card id', () => {
  it('round-trips a sample answer containing &amp;, quotes and </textarea> exactly', () => {
    const NASTY = 'Tom &amp; "Jerry" \'x\' </textarea> <b>bold</b>';
    const sb = validationWith([{ elementId: 'q1', type: 'question', sampleAnswer: NASTY, questionHint: NASTY }]);
    const cfg = sb._lvQuestionConfig(cardFor('q1'));
    expect(cfg.sampleAnswer).toBe(NASTY);
    expect(cfg.questionHint).toBe(NASTY);
  });

  it('uses the source element for a repeatElement card', () => {
    const sb = validationWith([
      { elementId: 'q1', type: 'question', sampleAnswer: 'Original answer', keyTerms: ['faith'] },
      { elementId: 'q9', type: 'question', repeatElement: 'q1' },
    ]);
    const cfg = sb._lvQuestionConfig(cardFor('q1'));
    expect(cfg.sampleAnswer).toBe('Original answer');
    expect(cfg.keyTerms).toEqual(['faith']);
  });

  it('gives empty values when the element cannot be found', () => {
    const sb = validationWith([]);
    const cfg = sb._lvQuestionConfig(cardFor('missing'));
    expect(cfg.sampleAnswer).toBeNull();
    expect(cfg.keyTerms).toBeNull();
    expect(cfg.hasMainPoint).toBe(false);
  });

  it('reports whether a mainPoint exists, without exposing it', () => {
    const sb = validationWith([{ elementId: 'q1', type: 'question', mainPoint: 'SECRET-TEXT' }]);
    const cfg = sb._lvQuestionConfig(cardFor('q1'));
    expect(cfg.hasMainPoint).toBe(true);
    expect(JSON.stringify(cfg)).not.toContain('SECRET-TEXT');
  });
});

describe('numeric fields: 0 must survive', () => {
  const thresholdOf = (el, extra) => validationWith([{ elementId: 'q1', type: 'question', ...el }], extra)._lvQuestionConfig(cardFor('q1')).shortAnswerThreshold;
  const multilingual = {
    buildLangMap: () => ({ en: 1, ha: 2 }),
    getActiveLang: () => 'ha',
    detectAvailableLangs: () => ['en', 'ha'],
    window: { studyMetadata: { language1: 'en', language2: 'ha' } },
  };

  it('keeps a plain 0 and "0"', () => {
    expect(thresholdOf({ shortAnswerThreshold: 0 })).toBe(0);
    expect(thresholdOf({ shortAnswerThreshold: '0' })).toBe(0);
  });

  it('keeps 0 through the numbered-slot fallback (slot → slot 1 → unnumbered)', () => {
    expect(thresholdOf({ shortAnswerThreshold1: 0 }, multilingual)).toBe(0);              // falls back to slot 1
    expect(thresholdOf({ shortAnswerThreshold2: 0, shortAnswerThreshold1: 9 }, multilingual)).toBe(0);
    expect(thresholdOf({ shortAnswerThreshold: 0 }, multilingual)).toBe(0);              // unnumbered
    expect(thresholdOf({ shortAnswerThreshold2: 4, shortAnswerThreshold1: 0 }, multilingual)).toBe(4);
  });

  it('reads ordinary values, and ignores nonsense', () => {
    expect(thresholdOf({ shortAnswerThreshold: 12 })).toBe(12);
    expect(thresholdOf({ shortAnswerThreshold: '7' })).toBe(7);
    expect(thresholdOf({ shortAnswerThreshold: 3.9 })).toBe(3);
    expect(thresholdOf({})).toBeNull();
    expect(thresholdOf({ shortAnswerThreshold: -2 })).toBeNull();
    expect(thresholdOf({ shortAnswerThreshold: 'many' })).toBeNull();
    expect(thresholdOf({ shortAnswerThreshold: null })).toBeNull();
  });

  it('skipBibleVerseCheck accepts true and "true" only', () => {
    const skipOf = v => validationWith([{ elementId: 'q1', type: 'question', skipBibleVerseCheck: v }])._lvQuestionConfig(cardFor('q1')).skipBibleVerseCheck;
    expect(skipOf(true)).toBe(true);
    expect(skipOf('true')).toBe(true);
    for (const v of [false, 'false', 1, 'yes', null, undefined, {}]) expect(skipOf(v)).toBe(false);
  });
});

describe('the whole feedback path', () => {
  const sb = validationWith([
    { elementId: 'q1', type: 'question', keyTerms: ['righteous|justif', 'faith|trust'], mainPoint: 'We are **declared righteous** by faith.' },
    { elementId: 'q2', type: 'question', keyTerms: ['righteous|justif', 'faith|trust'] },
    { elementId: 'q3', type: 'question', sampleAnswer: 'Paul says a person is declared righteous by faith in Christ and not by works.' },
  ]);
  const feedback = (id, answer) => sb._lvFeedbackFor(cardFor(id, 'What does Paul say about how a person is made right with God?'), answer);

  it('uses the tiers, and points to the Main point button when there is one', () => {
    expect(feedback('q1', 'Paul teaches that we are declared righteous through faith, not by our works.')).toBe('validation_lv_strong validation_lv_see_main_point');
    expect(feedback('q1', 'Paul says we are justified by what we do and how we live and love.')).toBe('validation_lv_partial validation_lv_see_main_point');
    expect(feedback('q2', 'Paul teaches that we are declared righteous through faith, not by our works.')).toBe('validation_lv_strong');
    expect(feedback('q2', 'I enjoyed the weather and the sandwiches at our picnic last weekend.')).toBe('validation_lv_off_topic_no_hint');
  });

  it('never says "Well done" without keyTerms', () => {
    const text = feedback('q3', 'Paul teaches that we are declared righteous through faith, not by our works.');
    expect(text).toBe('validation_lv_pass_thematic');
    expect(text).not.toContain('strong');
  });

  it('never throws on hostile field values and returns null if it must', () => {
    const bomb = { toString() { throw new Error('boom'); }, valueOf() { throw new Error('boom'); } };
    const hostile = validationWith([{
      elementId: 'q1', type: 'question', sampleAnswer: bomb, questionHint: bomb, keyTerms: bomb,
      mainPoint: bomb, shortAnswerThreshold: bomb, skipBibleVerseCheck: bomb,
    }]);
    expect(() => hostile._lvFeedbackFor(cardFor('q1'), 'A reasonable answer with several different words in it')).not.toThrow();
    const big = validationWith([{ elementId: 'q1', type: 'question', keyTerms: Array.from({ length: 1e5 }, () => 'a'), sampleAnswer: 'x'.repeat(1e6) }]);
    expect(() => big._lvFeedbackFor(cardFor('q1'), 'A reasonable answer with several different words in it')).not.toThrow();
    const noChapters = makeValidationSandbox({ chapters: undefined });
    expect(() => noChapters._lvFeedbackFor(cardFor('q1'), 'anything at all here please thanks')).not.toThrow();
  });
});

// ── 3. Button wiring ──────────────────────────────────────────────────────────
function fakeCard({ subtype = 'standard', linked = '', withMainPoint = true } = {}) {
  const textarea = { value: '', _fn: null, addEventListener(type, fn) { if (type === 'input') this._fn = fn; } };
  const lv = { disabled: true, removed: false, remove() { this.removed = true; } };
  const mp = withMainPoint ? { disabled: true, removed: false, remove() { this.removed = true; } } : null;
  return {
    dataset: { questionSubtype: subtype, linkedPassage: linked },
    textarea, lv, mp,
    querySelector(sel) {
      if (sel === '.local-validate-btn') return lv;
      if (sel === '.main-point-btn') return mp;
      if (sel === '.answer-field') return textarea;
      return null;
    },
  };
}

describe('wireLocalValidateCards', () => {
  const sb = makeValidationSandbox();
  const wire = cards => sb.wireLocalValidateCards({ querySelectorAll: () => cards });

  it('removes both buttons from ineligible cards (reflection, no passage)', () => {
    const c = fakeCard({ subtype: 'reflection' });
    wire([c]);
    expect(c.lv.removed).toBe(true);
    expect(c.mp.removed).toBe(true);
  });

  it('keeps both on a reflection that has a linked passage (eligible)', () => {
    const c = fakeCard({ subtype: 'reflection', linked: 'John 3:16' });
    wire([c]);
    expect(c.lv.removed).toBe(false);
    expect(c.mp.removed).toBe(false);
  });

  it('enables and disables both buttons as the answer fills and empties', () => {
    const c = fakeCard();
    wire([c]);
    c.textarea.value = 'Something';
    c.textarea._fn();
    expect([c.lv.disabled, c.mp.disabled]).toEqual([false, false]);
    c.textarea.value = '   ';
    c.textarea._fn();
    expect([c.lv.disabled, c.mp.disabled]).toEqual([true, true]);
  });

  it('works on a card with no Main point button', () => {
    const c = fakeCard({ withMainPoint: false });
    expect(() => wire([c])).not.toThrow();
    c.textarea.value = 'x';
    expect(() => c.textarea._fn()).not.toThrow();
    expect(c.lv.disabled).toBe(false);
  });

  it('is not counted as "leaving the answer" when the Main point button is tapped', () => {
    const src = read('validation.js');
    expect(src).toMatch(/_LV_STILL_WORKING_SELECTOR =[\s\S]*?\.main-point-btn/);
  });
});

// ── 4. The modal ──────────────────────────────────────────────────────────────
function modalSandbox(elements) {
  const calls = { footnote: [], formatted: [] };
  const listeners = [];
  const sandbox = {
    console,
    chapters: [{ elements }],
    currentChapter: 0,
    t: k => `[${k}]`,
    studyText: (o, f) => o[f] ?? '',
    renderFormatted: (text, format) => { calls.formatted.push({ text, format }); return `<p>${format}:${text}</p>`; },
    openFootnoteModal: (title, html) => calls.footnote.push({ title, html }),
    document: { addEventListener: (type, fn) => listeners.push({ type, fn }) },
  };
  vm.createContext(sandbox);
  const src = read('modals.js');
  const block = src.slice(src.indexOf('// ── MAIN POINT MODAL'), src.indexOf('// USAGE EXAMPLES FOR INFO TRIGGERS'));
  expect(block.length).toBeGreaterThan(200);
  vm.runInContext(block, sandbox, { filename: 'main-point-block' });
  sandbox.__calls = calls;
  sandbox.__listeners = listeners;
  return sandbox;
}

describe('openMainPointModal', () => {
  it('shows the title, and renders markdown by default', () => {
    const sb = modalSandbox([{ elementId: 'q1', mainPoint: 'We are **declared righteous**.' }]);
    sb.openMainPointModal('q1');
    expect(sb.__calls.formatted).toEqual([{ text: 'We are **declared righteous**.', format: 'markdown' }]);
    expect(sb.__calls.footnote[0].title).toBe('[mainpoint_modal_title]');
  });

  it('honours mainPointFormat in any case, and falls back to markdown for anything else', () => {
    const formatOf = f => {
      const sb = modalSandbox([{ elementId: 'q1', mainPoint: 'x', mainPointFormat: f }]);
      sb.openMainPointModal('q1');
      return sb.__calls.formatted[0].format;
    };
    expect(formatOf('HTML')).toBe('html');
    expect(formatOf('plainText')).toBe('plaintext');
    expect(formatOf('markdown')).toBe('markdown');
    for (const bad of [undefined, null, 5, {}, 'rtf', '<script>', '']) expect(formatOf(bad)).toBe('markdown');
  });

  it('caps the text at 2,000 characters', () => {
    const sb = modalSandbox([{ elementId: 'q1', mainPoint: 'a'.repeat(1e6) }]);
    sb.openMainPointModal('q1');
    expect(sb.__calls.formatted[0].text).toHaveLength(2000);
  });

  it('does nothing for a missing element, an empty or non-string mainPoint, or a bad id', () => {
    const sb = modalSandbox([{ elementId: 'q1', mainPoint: '   ' }, { elementId: 'q2', mainPoint: 42 }, { elementId: 'q3' }]);
    for (const id of ['q1', 'q2', 'q3', 'nope', '', null, undefined, 5, {}]) sb.openMainPointModal(id);
    expect(sb.__calls.footnote).toEqual([]);
  });

  it('finds the source element, not the repeat entry', () => {
    const sb = modalSandbox([{ elementId: 'q1', type: 'question', mainPoint: 'Source' }, { elementId: 'q2', repeatElement: 'q1' }]);
    sb.openMainPointModal('q1');
    expect(sb.__calls.formatted[0].text).toBe('Source');
  });

  it('passes only the rendered result to the modal (which sanitises it again)', () => {
    const sb = modalSandbox([{ elementId: 'q1', mainPoint: '<img src=x onerror=alert(1)>' }]);
    sb.openMainPointModal('q1');
    expect(sb.__calls.footnote[0].html).toBe('<p>markdown:<img src=x onerror=alert(1)></p>');   // the stub renderer; real sanitising is checked in a browser
  });
});

describe('the delegated click listener', () => {
  const click = (sb, target) => sb.__listeners.find(l => l.type === 'click').fn({ target });
  const buttonTarget = (id, disabled = false) => ({ closest: sel => (sel === '.main-point-btn' ? { disabled, dataset: { mainPointId: id } } : null) });

  it('opens the modal for an enabled button', () => {
    const sb = modalSandbox([{ elementId: 'q1', mainPoint: 'P' }]);
    click(sb, buttonTarget('q1'));
    expect(sb.__calls.footnote).toHaveLength(1);
  });

  it('ignores a disabled button, and clicks elsewhere', () => {
    const sb = modalSandbox([{ elementId: 'q1', mainPoint: 'P' }]);
    click(sb, buttonTarget('q1', true));
    click(sb, { closest: () => null });
    click(sb, null);
    click(sb, {});
    expect(sb.__calls.footnote).toEqual([]);
  });
});

// ── 5. Strings ────────────────────────────────────────────────────────────────
describe('new strings', () => {
  const en = JSON.parse(readFileSync(join(APP_JS, 'locales/en/ui_en.json'), 'utf8'));

  it('every key the new code uses exists in ui_en.json', () => {
    const wanted = new Set();
    for (const file of ['validation.js', 'modals.js', 'render-chapter.js', 'render-chapter-elements.js']) {
      for (const m of read(file).matchAll(/\bt\('((?:mainpoint|validation_lv)_[a-z_]+|renderchapter_answer_tools_mainpoint_[a-z]+)'\)/g)) wanted.add(m[1]);
    }
    expect(wanted.size).toBeGreaterThanOrEqual(8);
    for (const key of wanted) expect(en[key], key).toBeTruthy();
  });

  it('the tier messages are neutral except "strong"', () => {
    expect(en.validation_lv_partial).not.toMatch(/well done|great|excellent|perfect/i);
    expect(en.validation_lv_strong).toMatch(/well done/i);
  });
});
