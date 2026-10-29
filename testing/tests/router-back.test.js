/**
 * Back and the ✕ on Settings, Library, Progress and How to Use step back through
 * the navigation history: they return the reader to the page they were on
 * (their chapter, or the title page of their study), not to the Library.
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
    window: { addEventListener: (t, fn) => { listeners.window[t] = fn; }, activeStudyId: 'study-a', activeTabPage: null },
    document: { addEventListener: (t, fn) => { listeners.document[t] = fn; }, getElementById: () => null, body: { classList: { contains: () => false } } },
    history: { pushState: rec('pushState'), replaceState: rec('replaceState'), back: rec('history.back'), forward: rec('history.forward') },
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
