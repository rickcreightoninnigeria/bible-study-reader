/**
 * Previous / Next buttons at the foot of Go Deeper (appendix) tabs, built by
 * _buildGoDeeperNavButtons() in render-pages.js, plus the study chapters'
 * Previous/Next border (CSS).
 *
 * The function is cut out of render-pages.js by its section markers and run in a
 * vm sandbox alongside the real label-resolving helpers from
 * render-chapter-elements.js.
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
    window: { studyMetadata: {} },
    GODEEPER_TABS: [],
    verseData: {},
    ICONS: new Proxy({}, { get: () => '' }),
    t: (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k),
    escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    renderFormatted: s => s, answerFieldKey: () => '', isStarredFromCache: () => false, voiceInputAvailable: () => false,
    document: { addEventListener: (type, fn) => listeners.push({ type, fn }) },
    Router: { replaceState: s => navigated.push(['replaceState', s]) },
    renderGoDeeper: id => navigated.push(['render', id]),
  };
  vm.createContext(sandbox);
  vm.runInContext(read('js/render-chapter-elements.js'), sandbox, { filename: 'render-chapter-elements.js' });
  const src = read('js/render-pages.js');
  const a = src.indexOf('// ── PREVIOUS / NEXT CHAPTER');
  const b = src.indexOf('async function renderGoDeeper(tabId) {');
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  vm.runInContext(src.slice(a, b), sandbox, { filename: 'godeeper-nav' });
  sandbox.__listeners = listeners;
  sandbox.__navigated = navigated;
  return sandbox;
}

// A Jonah-shaped appendix: an About tab and chapters 0–3.
function setup(extra = {}, tabs) {
  const sb = makeSandbox();
  const d = {
    chapters: [
      { chapterNumber: 0, title: 'A Double Journey?' },
      { chapterNumber: 1, title: 'Running Scared' },
      { chapterNumber: 2, title: 'The God who Saves' },
      { chapterNumber: 3, title: 'A Second Chance?' },
    ],
    ...extra,
  };
  sb.GODEEPER_TABS.push(...(tabs || [{ id: 'intro', label: 'About' }, ...d.chapters.map(c => ({ id: `ch_${c.chapterNumber}`, label: String(c.chapterNumber) }))]));
  sb.__d = d;
  sb.nav = (tab, o = {}) => sb._buildGoDeeperNavButtons(tab, d, o.lang || 'en', o.langMap || {}, o.intro);
  return sb;
}

const buttons = html => [...html.matchAll(/<button[^>]*class="([^"]*)"[^>]*data-godeeper-tab="([^"]*)"[^>]*>([^<]*)<\/button>/g)]
  .map(m => ({ cls: m[1], tab: m[2], text: m[3].trim() }));

describe('which buttons appear', () => {
  it('a middle chapter has Previous (quiet) and Next (solid), labelled with the neighbours’ titles', () => {
    const sb = setup();
    expect(buttons(sb.nav('ch_2'))).toEqual([
      { cls: 'chapter-nav-btn secondary', tab: 'ch_1', text: '← Running Scared' },
      { cls: 'chapter-nav-btn',           tab: 'ch_3', text: '→ A Second Chance?' },
    ]);
  });

  it('the first chapter has no Previous (it never links back to About) and keeps Next on the right', () => {
    const sb = setup();
    const html = sb.nav('ch_0');
    expect(buttons(html)).toEqual([{ cls: 'chapter-nav-btn', tab: 'ch_1', text: '→ Running Scared' }]);
    expect(html).toContain('<div style="flex:1"></div>');
    expect(html.indexOf('flex:1')).toBeLessThan(html.indexOf('data-godeeper-tab'));
  });

  it('the last chapter has no Next', () => {
    const sb = setup();
    expect(buttons(sb.nav('ch_3'))).toEqual([{ cls: 'chapter-nav-btn secondary', tab: 'ch_2', text: '← The God who Saves' }]);
  });

  it('the About tab has only Next, to the first chapter, labelled "Start reading"', () => {
    const sb = setup();
    expect(buttons(sb.nav('intro'))).toEqual([{ cls: 'chapter-nav-btn', tab: 'ch_0', text: '→ renderpages_godeeper_start_reading' }]);
  });

  it('works when the first chapter is numbered 1, or has gaps', () => {
    const sb = setup({}, [{ id: 'intro', label: 'About' }, { id: 'ch_1', label: '1' }, { id: 'ch_5', label: '5' }]);
    sb.__d.chapters = [{ chapterNumber: 1, title: 'One' }, { chapterNumber: 5, title: 'Five' }];
    expect(buttons(sb.nav('ch_1')).map(b => b.tab)).toEqual(['ch_5']);
    expect(buttons(sb.nav('ch_5')).map(b => b.tab)).toEqual(['ch_1']);
    expect(buttons(sb.nav('intro')).map(b => b.tab)).toEqual(['ch_1']);
  });

  it('a single chapter with no About tab has no buttons; an About-only appendix has none either', () => {
    expect(setup({}, [{ id: 'ch_0', label: '0' }]).nav('ch_0')).toBe('');
    expect(setup({}, [{ id: 'intro', label: 'About' }]).nav('intro')).toBe('');
  });

  it('is switched off by chapterNavButtons: false, and nothing else', () => {
    expect(setup({ chapterNavButtons: false }).nav('ch_2')).toBe('');
    expect(setup({ chapterNavButtons: true }).nav('ch_2')).not.toBe('');
    expect(setup({ chapterNavButtons: 0 }).nav('ch_2')).not.toBe('');     // only the literal false
    expect(setup({}).nav('ch_2')).not.toBe('');                           // on by default
  });

  it('returns nothing for a tab that does not exist', () => {
    expect(setup().nav('ch_99')).toBe('');
    expect(setup().nav(undefined)).toBe('');
  });
});

describe('button text', () => {
  it('previousLabel and nextLabel on the chapter override the titles', () => {
    const sb = setup();
    sb.__d.chapters[2].previousLabel = 'Back to the storm';
    sb.__d.chapters[2].nextLabel = 'On to Nineveh';
    expect(buttons(sb.nav('ch_2')).map(b => b.text)).toEqual(['← Back to the storm', '→ On to Nineveh']);
  });

  it('intro.nextLabel overrides "Start reading"', () => {
    const sb = setup();
    expect(buttons(sb.nav('intro', { intro: { header: 'About', nextLabel: 'Begin' } }))[0].text).toBe('→ Begin');
  });

  it('numbered slots follow the active language, falling back to slot 1, then unnumbered', () => {
    const sb = setup();
    const langMap = { en: 1, ha: 2 };
    sb.__d.chapters[2].nextLabel1 = 'Next (en)';
    sb.__d.chapters[2].nextLabel2 = 'Na gaba';
    sb.__d.chapters[1].title1 = 'Title one'; sb.__d.chapters[1].title2 = 'Taken farko';
    sb.__d.chapters[3].title1 = 'Third';
    expect(buttons(sb.nav('ch_2', { lang: 'ha', langMap })).map(b => b.text)).toEqual(['← Taken farko', '→ Na gaba']);
    expect(buttons(sb.nav('ch_2', { lang: 'en', langMap })).map(b => b.text)).toEqual(['← Title one', '→ Next (en)']);
    delete sb.__d.chapters[2].nextLabel2;
    expect(buttons(sb.nav('ch_2', { lang: 'ha', langMap })).map(b => b.text)[1]).toBe('→ Next (en)');
  });

  it('falls back to "Chapter N" when a neighbour has no title', () => {
    const sb = setup();
    delete sb.__d.chapters[3].title;
    expect(buttons(sb.nav('ch_2'))[1].text).toContain('renderpages_leaders_chapter_label');
    expect(buttons(sb.nav('ch_2'))[1].text).toContain('&quot;number&quot;:&quot;3&quot;');   // t() was given the chapter number
  });

  it('ignores empty and non-string labels', () => {
    const sb = setup();
    sb.__d.chapters[2].nextLabel = '   ';
    sb.__d.chapters[2].previousLabel = { toString() { throw new Error('boom'); } };
    expect(() => sb.nav('ch_2')).not.toThrow();
    expect(buttons(sb.nav('ch_2')).map(b => b.text)).toEqual(['← Running Scared', '→ A Second Chance?']);
  });
});

describe('hostile study data', () => {
  it('escapes titles and labels, and puts no study text in an attribute or handler', () => {
    const sb = setup();
    sb.__d.chapters[1].title = '"><img src=x onerror=alert(1)>';
    sb.__d.chapters[3].title = '<script>alert(2)</script>';
    sb.__d.chapters[2].nextLabel = '<b onmouseover=alert(3)>x</b>';
    const html = sb.nav('ch_2');
    expect(html).not.toMatch(/<img|<script|<b /);
    for (const tag of html.match(/<[^>]+>/g)) expect(tag).not.toMatch(/\son[a-z]+\s*=/i);   // no handler attribute on any real tag
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('tab ids in the markup come only from the page’s own tab list', () => {
    const sb = setup();
    for (const html of [sb.nav('ch_1'), sb.nav('intro'), sb.nav('ch_3')]) {
      for (const id of html.matchAll(/data-godeeper-tab="([^"]*)"/g)) expect(sb.GODEEPER_TABS.some(tab => tab.id === id[1])).toBe(true);
    }
  });
});

describe('the delegated click listener', () => {
  const click = (sb, target) => sb.__listeners.find(l => l.type === 'click').fn({ target });
  const target = id => ({ closest: sel => (sel === '[data-godeeper-tab]' ? { dataset: { godeeperTab: id } } : null) });

  it('switches tab in place (no new history entry) and re-renders', () => {
    const sb = setup();
    click(sb, target('ch_2'));
    expect(sb.__navigated).toEqual([['replaceState', { page: 'godeeper', tabId: 'ch_2' }], ['render', 'ch_2']]);
  });

  it('ignores an id that is not one of the page’s tabs, and clicks elsewhere', () => {
    const sb = setup();
    click(sb, target('ch_99'));
    click(sb, target('<script>'));
    click(sb, { closest: () => null });
    click(sb, null);
    expect(sb.__navigated).toEqual([]);
  });
});

describe('render-pages.js wiring', () => {
  const src = read('js/render-pages.js');

  it('shows the buttons on the About tab and on chapter tabs, above Back to the study', () => {
    expect(src).toMatch(/_buildGoDeeperNavButtons\('intro', d, activeLang, langMap, rawIntro\)/);
    const nav = src.indexOf("${_buildGoDeeperNavButtons(activeTab");
    const back = src.indexOf('${backHtml}');
    expect(nav).toBeGreaterThan(-1);
    expect(back).toBeGreaterThan(nav);
  });

  it('the new string exists', () => {
    const en = JSON.parse(read('js/locales/en/ui_en.json'));
    expect(en.renderpages_godeeper_start_reading).toBe('Start reading');
  });
});

describe('Previous / Next styling', () => {
  const css = read('css/05c-components.nav.css');

  it('the solid Next button has an amber border, the same colour as the outlined jump buttons', () => {
    const base = css.match(/\.chapter-nav-btn \{[^}]*\}/)[0];
    expect(base).toMatch(/border:\s*1\.5px solid var\(--accent\)/);
    expect(read('css/07-pages.css')).toMatch(/\.chapter-jump-btn \{[^}]*border:\s*1\.5px solid var\(--accent\)/);
  });

  it('the quiet Previous button keeps its look and matches the height', () => {
    const secondary = css.match(/\.chapter-nav-btn\.secondary \{[^}]*\}/)[0];
    expect(secondary).toMatch(/background:\s*transparent/);
    expect(secondary).toMatch(/border:\s*1\.5px solid var\(--border\)/);
  });

  it('dark mode uses the lighter accent, as the jump buttons do', () => {
    expect(css).toMatch(/body\.dark-mode \.chapter-nav-btn:not\(\.secondary\) \{\s*border-color:\s*var\(--accent-light\)/);
    expect(read('css/07-pages.css')).toMatch(/body\.dark-mode \.chapter-jump-btn \{[^}]*border-color:\s*var\(--accent-light\)/);
  });
});
