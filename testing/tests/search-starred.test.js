/**
 * The "Starred" filter in search: search.js is run in a vm sandbox with the
 * real state.js keys and starred.js read helper.
 *
 *  - Off by default, and switched off each time the search opens.
 *  - On with nothing typed: every starred question in the study, in study order.
 *  - On with a query: only starred questions, matched on question, reference
 *    and answer; starred reflections also match on their question text.
 *  - Starred results carry a star in every mode.
 *
 * Paths are relative to testing/tests/ — source files are in ../../app/js/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(__dirname, '../../app/js', f), 'utf8');

const q = (id, ref, text) => ({ elementId: id, ref, text });

function makeSandbox(records) {
  const els = {
    searchResults: { innerHTML: '', querySelectorAll: () => [] },
    searchInput:   { value: '', blur() {}, focus() {} },
    searchStarFilter: { innerHTML: '', attrs: {}, classList: { on: false, toggle(c, v) { this.on = v; } }, setAttribute(k, v) { this.attrs[k] = v; } },
    searchOverlay: { classList: { add() {}, remove() {} } },
    'header-title': { innerText: 'Exodus' },
    navSearchBtn: null,
  };
  const sandbox = {
    console, window: {}, setTimeout: () => 0,
    document: { getElementById: id => els[id] || null },
    ICONS: { starFilled: '<star/>', search: '', close: '' },
    t: (k, p) => p ? k + JSON.stringify(p) : k,
    escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    stripInlineMarkers: s => s,
    studyText: (el, f) => el[f],
    closeMenu() {}, saveLastPosition() {}, isNonChapterPage: false, navSearchClick() {},
    StudyIDB: { getChapterAnswers: async (_s, n) => records[n] || {} },
    __chapters: [
      {
        chapterNumber: 1, chapterTitle: 'Running Scared',
        sections: [{ bridge: 'A shepherd and a bush', questions: [
          q('ch01-el02', 'Ex 3:1', 'Who appeared to Moses?'),
          q('ch01-el03', 'Ex 3:2', 'What was burning?'),
        ] }],
        elements: [{ type: 'question', subtype: 'reflection', elementId: 'ch01-el04', question: 'What frightens you most?' }],
      },
      {
        chapterNumber: 2, chapterTitle: 'The Name',
        sections: [{ questions: [q('ch02-el02', 'Ex 3:13', 'What is his name?')] }],
        elements: [],
      },
    ],
  };
  vm.createContext(sandbox);
  vm.runInContext(read('state.js'), sandbox);
  // state.js declares its own `chapters`, which shadows a sandbox property.
  vm.runInContext('chapters = __chapters', sandbox);
  sandbox.window.activeStudyId = 's';
  const starred = read('starred.js');
  const a = starred.indexOf('function isStarredFromCache(');
  vm.runInContext(starred.slice(a, starred.indexOf('\n}\n', a) + 3), sandbox);
  vm.runInContext(read('search.js'), sandbox);
  sandbox.__els = els;
  return sandbox;
}

const html = sb => sb.__els.searchResults.innerHTML;
const items = sb => (html(sb).match(/class="search-result-item"/g) || []).length;
// Matched words are wrapped in <mark>, so results are checked by their card ids.
const ids = sb => [...html(sb).matchAll(/data-card-id="([^"]+)"/g)].map(m => m[1]);

const RECORDS = {
  1: { 'star_ch01-el03': '1', 'q_ch01-el03': 'A bush that did not burn up', 'star_ch01-el04': '1', 'r_ch01-el04': 'Being alone' },
  2: { 'star_ch02-el02': '1' },
};

describe('chip', () => {
  it('is off when the search opens, and shows the translated label', () => {
    const sb = makeSandbox(RECORDS);
    sb.openSearch();
    expect(sb.__els.searchStarFilter.innerHTML).toContain('starred_panel_title');
    expect(sb.__els.searchStarFilter.attrs['aria-pressed']).toBe('false');
  });

  it('toggling turns it on and off, and updates aria-pressed', async () => {
    const sb = makeSandbox(RECORDS);
    sb.openSearch();
    sb.toggleSearchStarFilter();
    expect(sb.__els.searchStarFilter.attrs['aria-pressed']).toBe('true');
    expect(sb.__els.searchStarFilter.classList.on).toBe(true);
    sb.toggleSearchStarFilter();
    expect(sb.__els.searchStarFilter.attrs['aria-pressed']).toBe('false');
  });

  it('is switched off again each time the search opens', () => {
    const sb = makeSandbox(RECORDS);
    sb.openSearch();
    sb.toggleSearchStarFilter();
    sb.openSearch();
    expect(sb.__els.searchStarFilter.attrs['aria-pressed']).toBe('false');
  });
});

describe('browsing starred questions (filter on, nothing typed)', () => {
  it('lists every starred question and reflection, in study order, with stars', async () => {
    const sb = makeSandbox(RECORDS);
    sb.openSearch();
    sb.toggleSearchStarFilter();
    await sb.runSearchCore('');
    expect(ids(sb)).toEqual(['ch01-el03', 'ch01-el04', 'ch02-el02']);
    const h = html(sb);
    expect(h).not.toContain('Who appeared to Moses?');
    expect(h.indexOf('What was burning?')).toBeLessThan(h.indexOf('What frightens you most?'));
    expect(h.indexOf('What frightens you most?')).toBeLessThan(h.indexOf('What is his name?'));
    expect((h.match(/search-result-star/g) || []).length).toBe(3);
    expect(h).toContain('A bush that did not burn up');
    expect(h).not.toContain('A shepherd and a bush');
  });

  it('says so when nothing is starred', async () => {
    const sb = makeSandbox({});
    sb.openSearch();
    sb.toggleSearchStarFilter();
    await sb.runSearchCore('');
    expect(html(sb)).toContain('search_starred_none');
    expect(items(sb)).toBe(0);
  });

  it('shows the usual prompt, not the list, when the filter is off and nothing is typed', async () => {
    const sb = makeSandbox(RECORDS);
    sb.openSearch();
    await sb.runSearchCore('');
    expect(html(sb)).toContain('search_empty_prompt');
  });

  it('a one-letter query counts as nothing typed', async () => {
    const sb = makeSandbox(RECORDS);
    sb.openSearch();
    sb.toggleSearchStarFilter();
    await sb.runSearchCore('w');
    expect(ids(sb)).toEqual(['ch01-el03', 'ch01-el04', 'ch02-el02']);
    expect(html(sb)).not.toContain('<mark>');
  });
});

describe('searching with the filter on', () => {
  it('returns only starred questions that match', async () => {
    const sb = makeSandbox(RECORDS);
    sb.openSearch();
    sb.toggleSearchStarFilter();
    await sb.runSearchCore('burning');
    expect(ids(sb)).toEqual(['ch01-el03']);
  });

  it('leaves out an unstarred question that matches', async () => {
    const sb = makeSandbox(RECORDS);
    sb.openSearch();
    sb.toggleSearchStarFilter();
    await sb.runSearchCore('Moses');
    expect(items(sb)).toBe(0);
    expect(html(sb)).toContain('search_no_results');
  });

  it('skips bridge text', async () => {
    const sb = makeSandbox(RECORDS);
    sb.openSearch();
    sb.toggleSearchStarFilter();
    await sb.runSearchCore('shepherd');
    expect(html(sb)).not.toContain('A shepherd and a bush');
  });

  it('matches a starred reflection on its question text', async () => {
    const sb = makeSandbox(RECORDS);
    sb.openSearch();
    sb.toggleSearchStarFilter();
    await sb.runSearchCore('frightens');
    expect(ids(sb)).toEqual(['ch01-el04']);
  });

  it('matches a starred question on its saved answer', async () => {
    const sb = makeSandbox(RECORDS);
    sb.openSearch();
    sb.toggleSearchStarFilter();
    await sb.runSearchCore('did not burn');
    expect(ids(sb)).toContain('ch01-el03');
  });
});

describe('searching with the filter off', () => {
  it('finds unstarred questions and bridge text as before, with a star only on the starred ones', async () => {
    const sb = makeSandbox(RECORDS);
    sb.openSearch();
    await sb.runSearchCore('Moses');
    expect(ids(sb)).toEqual(['ch01-el02']);
    expect(html(sb)).not.toContain('search-result-star');
    await sb.runSearchCore('burning');
    expect(ids(sb)).toContain('ch01-el03');
    expect(html(sb)).toContain('search-result-star');
    await sb.runSearchCore('shepherd');
    expect(html(sb)).toContain('shepherd');    // bridge text: a result with no card id
  });

  it('still lists a reflection only when its answer matches', async () => {
    const sb = makeSandbox(RECORDS);
    sb.openSearch();
    await sb.runSearchCore('frightens');
    expect(ids(sb)).not.toContain('ch01-el04');
    await sb.runSearchCore('alone');
    expect(ids(sb)).toEqual(['ch01-el04']);
  });
});

describe('toggleStar', () => {
  it('drops the search answer cache so the next search sees the new star', async () => {
    const sb = makeSandbox(RECORDS);
    const src = read('starred.js');
    const a = src.indexOf('async function toggleStar(');
    sb.StudyIDB.updateChapterAnswers = async (_s, _n, mutate) => { mutate({}); };
    sb.refreshStarredSummary = () => {};
    vm.runInContext(src.slice(a, src.indexOf('\n}\n', a) + 3), sb);
    sb.openSearch();
    await sb.runSearchCore('Moses');
    expect(vm.runInContext('storageCache.size', sb)).toBe(2);
    await sb.toggleStar(1, 'ch01-el02');
    expect(vm.runInContext('storageCache.size', sb)).toBe(0);
  });
});
