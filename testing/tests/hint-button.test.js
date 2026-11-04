/**
 * The Hint button (key icon) on a question card, the "how to start" message shown
 * when Answer check or Main point is tapped before anything is written, and the
 * pointer to the Hint button in the "picked up part of this" message.
 *
 * Covers: the button's markup, which hint is shown (questionHintFirst while the
 * answer is empty, questionHint once something is written, each standing in for
 * the other), the empty-answer message, the partial-answer step, the toast's
 * icon fallbacks, the key icon in every icon set, and the strings in every locale.
 *
 * Paths are relative to testing/tests/ — source files are in ../../app/js/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import vm from 'vm';
import { join } from 'path';
import { makeValidationSandbox, APP_JS } from './helpers/validation-sandbox.js';

const read = f => readFileSync(join(APP_JS, f), 'utf8');
const LOCALES = join(APP_JS, 'locales');
const load = lang => JSON.parse(readFileSync(join(LOCALES, lang, `ui_${lang}.json`), 'utf8'));

// ── Markup ────────────────────────────────────────────────────────────────────
function render(el, { answer = '', langMap = {}, activeLang = 'en', voice = false } = {}) {
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
    voiceInputAvailable: () => voice,
  };
  vm.createContext(sandbox);
  vm.runInContext(read('render-chapter-elements.js'), sandbox, { filename: 'render-chapter-elements.js' });
  return sandbox.renderQuestion({
    el: { type: 'question', subtype: 'standard', question: 'Why?', elementId: 'q1', ...el },
    ch: { chapterNumber: 1 }, noPad: '', answerRowInfoHtml: '', activeLang, langMap,
    chapterAnswers: answer ? { q_q1: answer } : {},
  });
}

describe('the Hint button in the question card', () => {
  it('is absent when the question has no hint of either kind', () => {
    for (const el of [{}, { questionHint: '   ' }, { questionHintFirst: '' }, { questionHint: 42 }, { questionHint: ['x'] }]) {
      expect(render(el)).not.toContain('hint-btn');
    }
  });

  it('is present for a questionHint, a questionHintFirst, or both', () => {
    for (const el of [{ questionHint: 'H' }, { questionHintFirst: 'F' }, { questionHint: 'H', questionHintFirst: 'F' }]) {
      expect(render(el)).toContain('class="hint-btn"');
    }
  });

  it('follows the active language slot, falling back to slot 1', () => {
    const o = { langMap: { en: 1, ha: 2 }, activeLang: 'ha' };
    expect(render({ questionHint1: 'One' }, o)).toContain('hint-btn');
    expect(render({ questionHintFirst2: 'Biyu' }, o)).toContain('hint-btn');
    expect(render({ questionHint1: '', questionHint2: '' }, o)).not.toContain('hint-btn');
  });

  it('is never dimmed or disabled, even with an empty answer', () => {
    const html = render({ questionHint: 'H' });
    expect(html).toMatch(/class="hint-btn"[^>]*onclick="openHintForCard\(this\)"/);
    expect(html).not.toMatch(/class="hint-btn"[^>]*(disabled|aria-disabled)/);
  });

  it('sits between Answer check and Main point, before the microphone', () => {
    const html = render({ questionHint: 'H', mainPoint: 'P' }, { voice: true });
    const at = c => html.indexOf(`class="${c}"`);
    expect(at('local-validate-btn')).toBeGreaterThan(-1);
    expect(at('hint-btn')).toBeGreaterThan(at('local-validate-btn'));
    expect(at('main-point-btn')).toBeGreaterThan(at('hint-btn'));
    expect(at('mic-btn')).toBeGreaterThan(at('main-point-btn'));
  });

  it('draws the key icon, labelled "Hint", and carries no study text', () => {
    const html = render({ questionHint: '<img src=x onerror=alert(1)>', questionHintFirst: 'SECRET-FIRST' });
    expect(html).toContain('data-icon="hint"');
    expect(html).toContain('aria-label="renderchapter_answer_tools_hint_label"');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('SECRET-FIRST');
  });

  it('dims Answer check and Main point with aria-disabled (not disabled) until there is an answer', () => {
    const empty = render({ mainPoint: 'P' });
    expect(empty).toMatch(/class="local-validate-btn"[^>]*aria-disabled="true"/);
    expect(empty).not.toMatch(/class="local-validate-btn"[^>]*\sdisabled(?!=)/);
    const filled = render({ mainPoint: 'P' }, { answer: 'My answer' });
    expect(filled).not.toMatch(/class="local-validate-btn"[^>]*aria-disabled/);
  });
});

// ── Which hint ────────────────────────────────────────────────────────────────
function validationWith(elements) {
  return makeValidationSandbox({ chapters: [{ chapterNumber: 1, elements }], currentChapter: 0 });
}
function cardFor(id, { value = '', linked = '' } = {}) {
  return {
    id,
    dataset: { linkedPassage: linked },
    querySelector: sel => (sel === '.question-text' ? { innerText: 'Why?' } : sel === '.answer-field' ? { value } : null),
    closest: () => null,
  };
}
// Replaces the toast so the tests see the detail that would be shown.
function capture(sb) {
  const shown = [];
  sb._localValidateShowFeedback = (card, detail) => shown.push(detail);
  return shown;
}
const buttonOn = card => ({ closest: sel => (sel === '.question-card' ? card : null) });

describe('_lvPickHint', () => {
  const sb = validationWith([]);
  const pick = (cfg, empty) => sb._lvPickHint(cfg, empty);

  it('empty answer: questionHintFirst if there is one, else questionHint', () => {
    expect(pick({ questionHintFirst: 'F', questionHint: 'H' }, true)).toBe('F');
    expect(pick({ questionHintFirst: null, questionHint: 'H' }, true)).toBe('H');
  });

  it('answer written: questionHint if there is one, else questionHintFirst', () => {
    expect(pick({ questionHintFirst: 'F', questionHint: 'H' }, false)).toBe('H');
    expect(pick({ questionHintFirst: 'F', questionHint: null }, false)).toBe('F');
  });

  it('no hint: null; a hint with nothing readable counts as absent', () => {
    expect(pick({ questionHintFirst: null, questionHint: null }, true)).toBeNull();
    expect(pick({ questionHintFirst: '-', questionHint: '  \n ' }, false)).toBeNull();
    expect(pick({ questionHintFirst: '*', questionHint: 'H' }, true)).toBe('H');
  });
});

describe('openHintForCard', () => {
  const el = { elementId: 'q1', type: 'question', questionHintFirst: 'Look at verse 3.', questionHint: 'Verse 3 says\n- one thing\n- another' };

  it('shows the first hint, as a one-item list, while the answer is empty', () => {
    const sb = validationWith([el]); const shown = capture(sb);
    sb.openHintForCard(buttonOn(cardFor('q1', { value: '  ' })));
    expect(shown).toHaveLength(1);
    expect(shown[0].code).toBe('hint');
    expect(shown[0].text).toBe('validation_lv_hint_lead');
    expect(shown[0].hintItems).toEqual(['Look at verse 3.']);
  });

  it('shows the fuller hint, bullet by bullet, once something is written', () => {
    const sb = validationWith([el]); const shown = capture(sb);
    sb.openHintForCard(buttonOn(cardFor('q1', { value: 'My answer' })));
    expect(shown[0].hintItems).toEqual(['Verse 3 says', 'one thing', 'another']);
  });

  it('uses the only hint there is, whether or not an answer is written', () => {
    for (const only of [{ questionHint: 'Only H' }, { questionHintFirst: 'Only F' }]) {
      for (const value of ['', 'text']) {
        const sb = validationWith([{ elementId: 'q1', type: 'question', ...only }]); const shown = capture(sb);
        sb.openHintForCard(buttonOn(cardFor('q1', { value })));
        expect(shown[0].hintItems).toEqual([Object.values(only)[0]]);
      }
    }
  });

  it('shows nothing when there is no hint, or no card', () => {
    const sb = validationWith([{ elementId: 'q1', type: 'question' }]); const shown = capture(sb);
    sb.openHintForCard(buttonOn(cardFor('q1')));
    sb.openHintForCard(buttonOn(null));
    sb.openHintForCard(null);
    expect(shown).toEqual([]);
  });

  it('is not a validation result: no traffic-light level, and the toast text escapes the hint', () => {
    const sb = validationWith([]);
    sb.escapeHtml = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');   // the sandbox's own is a pass-through
    expect(sb._lvLevelFor('hint')).toEqual({ level: null, face: '' });
    const html = sb._lvToastHtml({ code: 'hint', text: 'Lead', steps: [], hintItems: ['<img src=x onerror=1>'] });
    expect(html).not.toContain('<img');
  });
});

describe('failure messages use the fuller hint', () => {
  it('a too-short answer is followed by questionHint, not questionHintFirst', () => {
    const sb = validationWith([{ elementId: 'q1', type: 'question', questionHintFirst: 'FIRST', questionHint: 'FULL' }]);
    const d = sb._lvDetailFor(cardFor('q1', { value: 'idk' }), 'idk');
    expect(d.hintItems).toEqual(['FULL']);
  });

  it('with only a questionHintFirst, that is what follows', () => {
    const sb = validationWith([{ elementId: 'q1', type: 'question', questionHintFirst: 'FIRST' }]);
    const d = sb._lvDetailFor(cardFor('q1', { value: 'idk' }), 'idk');
    expect(d.hintItems).toEqual(['FIRST']);
  });
});

// ── Nothing written yet ───────────────────────────────────────────────────────
describe('tapping Answer check with nothing written', () => {
  it('shows how to start (and does not check anything)', () => {
    const sb = validationWith([{ elementId: 'q1', type: 'question' }]); const shown = capture(sb);
    sb.openLocalValidateForCard(buttonOn(cardFor('q1', { value: '   ' })));
    expect(shown).toHaveLength(1);
    expect(shown[0].code).toBe('empty');
    expect(shown[0].text).toBe('validation_lv_empty_check_lead');
    expect(shown[0].steps.at(-1)).toBe('validation_lv_empty_step_feedback');
  });
});

describe('_lvEmptyDetail', () => {
  const make = (el, extra = {}) => validationWith([{ elementId: 'q1', type: 'question', ...el }]);

  it('with a linked passage: read it, then write from it, then what the button will do', () => {
    const d = make({})._lvEmptyDetail(cardFor('q1', { linked: 'John 3:16' }), 'check');
    expect(d.steps).toEqual(['validation_lv_empty_step_read', 'validation_lv_empty_step_write_passage', 'validation_lv_empty_step_feedback']);
    expect(d.text).toBe('validation_lv_empty_check_lead');
  });

  it('without a passage: no "read the passage" step, and a write-in-your-own-words step', () => {
    const d = make({})._lvEmptyDetail(cardFor('q1'), 'check');
    expect(d.steps).toEqual(['validation_lv_empty_step_write_own', 'validation_lv_empty_step_feedback']);
  });

  it('for Main point: its own lead and last step', () => {
    const d = make({})._lvEmptyDetail(cardFor('q1', { linked: 'x' }), 'compare');
    expect(d.text).toBe('validation_lv_empty_compare_lead');
    expect(d.steps.at(-1)).toBe('validation_lv_empty_step_compare');
  });

  it('adds the voice sentence to the write step only when voice entry is available', () => {
    const without = make({})._lvEmptyDetail(cardFor('q1'), 'check');
    expect(without.steps[0]).toBe('validation_lv_empty_step_write_own');
    const sb = make({}); sb.voiceInputAvailable = () => true;
    expect(sb._lvEmptyDetail(cardFor('q1'), 'check').steps[0]).toBe('validation_lv_empty_step_write_own validation_lv_empty_voice');
  });

  it('closes with the hint pointer only when the question has a hint of either kind', () => {
    expect(make({})._lvEmptyDetail(cardFor('q1'), 'check').note).toBe('');
    expect(make({ questionHint: 'H' })._lvEmptyDetail(cardFor('q1'), 'check').note).toBe('validation_lv_empty_hint_note');
    expect(make({ questionHintFirst: 'F' })._lvEmptyDetail(cardFor('q1'), 'check').note).toBe('validation_lv_empty_hint_note');
    expect(make({ questionHint: ' ' })._lvEmptyDetail(cardFor('q1'), 'check').note).toBe('');
  });

  it('keeps the plain-text message in step with the parts', () => {
    const d = make({ questionHint: 'H' })._lvEmptyDetail(cardFor('q1', { linked: 'x' }), 'check');
    expect(d.message.split('\n')).toEqual([
      'validation_lv_empty_check_lead',
      '1. validation_lv_empty_step_read', '2. validation_lv_empty_step_write_passage', '3. validation_lv_empty_step_feedback',
      'validation_lv_empty_hint_note',
    ]);
  });

  it('shows the note under the steps, and an emoji where an icon is not available', () => {
    const sb = make({});
    const html = sb._lvToastHtml({ code: 'empty', text: 'Lead', steps: ['One'], note: 'Stuck? ([[icon:hint]]) ([[icon:mic]]) ([[icon:mainPoint]])', hintItems: [] });
    expect(html).toContain('<ol class="lv-steps"><li>One</li></ol><p class="lv-note">');
    expect(html).toContain('🔑');
    expect(html).toContain('🎤');
    expect(html).toContain('💡');
    expect(html).not.toContain('lv-face');
  });

  it('left-aligns (the .lv-toast wrapper) a toast with a list or note but no face; a bare one-liner stays as it was', () => {
    const sb = make({});
    expect(sb._lvToastHtml({ code: 'hint', text: 'Lead', steps: [], hintItems: ['One'] })).toMatch(/^<div class="lv-toast">/);
    expect(sb._lvToastHtml({ code: 'empty', text: 'Lead', steps: [], note: 'Note', hintItems: [] })).toMatch(/^<div class="lv-toast">/);
    expect(sb._lvToastHtml({ code: 'x', text: 'Just this', steps: [], hintItems: [] })).toBe('<div class="lv-text">Just this</div>');
  });
});

describe('the "picked up part of this" message', () => {
  const sb = validationWith([]);

  it('points to the Hint button in its second step when the question has a hint', () => {
    expect(sb._lvDetailForCode('partial', 'Some hint', false).steps[1]).toBe('validation_lv_partial_step2_hint');
    expect(sb._lvDetailForCode('partial', 'Some hint', true).steps).toHaveLength(3);
  });

  it('is unchanged when there is no readable hint', () => {
    expect(sb._lvDetailForCode('partial', null, false).steps[1]).toBe('validation_lv_partial_step2');
    expect(sb._lvDetailForCode('partial', '  ', false).steps[1]).toBe('validation_lv_partial_step2');
  });

  it('still does not print the hint itself', () => {
    expect(sb._lvDetailForCode('partial', 'Some hint', false).hintItems).toEqual([]);
  });

  it('the pointer is passed through the real feedback path for a question with only a questionHintFirst', () => {
    const s2 = validationWith([{ elementId: 'q1', type: 'question', questionHintFirst: 'F', keyTerms: ['alpha', 'beta', 'gamma', 'delta'] }]);
    const d = s2._lvDetailFor(cardFor('q1'), 'alpha is the first letter of the Greek alphabet used here');
    expect(d.code).toBe('partial');
    expect(d.steps[1]).toBe('validation_lv_partial_step2_hint');
  });
});

describe('taps while nothing is written do not count as leaving the answer', () => {
  it('lists the Hint button with the other buttons', () => {
    expect(read('validation.js')).toMatch(/_LV_STILL_WORKING_SELECTOR =[\s\S]*?\.hint-btn/);
  });
});

// ── Icons ─────────────────────────────────────────────────────────────────────
describe('the key icon', () => {
  it('is defined in every icon set', () => {
    expect(read('icons.js').match(/^ {2}hint:\s+`<svg/gm)).toHaveLength(3);
  });

  it('is described in the answer-tools pop-up, only in chapters that have a hint', () => {
    const src = read('render-chapter.js');
    expect(src).toContain('chapterHasHint');
    expect(src).toContain('renderchapter_answer_tools_hint_label');
    expect(src).toContain('renderchapter_answer_tools_hint_desc');
  });
});

// ── Strings ───────────────────────────────────────────────────────────────────
const NEW_KEYS = [
  'validation_lv_empty_check_lead', 'validation_lv_empty_compare_lead', 'validation_lv_empty_step_read',
  'validation_lv_empty_step_write_passage', 'validation_lv_empty_step_write_own', 'validation_lv_empty_voice',
  'validation_lv_empty_step_feedback', 'validation_lv_empty_step_compare', 'validation_lv_empty_hint_note',
  'validation_lv_hint_lead', 'validation_lv_partial_step2_hint',
  'renderchapter_answer_tools_hint_label', 'renderchapter_answer_tools_hint_desc',
];

describe('strings', () => {
  const en = load('en');

  it('every key the new code uses exists in English', () => {
    const wanted = new Set();
    for (const file of ['validation.js', 'render-chapter.js', 'render-chapter-elements.js']) {
      // Any quoted key (some are chosen with a ternary, not passed straight to t()).
      for (const m of read(file).matchAll(/'((?:validation_lv_(?:empty|hint|partial_step2_hint)[a-z_0-9]*)|renderchapter_answer_tools_hint_[a-z]+)'/g)) wanted.add(m[1]);
    }
    expect([...wanted].sort()).toEqual([...NEW_KEYS].sort());
    for (const k of NEW_KEYS) expect(en[k], k).toBeTruthy();
  });

  for (const lang of readdirSync(LOCALES)) {
    it(`${lang}: has every new string, with the icon markers of the English`, () => {
      const d = load(lang);
      for (const k of NEW_KEYS) {
        expect(typeof d[k] === 'string' && d[k].trim() !== '', `${k} missing or empty`).toBe(true);
        expect(d[k], `${k} has surrounding space`).toBe(d[k].trim());
        const markers = s => (s.match(/\[\[icon:[A-Za-z]+\]\]/g) || []).join();
        expect(markers(d[k]), `${k} icon markers`).toBe(markers(en[k]));
      }
      // The lead-ins end the way the other "here's a hint:" lead-ins do (a list or steps follow).
      expect(d.validation_lv_hint_lead).toMatch(/[:：፦]$/);
      expect(d.validation_lv_empty_check_lead).toMatch(/[:：፦]$/);
      expect(d.validation_lv_empty_compare_lead).toMatch(/[:：፦]$/);
    });
  }
});
