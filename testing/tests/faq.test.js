/**
 * How to Use → FAQ. Covers the wiring (the tab, the question list, the
 * collapsible markup, the Diagnostics link), the English strings (every listed
 * question has a question and an answer, none is orphaned, answers stay short,
 * menu paths name real Settings tabs), and the privacy policy's statements
 * about downloads and deletion, which the FAQ points readers to.
 *
 * Paths are relative to testing/tests/ — sources are in ../../app/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const APP = join(ROOT, 'app');
const read = p => readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, '');
const ui = JSON.parse(read('app/js/locales/en/ui_en.json'));
const rp = read('app/js/render-pages.js');
const css = read('app/css/07-pages.css');

// FAQ_GROUPS, cut out of render-pages.js.
const FAQ_GROUPS = (() => {
  const start = rp.indexOf('const FAQ_GROUPS');
  const end = rp.indexOf('];', start) + 2;
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(rp.slice(start, end) + '\nthis.groups = FAQ_GROUPS;', sandbox);
  return sandbox.groups;
})();

const ids = FAQ_GROUPS.flatMap(g => g.items);
const textOf = html => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

describe('FAQ wiring', () => {
  it('is the last tab of How to Use, labelled FAQ', () => {
    const block = rp.slice(rp.indexOf('const HOWTO_TABS'), rp.indexOf('const FAQ_GROUPS'));
    const tabIds = [...block.matchAll(/\{ id: '(\w+)'/g)].map(m => m[1]);
    expect(tabIds[tabIds.length - 1]).toBe('faq');
    expect(ui.renderpages_tab_faq).toBe('FAQ');
    expect(rp).toContain('faq:      tabFaq,');
  });

  it('draws each question as a <details> card with its question as the <summary>, so it works without scripts', () => {
    expect(rp).toContain('<details class="howto-block faq-item">');
    expect(rp).toContain("<summary class=\"howto-block-title\">${t('faq_' + id + '_q')}</summary>");
    expect(css).toMatch(/\.faq-item > summary::after \{\s*content: '\+';/);
    expect(css).toContain(".faq-item[open] > summary::after { content: '\\2212'; }");
  });

  it('is reachable from Diagnostics, and Diagnostics from the FAQ', () => {
    expect(rp).toContain("Router.navigate({ page: 'howto', tabId: 'faq' })");
    expect(rp).toContain("Router.navigate({ page: 'settings', tabId: 'diagnostics' })");
    expect(typeof ui.faq_diag_link).toBe('string');
    expect(typeof ui.faq_stuck_btn).toBe('string');
  });

  it('shortens the Library tab like the Settings bar, and fits the How to Use bar after drawing', () => {
    expect(rp).toMatch(/id: 'library',\s*label: \(\) => t\('renderpages_tab_library'\), short: \(\) => t\('renderpages_tab_library_short'\)/);
    expect(rp).toMatch(/window\.scrollTo\(0, 0\);\s*fitHowtoTabs\(\);/);
    expect(rp).toContain('>${tabLabelHtml(t)}</button>`).join(\'\')}\n    </div>`;\n\n  const tabContent = (tabContentFns[activeTab] || tabStudy)();');
  });
});

describe('FAQ strings (English)', () => {
  it('lists each question once, in groups that have a heading', () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of FAQ_GROUPS) expect(typeof ui[`faq_group_${g.id}`], g.id).toBe('string');
  });

  it.each(ids)('%s has a question and an answer', id => {
    expect(ui[`faq_${id}_q`].trim().length).toBeGreaterThan(5);
    expect(ui[`faq_${id}_a`].trim().length).toBeGreaterThan(20);
  });

  it('has no question or answer that is not listed in a group', () => {
    const keyed = Object.keys(ui).filter(k => /^faq_\w+_[qa]$/.test(k)).map(k => k.replace(/^faq_|_[qa]$/g, ''));
    const listed = new Set(ids);
    // The "still stuck?" card is not a question: its keys are faq_stuck_title / _body / _btn.
    expect([...new Set(keyed)].filter(id => !listed.has(id))).toEqual([]);
  });

  it.each(ids)('%s: the answer is short (at most three paragraphs and 120 words), with balanced tags and no unfilled placeholders', id => {
    const a = ui[`faq_${id}_a`];
    expect(a.split('\n\n').length).toBeLessThanOrEqual(3);
    expect(textOf(a).split(' ').length).toBeLessThanOrEqual(120);
    for (const tag of ['b', 'i', 'em', 'strong']) {
      expect((a.match(new RegExp(`<${tag}>`, 'g')) || []).length).toBe((a.match(new RegExp(`</${tag}>`, 'g')) || []).length);
    }
    expect(a).not.toMatch(/\{\w+\}|\[\[|\]\]/);
  });

  it('names only Settings tabs that exist (App, Study, Language, Library, Diagnostics)', () => {
    const valid = new Set(['App', 'Study', 'Language', 'Library', 'Diagnostics']);
    const found = [];
    for (const id of ids) {
      for (const m of ui[`faq_${id}_a`].matchAll(/Settings → ([A-Za-z]+)/g)) found.push([id, m[1]]);
    }
    expect(found.length).toBeGreaterThan(3);
    for (const [id, tab] of found) expect(valid.has(tab), `${id}: Settings → ${tab}`).toBe(true);
  });

  it('puts backup, restore and the share or print-all options where Settings has them (Settings → Study), and the answer check mode in Settings → App', () => {
    const settingsStudy = rp.slice(rp.indexOf('  function tabStudy() {', rp.indexOf('function renderSettings')), rp.indexOf('  function tabLibrary() {', rp.indexOf('function renderSettings')));
    const settingsApp = rp.slice(rp.indexOf('  function tabApp() {'), rp.indexOf('  function tabStudy() {', rp.indexOf('  function tabApp() {')));
    expect(settingsStudy).toContain("t('backup_heading')");
    expect(settingsStudy).toContain("t('renderpages_settings_printall_desc')");
    expect(settingsApp).toContain("t('renderpages_settings_answercheck_label'");
    expect(ui.faq_newphone_a).toContain('Settings → Study → Backup');
    expect(ui.faq_check_a).toContain('Settings → App');
  });
});

describe('privacy policy (the FAQ points readers to it)', () => {
  const policy = read('PRIVACY_POLICY.md');

  it('names the current download site, not Google Drive as the place studies are downloaded from', () => {
    expect(read('app/js/appAboutData_untranslated.json')).toContain('rickcreightoninnigeria.github.io/bsr-studies/');
    expect(policy).toContain('rickcreightoninnigeria.github.io/bsr-studies/');
    expect(policy).not.toMatch(/currently Google Drive/);
    expect(policy).not.toMatch(/version information from a file hosted on Google Drive/);
  });

  it('describes deletion the way the app does it (bin icon; Settings → Study → Clear all saved answers)', () => {
    expect(policy).toContain('tap the bin icon');
    expect(policy).toContain('Settings → Study → Clear all saved answers');
    expect(policy).not.toMatch(/press and hold/);
    expect(policy).not.toContain('Settings → Answers');
  });
});
