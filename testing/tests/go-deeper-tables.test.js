/**
 * Go Deeper blocks: header-only blocks, tables, footnote markers at the start of
 * a paragraph, and the table CSS.
 *
 * _buildContentBlocksHtml() (render-pages.js) and expandFootnoteMarkers()
 * (format-text.js) are cut out of the source by their markers and run in a vm
 * sandbox. DOMPurify is not available here, so what survives the load-time
 * sanitiser is checked by reading the config rather than by running it; the
 * real thing is covered by the browser checks.
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

function slice(src, from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  expect(a, from).toBeGreaterThan(-1);
  expect(b, to).toBeGreaterThan(a);
  return src.slice(a, b);
}

function makeSandbox() {
  const sandbox = {
    console,
    // Stand-ins: the sanitiser and resolvers are not what is under test here.
    sanitizeHtml: s => s,
    renderFormatted: s => s,
    buildGalleryHtml: () => '',
    resolveMetaField: (ch, field) => ch[field],
  };
  vm.createContext(sandbox);
  vm.runInContext(
    slice(read('js/format-text.js'), 'const _footnoteBodies', "document.addEventListener('click'"),
    sandbox, { filename: 'format-text-footnotes' });
  vm.runInContext(
    slice(read('js/render-pages.js'), 'function _buildContentBlocksHtml(', 'async function renderLeadersNotes'),
    sandbox, { filename: 'content-blocks' });
  return sandbox;
}

const SKIP = new Set(['chapterNumber', 'format', 'title', 'footnotes', 'backToStudy']);
const blocks = (ch, format = 'HTML', footnotes = null) =>
  makeSandbox()._buildContentBlocksHtml(ch, 'en', {}, SKIP, 'go-deeper', 'go-deeper-highlight', format, footnotes);

describe('header-only Go Deeper blocks', () => {
  const ch = { chapterNumber: 2, title: 'T', pictureCity: { subtype: 'standard', header: 'Picturing the city', body: '' } };

  it('renders the heading and nothing else', () => {
    const html = blocks(ch);
    expect(html).toContain('go-deeper-block-label">Picturing the city<');
    expect(html).not.toContain('<p');
  });

  it('keeps its place among the other blocks', () => {
    const html = blocks({
      chapterNumber: 2, title: 'T',
      a: { subtype: 'standard', header: 'First', body: '<p>one</p>' },
      b: { subtype: 'standard', header: 'Second', body: '' },
      c: { subtype: 'standard', header: 'Third', body: '<p>three</p>' },
    });
    expect(html.indexOf('First')).toBeLessThan(html.indexOf('Second'));
    expect(html.indexOf('Second')).toBeLessThan(html.indexOf('Third'));
  });

  it('does not render a highlighted block with no body (its heading would float alone)', () => {
    expect(blocks({ chapterNumber: 1, title: 'T', x: { subtype: 'highlighted', header: 'Box', body: '' } })).not.toContain('Box');
  });
});

describe('tables in a Go Deeper body', () => {
  const table =
    '<div class="go-deeper-table-wrap"><table class="go-deeper-table"><thead><tr><th scope="col"></th><th scope="col">A</th></tr></thead>' +
    '<tbody><tr><th scope="row">r</th><td colspan="1"><ul><li>x</li></ul></td></tr></tbody></table></div>';

  it('HTML bodies reach the page exactly as the load-time sanitiser left them', () => {
    expect(blocks({ chapterNumber: 9, title: 'T', m: { subtype: 'standard', body: `<p>a</p>${table}<p>b</p>` } })).toContain(table);
  });

  it('the load-time sanitiser keeps tables: it starts from DOMPurify defaults, with no tag allow-list', () => {
    const cfg = slice(read('js/format-text.js'), 'const _LOAD_PURIFY_CONFIG', '};');
    expect(cfg).not.toContain('ALLOWED_TAGS');
    expect(cfg).not.toMatch(/FORBID_TAGS:[^\]]*\b(table|thead|tbody|tr|th|td|div)\b/);
    expect(cfg).not.toMatch(/FORBID_ATTR:[^\]]*(colspan|scope|class)/);
  });

  it('markdown bodies are cut down to the narrow allow-list, which has no table tags (so tables need format "HTML")', () => {
    const cfg = slice(read('js/format-text.js'), 'const _PURIFY_CONFIG', '};');
    expect(cfg).not.toMatch(/'table'|'td'|'th'/);
  });
});

describe('footnote marker at the start of a paragraph', () => {
  it('becomes a button, and the rest of the paragraph follows it', () => {
    const html = blocks(
      { chapterNumber: 4, title: 'T', cultures: { subtype: 'standard', header: 'H', body: '<p>[[fn:10]]The culture we live in</p>' } },
      'HTML', [{ id: 10, body: 'Note <i>ten</i>' }]);
    expect(html).toMatch(/<p><sup><button class="footnote-btn" data-fn-key="\d+">10<\/button><\/sup>The culture we live in<\/p>/);
  });

  it('a marker with no matching footnote falls back to a plain superscript number', () => {
    expect(blocks({ chapterNumber: 4, title: 'T', x: { subtype: 'standard', body: '<p>[[fn:3]]Text</p>' } }, 'HTML', [{ id: 1, body: 'n' }]))
      .toContain('<p><sup>3</sup>Text</p>');
  });
});

describe('table CSS', () => {
  const css = read('css/07-pages.css');
  const rule = sel => { const i = css.indexOf(sel + ' {'); expect(i, sel).toBeGreaterThan(-1); return css.slice(i, css.indexOf('}', i)); };

  it('the wrapper scrolls sideways, so a wide table cannot widen the page', () => {
    expect(rule('.go-deeper-table-wrap')).toContain('overflow-x: auto');
  });

  it('cells align to the start (so right-to-left studies mirror), not to the left', () => {
    expect(rule('.go-deeper-table th,\n.go-deeper-table td')).toContain('text-align: start');
    const tableCss = css.slice(css.indexOf('.go-deeper-table-wrap {'), css.indexOf('.leaders-confidential'));
    expect(tableCss).not.toMatch(/text-align:\s*left|padding-left|margin-left/);
  });

  it('dark mode uses the dark tokens: --border and --surface-mid keep their light values there', () => {
    const dark = css.slice(css.indexOf('body.dark-mode .go-deeper-table {'), css.indexOf('/* ── Settings ── */\nbody.dark-mode'));
    expect(dark).toContain('var(--dm-border)');
    expect(dark).toContain('var(--dm-sunken)');
    expect(dark).toContain('var(--dm-text-mid)');
  });
});

describe('divine name class', () => {
  it('.divine-name sets small capitals, so studies need no inline style for LORD', () => {
    const css = read('css/03-base.css');
    const i = css.indexOf('.divine-name {');
    expect(i).toBeGreaterThan(-1);
    expect(css.slice(i, css.indexOf('}', i))).toContain('font-variant: small-caps');
  });

  it('span and class survive the formatted-text allow-list (pop-ups use it)', () => {
    const cfg = slice(read('js/format-text.js'), 'const _PURIFY_CONFIG', '};');
    expect(cfg).toContain("'span'");
    expect(cfg).toMatch(/ALLOWED_ATTR:[^\]]*'class'/);
  });
});
