/**
 * The answer-check toast: traffic-light levels and faces, the formatted message
 * (a numbered list of steps for a partial answer, the Main point icon), how long
 * it stays, and the toast behaviour behind it (a stale reset must not overwrite
 * the feedback; a tap on the toast, or Escape, dismisses it).
 *
 * validation.js runs whole in a vm sandbox; the toast code is cut out of utils.js.
 * The look (colours, layout, light and dark) was checked in a real browser.
 *
 * Paths are relative to testing/tests/ — source is in ../../app/
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';
import { makeValidationSandbox } from './helpers/validation-sandbox.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, '../../app');
const read = f => readFileSync(join(APP, f), 'utf8');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');

describe('traffic-light levels and faces', () => {
  const sb = makeValidationSandbox();
  const level = code => sb._lvLevelFor(code);

  it('red is a long way off: repeating the question or the passage', () => {
    for (const c of ['repeatsQuestion', 'repeatsPassage']) expect(level(c)).toEqual({ level: 'red', face: '😕' });
  });

  it('amber is getting closer or heading another way; off topic has its own face', () => {
    for (const c of ['tooShort', 'stuck', 'partial']) expect(level(c)).toEqual({ level: 'amber', face: '😐' });
    expect(level('offTopic')).toEqual({ level: 'amber', face: '😶' });
  });

  it('green is good', () => {
    for (const c of ['strong', 'pass']) expect(level(c)).toEqual({ level: 'green', face: '😀' });
  });

  it('has no level when the check could not tell (passes basic checks, no thematic data)', () => {
    expect(level('passNoSample')).toEqual({ level: null, face: '' });
    expect(level('anythingElse')).toEqual({ level: null, face: '' });
    expect(level('constructor')).toEqual({ level: null, face: '' });
  });

  it('the toast stays up for 12 seconds', () => {
    expect(vm.runInContext('_LV_TOAST_MS', sb)).toBe(12000);
  });
});

describe('the feedback detail', () => {
  const sb = makeValidationSandbox();
  const detail = (code, hint, hasMainPoint) => sb._lvDetailForCode(code, hint, hasMainPoint);

  it('a partial answer gets two steps, plus a third pointing to the Main point button when there is one', () => {
    expect(detail('partial', null, true).steps).toEqual(['validation_lv_partial_step1', 'validation_lv_partial_step2', 'validation_lv_partial_step3']);
    expect(detail('partial', null, false).steps).toEqual(['validation_lv_partial_step1', 'validation_lv_partial_step2']);
    expect(detail('partial', null, true).text).toBe('validation_lv_partial');
  });

  it('other results have no steps; praise points to the Main point button only when there is one', () => {
    expect(detail('strong', null, true).steps).toEqual([]);
    expect(detail('strong', null, true).text).toBe('validation_lv_strong validation_lv_see_main_point');
    expect(detail('strong', null, false).text).toBe('validation_lv_strong');
  });

  it('keeps the hint where it always was', () => {
    expect(detail('stuck', 'Try verse 2.', false).text).toBe('validation_lv_stuck_hint Try verse 2.');
  });
});

describe('the toast HTML', () => {
  const make = (extra = {}) => makeValidationSandbox({ escapeHtml: esc, ...extra });

  it('puts the face first and the steps in a numbered list', () => {
    const sb = make();
    const html = sb._lvToastHtml(sb._lvDetailForCode('partial', null, true));
    expect(html).toMatch(/^<div class="lv-toast"><span class="lv-face" aria-hidden="true">😐<\/span><div class="lv-text">/);
    expect(html).toContain('<ol class="lv-steps"><li>validation_lv_partial_step1</li><li>validation_lv_partial_step2</li><li>');
    expect((html.match(/<li>/g) || []).length).toBe(3);
  });

  it('has no face or wrapper when there is no level', () => {
    const sb = make();
    const html = sb._lvToastHtml(sb._lvDetailForCode('passNoSample', null, false));
    expect(html).toBe('<div class="lv-text">validation_lv_pass_no_sample_no_hint</div>');
  });

  it('escapes the study\'s hint: a hostile hint cannot add markup', () => {
    const sb = make();
    const html = sb._lvToastHtml(sb._lvDetailForCode('stuck', '<img src=x onerror=alert(1)><script>x</script>', false));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('keeps the Main point icon marker when the icon exists (the real expandInlineMarkers draws it)', () => {
    const sb = make({ ICONS: { mainPoint: '<svg></svg>' } });
    sb.t = key => (key === 'validation_lv_partial_step3' ? 'Then tap ([[icon:mainPoint]]) now' : key);
    expect(sb._lvToastHtml(sb._lvDetailForCode('partial', null, true))).toContain('Then tap ([[icon:mainPoint]]) now');
  });

  it('falls back to the 💡 emoji when the icon is missing', () => {
    const sb = make({ ICONS: {} });
    sb.t = key => (key === 'validation_lv_partial_step3' ? 'Then tap ([[icon:mainPoint]]) now' : key);
    const html = sb._lvToastHtml(sb._lvDetailForCode('partial', null, true));
    expect(html).toContain('Then tap (💡) now');
    expect(html).not.toContain('[[icon');
  });
});

describe('toast behaviour (cut out of utils.js)', () => {
  const src = read('js/utils.js');
  const a = src.indexOf('const _toastHideTimers = {};');
  const b = src.indexOf("if (e.key === 'Escape') _hideToast('validate-toast');");
  const code = src.slice(a, src.indexOf('\n});', b) + 4);
  let toasts, listeners, sb;

  const fakeToast = id => ({
    id, textContent: id === 'toast' ? '✓ Answers saved' : '', innerHTML: '',
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    contains(t) { return t === this; },
  });
  const shown = () => Object.values(toasts).filter(t => t.classList.contains('show'));
  const fire = (type, ev) => listeners.filter(l => l.type === type).forEach(l => l.fn(ev));

  beforeEach(() => {
    vi.useFakeTimers();
    toasts = { toast: fakeToast('toast'), 'validate-toast': fakeToast('validate-toast'), celebrationToast: fakeToast('celebrationToast') };
    listeners = [];
    sb = {
      t: key => (key === 'utils_answers_saved' ? '✓ Answers saved' : key),
      appSettings: { autoSaveToast: true },
      setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: id => clearTimeout(id),
      document: {
        getElementById: id => toasts[id] || null,
        addEventListener: (type, fn) => listeners.push({ type, fn }),
        querySelectorAll: () => shown(),
      },
    };
    vm.createContext(sb);
    vm.runInContext(code, sb);
  });
  afterEach(() => vi.useRealTimers());

  const showFeedback = text => sb.showToast({ message: text, isHtml: true, duration: 12000, elementId: 'validate-toast', isManual: true, resetText: '' });

  it('a stale reset from the last hide does not overwrite feedback shown straight after (the bug)', () => {
    showFeedback('FIRST');
    vi.advanceTimersByTime(400);
    fire('pointerdown', { target: {} });            // tapping the check icon hides the old toast...
    vi.advanceTimersByTime(80);
    showFeedback('SECOND');                         // ...and the click shows the new feedback
    vi.advanceTimersByTime(1000);
    expect(toasts['validate-toast'].innerHTML).toBe('SECOND');
    expect(toasts['validate-toast'].classList.contains('show')).toBe(true);
  });

  it('even with the old default reset text, a re-shown toast keeps its new message', () => {
    sb.showToast({ message: 'A', elementId: 'validate-toast', isManual: true });      // default resetText "Answers saved"
    sb._hideToast('validate-toast');
    sb.showToast({ message: 'B', elementId: 'validate-toast', isManual: true });
    vi.advanceTimersByTime(1000);
    expect(toasts['validate-toast'].textContent).toBe('B');
  });

  it('showing the toast\'s own text again (auto-save) restores the default text at once', () => {
    sb.showToast({ message: 'Study deleted', isManual: true });
    sb._hideToast('toast');
    sb.showToast({ isManual: true });
    expect(toasts.toast.textContent).toBe('✓ Answers saved');
    vi.advanceTimersByTime(1000);
    expect(toasts.toast.textContent).toBe('✓ Answers saved');
  });

  it('after hiding, the default text is still restored', () => {
    sb.showToast({ message: 'Study deleted', isManual: true });
    sb._hideToast('toast');
    vi.advanceTimersByTime(400);
    expect(toasts.toast.textContent).toBe('✓ Answers saved');
  });

  it('a tap on the answer-check toast itself dismisses it', () => {
    showFeedback('x');
    fire('pointerdown', { target: toasts['validate-toast'] });
    expect(toasts['validate-toast'].classList.contains('show')).toBe(false);
  });

  it('a tap on the save toast itself leaves it alone, as before', () => {
    sb.showToast({ message: 'Done', isManual: true });
    fire('pointerdown', { target: toasts.toast });
    expect(toasts.toast.classList.contains('show')).toBe(true);
  });

  it('a tap on the celebration toast (it has a Share button) does not dismiss it', () => {
    sb.showToast({ message: 'Well done', isManual: true, elementId: 'celebrationToast', resetText: '' });
    fire('pointerdown', { target: toasts.celebrationToast });
    expect(toasts.celebrationToast.classList.contains('show')).toBe(true);
  });

  it('Escape dismisses the answer-check toast', () => {
    showFeedback('x');
    fire('keydown', { key: 'Enter' });
    expect(toasts['validate-toast'].classList.contains('show')).toBe(true);
    fire('keydown', { key: 'Escape' });
    expect(toasts['validate-toast'].classList.contains('show')).toBe(false);
  });
});

describe('wiring and styles', () => {
  const v = read('js/validation.js');
  it('the display path uses the detail, the level class, 12 seconds and an empty reset text', () => {
    expect(v).toContain("toast.classList.add('lv-' + level)");
    expect(v).toContain('duration: _LV_TOAST_MS');
    expect(v).toContain("resetText: ''");
    expect(v).not.toContain('duration: 10000');
  });

  it('the three levels have colours in light and dark mode, and a layout that mirrors in RTL', () => {
    const vars = read('css/02-variables.css'), nav = read('css/05c-components.nav.css');
    for (const l of ['red', 'amber', 'green']) {
      expect(vars).toContain(`--lv-${l}-bg:`);
      // the element is class="toast" id="validate-toast", so the rules must use the id
      expect(nav).toContain(`#validate-toast.lv-${l}`);
      expect(nav).toContain(`body.dark-mode #validate-toast.lv-${l}`);
    }
    expect(nav).toMatch(/\.lv-toast \{[^}]*text-align: start/);
    expect(nav).toMatch(/\.lv-steps \{[^}]*padding-inline-start/);
  });
});

describe('the revised strings in every language', () => {
  const dirs = readdirSync(join(APP, 'js/locales'));
  const load = l => JSON.parse(readFileSync(join(APP, `js/locales/${l}/ui_${l}.json`), 'utf8'));

  for (const l of dirs) {
    it(`${l}: the steps exist and the Main point icon marker is kept`, () => {
      const d = load(l);
      for (const k of ['validation_lv_partial', 'validation_lv_partial_step1', 'validation_lv_partial_step2', 'validation_lv_partial_step3', 'validation_lv_see_main_point']) {
        expect(typeof d[k], k).toBe('string');
        expect(d[k].trim(), k).not.toBe('');
      }
      expect(d.validation_lv_partial_step3).toContain('[[icon:mainPoint]]');
      expect(d.validation_lv_see_main_point).toContain('[[icon:mainPoint]]');
      expect(d.validation_lv_partial).not.toContain('Take another look');   // English text must not linger in the intro
    });
  }
});
