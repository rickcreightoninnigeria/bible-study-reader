/**
 * Settings tab bar: tabs with a short label (Library → Lib). Covers the markup
 * (tabLabelHtml), the rule that picks full / short / shorter labels so the bar
 * stays on one row (fitTabBar), the CSS that shows one label and hides the
 * other without hiding it from a screen reader, and the short strings in every
 * locale.
 *
 * Paths are relative to testing/tests/ — sources are in ../../app/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, '../../app');
const LOCALES = join(APP, 'js/locales');
const src = readFileSync(join(APP, 'js/render-pages.js'), 'utf8');
const css = readFileSync(join(APP, 'css/07-pages.css'), 'utf8');
const load = lang => JSON.parse(readFileSync(join(LOCALES, lang, `ui_${lang}.json`), 'utf8').replace(/^﻿/, ''));
const langs = readdirSync(LOCALES);

// tabLabelHtml, _tabBarWraps and fitTabBar, cut out of render-pages.js.
const start = src.indexOf('function tabLabelHtml');
const end = src.indexOf('// The bar\'s width changes with the window');
const { tabLabelHtml, fitTabBar } = (() => {
  const sandbox = { Array, Math };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(start, end) + '\nthis.tabLabelHtml = tabLabelHtml; this.fitTabBar = fitTabBar;', sandbox);
  return sandbox;
})();

// A bar whose tabs fit on one row only when its classes make the labels short
// enough: `fitsWith` is the list of class names that allows one row.
function fakeBar(fitsWith, { hasShort = true, rowsWhenWrapped = 2 } = {}) {
  const classes = new Set();
  const fits = () => fitsWith !== null && fitsWith.every(c => classes.has(c));
  const tab = i => ({
    getBoundingClientRect: () => ({ top: fits() || i < 3 ? 0 : 40, height: 30 }),
  });
  const kids = [0, 1, 2, 3, 4].map(tab);
  return {
    classes,
    firstElementChild: kids[0],
    children: kids,
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
    },
    querySelector: () => (hasShort ? {} : null),
    get offsetHeight() { return fits() ? 30 : 30 * rowsWhenWrapped; },
  };
}

describe('tabLabelHtml', () => {
  it('keeps a plain tab as plain text', () => {
    expect(tabLabelHtml({ label: () => 'App' })).toBe('App');
    expect(tabLabelHtml({ label: 'App', short: () => '' })).toBe('App');
  });

  it('holds both labels when the tab has a different short one; the short one is hidden from a screen reader', () => {
    expect(tabLabelHtml({ label: () => 'Library', short: () => 'Lib' }))
      .toBe('<span class="tab-full">Library</span><span class="tab-short" aria-hidden="true">Lib</span>');
  });

  it('does not double up a label whose short form is the same word', () => {
    expect(tabLabelHtml({ label: () => 'Idioma', short: () => 'Idioma' })).toBe('Idioma');
  });
});

describe('fitTabBar', () => {
  it('leaves every label full when they fit on one row', () => {
    const bar = fakeBar([]);
    fitTabBar(bar);
    expect([...bar.classes]).toEqual([]);
  });

  it('shortens the tabs that are not selected first', () => {
    const bar = fakeBar(['tabs-short']);
    fitTabBar(bar);
    expect([...bar.classes]).toEqual(['tabs-short']);
  });

  it('shortens the selected tab too only when that is the only way to one row', () => {
    const bar = fakeBar(['tabs-shorter']);
    fitTabBar(bar);
    expect(bar.classes.has('tabs-shorter')).toBe(true);
  });

  it('puts the labels back to full when shortening cannot get the tabs onto one row', () => {
    const bar = fakeBar(null);
    fitTabBar(bar);
    expect([...bar.classes]).toEqual([]);
  });

  it('starts again from the full labels each time it runs (the window may have grown)', () => {
    const bar = fakeBar([]);
    bar.classList.add('tabs-short', 'tabs-shorter');
    fitTabBar(bar);
    expect([...bar.classes]).toEqual([]);
  });

  it('does nothing for a bar with no short labels, or no bar', () => {
    const bar = fakeBar(null, { hasShort: false });
    fitTabBar(bar);
    fitTabBar(null);
    expect([...bar.classes]).toEqual([]);
  });
});

describe('Settings tabs', () => {
  it('gives Language, Library and Diagnostics a short label, and no other tab', () => {
    const block = src.slice(src.indexOf('function getSettingsTabs'), src.indexOf('// ── TAB BAR LABELS'));
    expect(block.match(/short:/g)).toHaveLength(3);
    expect(block).toContain("t('renderpages_tab_language_short')");
    expect(block).toContain("t('renderpages_tab_library_short')");
    expect(block).toContain("t('renderpages_tab_diagnostics_short')");
  });

  it('draws the tab buttons with tabLabelHtml and fits the bar after drawing the page', () => {
    expect(src).toContain('>${tabLabelHtml(t)}</button>');
    expect(src).toMatch(/window\.scrollTo\(0, 0\);\s*fitSettingsTabs\(\);/);
  });

  it('shows one label per tab and hides the other visually only (a screen reader still reads the full word)', () => {
    expect(css).toMatch(/\.howto-tab \.tab-short \{ display: none; \}/);
    expect(css).toMatch(/\.howto-tab-bar\.tabs-short \.howto-tab:not\(\.active\) \.tab-short,\s*\.howto-tab-bar\.tabs-shorter \.howto-tab \.tab-short \{ display: inline; \}/);
    const hide = css.slice(css.indexOf('.howto-tab-bar.tabs-short .howto-tab:not(.active) .tab-full'));
    expect(hide.slice(0, 400)).toContain('clip: rect(0 0 0 0)');
    expect(hide.slice(0, 400)).not.toContain('display: none');
  });
});

describe.each(langs)('short tab labels in %s', lang => {
  const ui = load(lang);
  const pairs = [
    ['renderpages_tab_library', 'renderpages_tab_library_short'],
    ['renderpages_tab_language', 'renderpages_tab_language_short'],
    ['renderpages_tab_diagnostics', 'renderpages_tab_diagnostics_short'],
  ];

  it.each(pairs)('%s has a short form (%s) that is not longer than the full word', (full, short) => {
    expect(typeof ui[short]).toBe('string');
    expect(ui[short].trim()).not.toBe('');
    expect(ui[short]).toBe(ui[short].trim());
    expect([...ui[short]].length).toBeLessThanOrEqual([...ui[full].trim()].length);
  });
});
