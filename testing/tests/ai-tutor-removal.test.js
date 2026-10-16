/**
 * Guards for the removal of the AI tutor (Briefing 1).
 *
 *  1. Source guard: no tutor identifiers or Gemini endpoint remain in the app's
 *     scripts or styles (locale strings: ai-tutor-removal-locales.test.js).
 *  2. Settings: the removed showCheckAnswerBtn setting is gone from the defaults,
 *     and a user whose saved settings still contain it loads without error.
 *  3. Study loading: a study that still carries studyAiData renders questions
 *     with no tutor button and makes no network request.
 *  4. validation.js smoke test: it still loads, local validate is intact, and no
 *     tutor function exists.
 *
 * Paths are relative to testing/tests/ — the app is in ../../app/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';
import { makeValidationSandbox } from './helpers/validation-sandbox.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, '../../app');

// ── 1. Source guard ───────────────────────────────────────────────────────────
// 'gemini' is deliberately NOT in this list: the About page credits it for
// "vibe coding" in appAboutData_*.json, which is unrelated to the tutor.
const FORBIDDEN = ['aiTutor', 'AI_TUTOR', 'ai-tutor', 'checkAnswer', 'check-answer', 'showCheckAnswer', 'generativelanguage', 'aiMentorPrompt'];

const sources = [
  ...readdirSync(join(APP, 'js')).filter(f => f.endsWith('.js') && !f.endsWith('.min.js')).map(f => join(APP, 'js', f)),
  ...readdirSync(join(APP, 'css')).filter(f => f.endsWith('.css')).map(f => join(APP, 'css', f)),
];

describe('AI tutor removal: source guard', () => {
  it.each(sources.map(f => [f.slice(APP.length + 1), f]))('%s has no tutor identifiers', (_name, file) => {
    const text = readFileSync(file, 'utf8');
    for (const word of FORBIDDEN) expect(text.includes(word), `${word} in ${_name}`).toBe(false);
  });
});

// ── 2. Settings ───────────────────────────────────────────────────────────────
function loadSettings(savedJson) {
  const store = savedJson === undefined ? {} : { appSettings: savedJson };
  const sandbox = {
    console,
    document: {},
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: () => {} },
    safeSetItem: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(APP, 'js/settings.js'), 'utf8'), sandbox, { filename: 'settings.js' });
  // initSettings() ends by touching the DOM; replace those two collaborators.
  vm.runInContext('applyAllSettings = () => {}; applyIconTheme = () => {};', sandbox);
  return sandbox;
}

describe('AI tutor removal: settings', () => {
  it('SETTINGS_DEFAULTS has no showCheckAnswerBtn', () => {
    const sb = loadSettings();
    expect(vm.runInContext('Object.keys(SETTINGS_DEFAULTS)', sb)).not.toContain('showCheckAnswerBtn');
  });

  it('the tutor helpers are gone', () => {
    const sb = loadSettings();
    expect(typeof sb.showCheckAnswerButton).toBe('undefined');
    expect(typeof sb.applyCheckAnswerBtnVisibility).toBe('undefined');
  });

  it('initSettings() copes with a saved object that still has showCheckAnswerBtn', () => {
    const sb = loadSettings(JSON.stringify({ showCheckAnswerBtn: true, darkMode: true, fontSize: 20 }));
    expect(() => vm.runInContext('initSettings()', sb)).not.toThrow();
    expect(vm.runInContext('appSettings.darkMode', sb)).toBe(true);
    expect(vm.runInContext('appSettings.fontSize', sb)).toBe(20);
    expect(vm.runInContext('appSettings.localValidateMode', sb)).toBe('auto');   // default still filled in
  });
});

// ── 4. validation.js smoke test ───────────────────────────────────────────────
describe('AI tutor removal: validation.js', () => {
  const sb = makeValidationSandbox();

  it('loads and keeps the local-validate API', () => {
    for (const fn of ['localValidateEligible', 'openLocalValidateForCard', 'localValidateAutoTrigger', '_localValidate', '_getQuestionText', '_stripHtml']) {
      expect(typeof sb[fn], fn).toBe('function');
    }
  });

  it('has no tutor functions', () => {
    for (const fn of ['aiTutorAvailable', 'openAiTutorForCard', 'aiTutorObfuscateKey', '_aiTutorSend', '_callGemini', '_buildTutorPanel', '_buildChapterContext', '_persistConversation', '_parseHistory', '_appendTurn', '_appendTyping', '_resolveApiKey', '_decodeKey', '_xorString']) {
      expect(typeof sb[fn], fn).toBe('undefined');
    }
  });

  it('registers its blur/pointer listeners at load, as before', () => {
    expect(sb.__listeners.map(l => l.type).sort()).toEqual(['blur', 'mousedown', 'pointerdown']);
  });

  it('never calls fetch', () => {
    expect(sb.fetch).toBeUndefined();
    expect(readFileSync(join(APP, 'js/validation.js'), 'utf8')).not.toMatch(/\bfetch\s*\(/);
  });
});

// ── 3. Study loading ──────────────────────────────────────────────────────────
describe('AI tutor removal: a study with studyAiData', () => {
  it('is no longer read by study-loader.js', () => {
    const loader = readFileSync(join(APP, 'js/study-loader.js'), 'utf8');
    // sanitizeStudyData still walks every key generically; nothing may read the field.
    expect(loader).not.toMatch(/window\.studyAiData/);
    expect(loader).not.toMatch(/data\.studyAiData/);
  });

  it('question cards render no tutor button and make no network request', () => {
    // Evaluate render-chapter-elements.js's renderQuestion with minimal stubs.
    let network = 0;
    const sandbox = {
      console,
      window: { studyMetadata: {} },
      verseData: {},
      ICONS: new Proxy({}, { get: () => '<i></i>' }),
      t: k => k,
      escapeHtml: s => String(s),
      renderFormatted: s => s,
      answerFieldKey: (type, id) => `${type}_${id}`,
      isStarredFromCache: () => false,
      voiceInputAvailable: () => false,
      fetch: () => { network++; throw new Error('network'); },
      XMLHttpRequest: function () { network++; throw new Error('network'); },
    };
    vm.createContext(sandbox);
    vm.runInContext(readFileSync(join(APP, 'js/render-chapter-elements.js'), 'utf8'), sandbox, { filename: 'render-chapter-elements.js' });
    const html = sandbox.renderQuestion({
      el: { elementId: 'q1', type: 'question', subtype: 'standard', question: 'Why?' },
      ch: { chapterNumber: 1 },
      noPad: '', answerRowInfoHtml: '', activeLang: 'en', langMap: {}, chapterAnswers: {},
    });
    expect(html).toContain('local-validate-btn');
    expect(html).not.toContain('check-answer-btn');
    expect(html).not.toMatch(/AiTutor|ai-tutor/);
    expect(network).toBe(0);
  });
});
