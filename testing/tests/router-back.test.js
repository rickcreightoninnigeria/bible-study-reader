/**
 * Back and the ✕ on Settings, Library, Progress and How to Use step back through
 * the navigation history: they return the reader to the page they were on
 * (their chapter, or the title page of their study), at the spot they had
 * scrolled to, not to the Library and not to the top of the page.
 *
 * router.js is loaded in a vm sandbox with a stand-in History API and recording
 * stubs for the render functions. The popstate listener it registers is called
 * directly, as the browser would call it.
 *
 * Paths are relative to testing/tests/ — router.js is in ../../app/js/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../../app/js/router.js'), 'utf8');

function makeRouter() {
  const calls = [];
  const listeners = { window: {}, document: {} };
  const rec = name => (...args) => { calls.push([name, ...args]); };
  const sandbox = {
    console,
    calls,
    window: {
      addEventListener: (t, fn) => { listeners.window[t] = fn; }, activeStudyId: 'study-a', activeTabPage: null,
      scrollY: 0, scrollTo: o => { calls.push(['scrollTo', o.top]); },
    },
    document: { addEventListener: (t, fn) => { listeners.document[t] = fn; }, getElementById: () => null, body: { classList: { contains: () => false } } },
    history: {
      state: null,
      pushState(st) { calls.push(['pushState', st]); this.state = st; },
      replaceState(st) { calls.push(['replaceState', st]); this.state = st; },
      back: rec('history.back'), forward: rec('history.forward'),
    },
    goToChapter: async (...a) => { calls.push(['goToChapter', ...a]); },
    openLibrary: async () => { calls.push(['openLibrary']); },
    renderTitlePage: rec('renderTitlePage'),
    renderProgressOverview: rec('renderProgressOverview'),
    renderHowToUse: rec('renderHowToUse'),
    renderSettings: async (...a) => { calls.push(['renderSettings', ...a]); },
    renderLeadersNotes: async () => {}, renderAbout: async () => {}, renderNotesPage: rec('renderNotesPage'), renderGoDeeper: async () => {},
    closeSearch: rec('closeSearch'),
    StudyIDB: { get: async () => null }, applyStudyData: async () => {}, safeSetItem: () => {},
    Swal: { fire: (o) => { calls.push(['Swal.fire']); return new Promise(() => {}); } },
    t: k => k,
    setTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'router.js' });
  return { sandbox, calls, popstate: listeners.window.popstate, keydown: listeners.document.keydown, Router: vm.runInContext('Router', sandbox) };
}
const names = calls => calls.map(c => c[0]);

describe('popstate (Back, ✕ and Escape)', () => {
  it('returns to the chapter the reader was on, not the Library', async () => {
    const { popstate, calls, Router } = makeRouter();
    await Router.navigate({ page: 'chapter', idx: 3 });
    await Router.navigate({ page: 'settings', tabId: 'app' });
    calls.length = 0;
    await popstate({ state: { page: 'chapter', idx: 3, tabId: null, scrollY: 0, studyId: 'study-a' } });
    expect(names(calls)).toContain('goToChapter');
    expect(calls.find(c => c[0] === 'goToChapter').slice(1)).toEqual([3, 0]);
    expect(names(calls)).not.toContain('openLibrary');
  });

  it.each([
    ['settings', 'renderSettings'],
    ['progress', 'renderProgressOverview'],
    ['howto', 'renderHowToUse'],
    ['title', 'renderTitlePage'],
    ['library', 'openLibrary'],
  ])('shows the %s page when that is where history goes back to', async (page, fn) => {
    const { popstate, calls } = makeRouter();
    await popstate({ state: { page, idx: null, tabId: null, scrollY: 0, studyId: 'study-a' } });
    expect(names(calls)).toEqual([fn]);
  });

  it('does not send a Back from the title page, a page or a chapter to the Library', async () => {
    for (const page of ['title', 'progress', 'howto', 'settings']) {
      const { popstate, calls, Router } = makeRouter();
      await Router.navigate({ page: 'chapter', idx: 1 });
      await Router.navigate({ page });
      calls.length = 0;
      await popstate({ state: { page: 'chapter', idx: 1, tabId: null, scrollY: 0, studyId: 'study-a' } });
      expect(names(calls), page).not.toContain('openLibrary');
    }
  });

  it('asks before leaving the app when the history is used up, and at the exit sentinel', async () => {
    for (const state of [null, { page: null }, { page: '_exit_guard' }]) {
      const { popstate, calls } = makeRouter();
      await popstate({ state });
      expect(names(calls)).toContain('Swal.fire');
      expect(names(calls)).not.toContain('openLibrary');
    }
  });

  it('closes the search overlay without changing page', async () => {
    const { popstate, calls, sandbox } = makeRouter();
    sandbox.document.getElementById = id => (id === 'searchOverlay' ? { classList: { contains: c => c === 'open' } } : null);
    await popstate({ state: { page: 'chapter', idx: 1, studyId: 'study-a' } });
    expect(names(calls)).toEqual(['closeSearch', 'history.forward']);
  });
});

describe('the ✕ buttons and Escape use Back', () => {
  it('Router.back() is history.back()', () => {
    const { Router, calls } = makeRouter();
    Router.back();
    expect(names(calls)).toEqual(['history.back']);
  });

  it.each(['navLibClick', 'navProgressClick', 'navHowtoClick', 'navSettingsClick'])('%s on its own page goes back, and elsewhere opens the page', (fn) => {
    const page = { navLibClick: 'library', navProgressClick: 'progress', navHowtoClick: 'howto', navSettingsClick: 'settings' }[fn];
    const { sandbox, calls } = makeRouter();
    const click = vm.runInContext(`window.${fn}`, sandbox);
    sandbox.window.activeTabPage = page;
    click();
    expect(names(calls)).toEqual(['history.back']);
  });

  it('Escape steps back like the Back button', () => {
    const { keydown, calls } = makeRouter();
    keydown({ key: 'Escape' });
    expect(names(calls)).toEqual(['history.back']);
    calls.length = 0;
    keydown({ key: 'a' });
    expect(calls).toEqual([]);
  });
});


describe('returning to the exact spot', () => {
  const entry = (page, extra = {}) => ({ page, idx: null, tabId: null, scrollY: 0, studyId: 'study-a', ...extra });

  it('records the scroll position in the entry of the page being left, before the new entry is pushed', async () => {
    const { sandbox, calls, Router } = makeRouter();
    await Router.navigate({ page: 'chapter', idx: 3 });
    sandbox.window.scrollY = 1234;
    calls.length = 0;
    await Router.navigate({ page: 'settings', tabId: 'app' });
    const kinds = calls.filter(c => c[0] === 'replaceState' || c[0] === 'pushState');
    expect(kinds.map(c => c[0])).toEqual(['replaceState', 'pushState']);
    expect(kinds[0][1]).toMatchObject({ page: 'chapter', idx: 3, scrollY: 1234 });
    expect(kinds[1][1]).toMatchObject({ page: 'settings', scrollY: 0 });
  });

  it('records it when a page is pushed without rendering too', async () => {
    const { sandbox, calls, Router } = makeRouter();
    await Router.navigate({ page: 'chapter', idx: 0 });
    sandbox.window.scrollY = 80;
    calls.length = 0;
    Router.pushWithoutRender({ page: 'title' });
    expect(calls.find(c => c[0] === 'replaceState')[1]).toMatchObject({ page: 'chapter', scrollY: 80 });
  });

  it('writes nothing when the position has not changed', async () => {
    const { calls, Router } = makeRouter();
    await Router.navigate({ page: 'chapter', idx: 1 });   // entry has scrollY 0 and the page is at 0
    calls.length = 0;
    await Router.navigate({ page: 'progress' });
    expect(calls.filter(c => c[0] === 'replaceState')).toEqual([]);
  });

  it('does not write a scroll position into an entry that is not what is on screen', async () => {
    const { sandbox, calls, Router } = makeRouter();
    Router.boot({ page: 'title' });                  // the title page is on screen
    sandbox.history.state = entry('chapter', { idx: 2 });   // but the browser's entry says chapter
    sandbox.window.scrollY = 999;
    calls.length = 0;
    await Router.navigate({ page: 'settings' });
    expect(calls.filter(c => c[0] === 'replaceState')).toEqual([]);
  });

  it('copes with an empty or sentinel history entry', async () => {
    const { sandbox, Router } = makeRouter();
    sandbox.window.scrollY = 50;
    sandbox.history.state = null;
    await expect(Router.navigate({ page: 'howto' })).resolves.not.toThrow();
    sandbox.history.state = entry('_exit_guard');
    await expect(Router.navigate({ page: 'progress' })).resolves.not.toThrow();
  });

  it('goes back to a chapter at the recorded position', async () => {
    const { popstate, calls } = makeRouter();
    await popstate({ state: entry('chapter', { idx: 4, scrollY: 1234 }) });
    expect(calls.find(c => c[0] === 'goToChapter').slice(1)).toEqual([4, 1234]);
  });

  it.each(['settings', 'progress', 'howto', 'title', 'leaders', 'about', 'notes', 'godeeper'])('goes back to the %s page scrolled to where it was', async (page) => {
    const { popstate, calls } = makeRouter();
    await popstate({ state: entry(page, { scrollY: 800 }) });
    expect(calls.filter(c => c[0] === 'scrollTo')).toEqual([['scrollTo', 800]]);
  });

  it('does not scroll a page that was at the top, a chapter (it scrolls itself) or the Library', async () => {
    for (const [page, y] of [['settings', 0], ['chapter', 900], ['library', 900]]) {
      const { popstate, calls } = makeRouter();
      await popstate({ state: entry(page, { idx: page === 'chapter' ? 1 : null, scrollY: y }) });
      expect(calls.filter(c => c[0] === 'scrollTo'), page).toEqual([]);
    }
  });

  it('a new visit to a page starts at the top, and a tab switch resets the saved position', async () => {
    const { sandbox, calls, Router } = makeRouter();
    await Router.navigate({ page: 'chapter', idx: 1 });
    sandbox.window.scrollY = 700;
    await Router.navigate({ page: 'settings', tabId: 'app' });
    expect(sandbox.history.state.scrollY).toBe(0);
    Router.replaceState({ page: 'settings', tabId: 'study' });
    expect(sandbox.history.state).toMatchObject({ page: 'settings', tabId: 'study', scrollY: 0 });
  });
});
