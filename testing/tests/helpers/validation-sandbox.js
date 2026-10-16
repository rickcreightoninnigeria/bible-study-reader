/**
 * Reusable vm sandbox for loading app/js/validation.js in tests.
 *
 * validation.js registers DOM listeners at load time and expects a handful of
 * globals (t, ICONS, showToast, escapeHtml, verseData, chapters, studyText …) and
 * the functions of answer-match.js, which is loaded first. This stub provides
 * the minimum so the file can be evaluated without a browser. `t` returns the
 * key (plus any params) so tests assert on keys, not on English wording.
 *
 * Paths are relative to testing/tests/ — source files are in ../../app/js/
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const APP_JS = join(__dirname, '../../../app/js');

export function makeValidationSandbox(extra = {}) {
  const listeners = [];
  const sandbox = {
    console,
    window: {},
    verseData: {},
    // Study globals that validation.js reads (the tests override these as needed).
    chapters: [],
    currentChapter: 0,
    studyText: (obj, field, fallback = '') => {
      const v = obj && obj[field];
      return (Array.isArray(v) ? v.length > 0 : !!v) ? v : fallback;
    },
    buildLangMap: () => ({}),
    getActiveLang: langs => (langs && langs[0]) || null,
    detectAvailableLangs: () => [],
    t: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    ICONS: new Proxy({}, { get: () => '' }),
    showToast: () => {},
    escapeHtml: s => String(s),
    document: {
      addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
      createElement: () => {
        // _stripHtml only needs innerHTML in → textContent out.
        const el = { _html: '' };
        Object.defineProperty(el, 'innerHTML', { set(v) { el._html = v; }, get() { return el._html; } });
        Object.defineProperty(el, 'textContent', { get() { return el._html.replace(/<[^>]*>/g, ''); } });
        return el;
      },
    },
    ...extra,
  };
  vm.createContext(sandbox);
  // answer-match.js loads first, as in index.html.
  vm.runInContext(readFileSync(join(APP_JS, 'answer-match.js'), 'utf8'), sandbox, { filename: 'answer-match.js' });
  vm.runInContext(readFileSync(join(APP_JS, 'validation.js'), 'utf8'), sandbox, { filename: 'validation.js' });
  sandbox.__listeners = listeners;
  return sandbox;
}

/** Minimal stand-in for a .question-card element, enough for _localValidate. */
export function makeCard({ ref = null } = {}) {
  return {
    querySelector: sel => (sel === '.question-ref span[data-ref]' && ref ? { dataset: { ref } } : null),
  };
}
