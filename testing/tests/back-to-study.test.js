/**
 * "Back to study" on a Go Deeper chapter: the full button at the foot and the
 * compact one-line copy above the chapter heading, both built by
 * _buildBackToStudyButton() in render-pages.js and handled by one click listener.
 *
 * The section is cut out of render-pages.js by its markers and run in a vm
 * sandbox alongside the real label-resolving helpers.
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

function makeSandbox() {
  const listeners = [];
  const navigated = [];
  const sandbox = {
    console,
    window: { studyMetadata: {}, activeStudyId: 's', chapters: [{ chapterNumber: 1, chapterTitle: 'Running Scared' }, { chapterNumber: 2, chapterTitle: 'The God who Saves' }] },
    ICONS: { arrowUp: '<i-up/>' },
    t: k => k,
    escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    document: { addEventListener: (type, fn) => listeners.push({ type, fn }) },
    Router: { navigate: s => navigated.push(s) },
    verseData: {}, renderFormatted: s => s, answerFieldKey: () => '', isStarredFromCache: () => false, voiceInputAvailable: () => false,
  };
  vm.createContext(sandbox);
  vm.runInContext(read('js/render-chapter-elements.js'), sandbox, { filename: 'render-chapter-elements.js' });
  const src = read('js/render-pages.js');
  const a = src.indexOf('// ── BACK TO STUDY');
  const b = src.indexOf('// ── PREVIOUS / NEXT CHAPTER');
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  vm.runInContext(src.slice(a, b), sandbox, { filename: 'back-to-study' });
  sandbox.__listeners = listeners;
  sandbox.__navigated = navigated;
  return sandbox;
}

const build = (sb, ch, compact, d = {}) => sb._buildBackToStudyButton(ch, d, 'en', {}, compact);

describe('compact top button', () => {
  it('is one line: arrow and label, no study-chapter title', () => {
    const sb = makeSandbox();
    const html = build(sb, { chapterNumber: 2, backToStudy: true }, true);
    expect(html).toContain('class="back-to-study-top"');
    expect(html).toContain('data-back-to-study="1"');
    expect(html).toContain('<i-up/>');
    expect(html).toContain('renderpages_back_to_study');
    expect(html).not.toContain('The God who Saves');
    expect(html).not.toContain('chapter-jump-title');
  });

  it('uses the same custom label and target as the bottom button', () => {
    const sb = makeSandbox();
    const ch = { chapterNumber: 9, backToStudy: { chapter: 1, label: 'Return to Jonah' } };
    const top = build(sb, ch, true), bottom = build(sb, ch, false);
    for (const html of [top, bottom]) {
      expect(html).toContain('Return to Jonah');
      expect(html).toContain('data-back-to-study="0"');
    }
  });

  it('uses goDeeperData.backToStudyLabel as a fallback', () => {
    const sb = makeSandbox();
    expect(build(sb, { chapterNumber: 1, backToStudy: true }, true, { backToStudyLabel: 'Back to the story' })).toContain('Back to the story');
  });

  it('escapes the label', () => {
    const sb = makeSandbox();
    const html = build(sb, { chapterNumber: 1, backToStudy: { label: '<b>x</b>' } }, true);
    expect(html).not.toContain('<b>');
  });
});

describe('where there is no button', () => {
  it.each([[undefined], [false], [{ chapter: 99 }]])('backToStudy %j gives neither button', (opt) => {
    const sb = makeSandbox();
    const ch = { chapterNumber: 1, backToStudy: opt };
    expect(build(sb, ch, true)).toBe('');
    expect(build(sb, ch, false)).toBe('');
  });

  it('a chapter with no study chapter of the same number gives neither button', () => {
    const sb = makeSandbox();
    expect(build(sb, { chapterNumber: 7, backToStudy: true }, true)).toBe('');
  });
});

describe('the full bottom button is unchanged', () => {
  it('still shows the study chapter title on a second line', () => {
    const sb = makeSandbox();
    const html = build(sb, { chapterNumber: 2, backToStudy: true }, false);
    expect(html).toContain('class="chapter-jump-btn back-to-study-btn"');
    expect(html).toContain('<span class="chapter-jump-title">The God who Saves</span>');
  });
});

describe('clicking either button', () => {
  it('goes to the study chapter, from the compact button too', () => {
    const sb = makeSandbox();
    const click = sb.__listeners.find(l => l.type === 'click').fn;
    const btn = { dataset: { backToStudy: '1' } };
    click({ target: { closest: sel => (sel === '[data-back-to-study]' ? btn : null) } });
    expect(sb.__navigated).toEqual([{ page: 'chapter', idx: 1, scrollY: 0 }]);
  });
});

describe('where the top button sits', () => {
  it('is drawn once, before the chapter heading, only through the same helper', () => {
    const src = read('js/render-pages.js');
    expect(src).toMatch(/\$\{backTopHtml\}\s*<div class="leaders-chapter-header">/);
    expect(src).toContain('_buildBackToStudyButton(ch, d, activeLang, langMap, true)');
  });
});
