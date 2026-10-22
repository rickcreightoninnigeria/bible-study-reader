/**
 * Inline markers in study text: [[icon:name]] and [[sc:Text]].
 *
 * The real marker code (format-text.js), the real markdown-it, and the real
 * safeSetHtml (modals.js), _buildContentBlocksHtml (render-pages.js),
 * ttsStripHtml (tts.js) and stripHtml (search.js) are cut out of the source and
 * run in a vm sandbox. DOMPurify needs a DOM, which is not available here, so
 * it is replaced by an identity stand-in; the order of the steps (marker
 * expansion strictly AFTER sanitising) is what is tested, and what the real
 * DOMPurify does to the span and to hostile input was checked in a browser.
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
  const a = src.indexOf(from), b = to ? src.indexOf(to, a) : src.length;
  expect(a, from).toBeGreaterThan(-1);
  expect(b, String(to)).toBeGreaterThan(a);
  return src.slice(a, b);
}

function makeSandbox() {
  const popup = { innerHTML: '' };
  const sandbox = {
    console,
    ICONS: { localValidate: '<svg id="shield"></svg>', triggerInfo: '<svg id="info"></svg>' },
    // Identity stand-ins: marker expansion is what is under test, not sanitising.
    sanitizeHtml: s => s,
    DOMPurify: { sanitize: s => s },
    _MODAL_PURIFY_CONFIG: {},
    document: {
      addEventListener() {},
      getElementById: () => popup,
      // _ttsDecodeEntities only needs the decoded value of a few entities.
      createElement: () => ({
        set innerHTML(v) { this.value = v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'"); },
      }),
    },
    buildGalleryHtml: () => '',
    resolveMetaField: (ch, field) => ch[field],
    popup,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  // Real markdown-it (a UMD file that assigns window.markdownit).
  vm.runInContext(read('js/markdown-it.min.js'), sandbox, { filename: 'markdown-it' });
  // format-text.js from the markdown-it instance to the end of the file.
  vm.runInContext(slice(read('js/format-text.js'), 'const _md = window.markdownit'),
    sandbox, { filename: 'format-text' });
  vm.runInContext(slice(read('js/modals.js'), 'function safeSetHtml(', '// Sanitise a plain URL'),
    sandbox, { filename: 'safeSetHtml' });
  vm.runInContext(slice(read('js/render-pages.js'), 'function _buildContentBlocksHtml(', 'async function renderLeadersNotes'),
    sandbox, { filename: 'content-blocks' });
  vm.runInContext(slice(read('js/tts.js'), 'function _ttsDecodeEntities(', 'function ttsSplitIntoChunks('),
    sandbox, { filename: 'tts' });
  vm.runInContext(slice(read('js/search.js'), 'function stripHtml(', '// ── DEBOUNCE'),
    sandbox, { filename: 'search' });
  vm.runInContext(slice(read('js/share-print.js'), 'const _printMarkers', '// Fallback only'),
    sandbox, { filename: 'share-print' });
  return sandbox;
}

const sb = makeSandbox();
// A top-level const is not a property of the sandbox object, so fetch it by name.
const printMarkers = vm.runInContext('_printMarkers', sb);
const SPAN = '<span class="divine-name">Lord</span>';
const SKIP = new Set(['chapterNumber', 'format', 'title', 'footnotes', 'backToStudy']);
const goDeeper = (body, format) => sb._buildContentBlocksHtml(
  { chapterNumber: 1, block: { subtype: 'standard', header: '', body } },
  'en', {}, SKIP, 'go-deeper', 'go-deeper-highlight', format, null);

describe('[[icon:name]]', () => {
  it('swaps a known marker for the app icon, wrapped and hidden from screen readers', () => {
    expect(sb.expandInlineMarkers('<p>Tap Check [[icon:localValidate]] now</p>'))
      .toBe('<p>Tap Check <span class="inline-icon" aria-hidden="true"><svg id="shield"></svg></span> now</p>');
  });

  it('handles several markers in one string and removes unknown names', () => {
    const out = sb.expandInlineMarkers('[[icon:localValidate]] [[icon:triggerInfo]] [[icon:nope]]');
    expect(out).toContain('id="shield"');
    expect(out).toContain('id="info"');
    expect(out).not.toContain('[[');
  });

  it('does not treat inherited object keys as icons', () => {
    expect(sb.expandInlineMarkers('x [[icon:constructor]] y')).toBe('x  y');
    expect(sb.expandInlineMarkers('x [[icon:toString]] y')).toBe('x  y');
  });

  it('can be switched off, for print', () => {
    expect(sb.expandInlineMarkers('a [[icon:localValidate]] b', { icons: false })).toBe('a  b');
  });
});

describe('[[sc:Text]]: expansion', () => {
  it('becomes the divine-name span', () => {
    expect(sb.expandInlineMarkers('<p>The [[sc:Lord]] reigns.</p>')).toBe(`<p>The ${SPAN} reigns.</p>`);
  });

  it('allows letters in any script, combining marks, spaces, apostrophes and full stops', () => {
    expect(sb.expandInlineMarkers("[[sc:Lord of hosts]]")).toContain('>Lord of hosts<');
    expect(sb.expandInlineMarkers("[[sc:God's Name.]]")).toContain(">God's Name.<");
    expect(sb.expandInlineMarkers('[[sc:God’s]]')).toContain('>God’s<');
    expect(sb.expandInlineMarkers('[[sc:Yorùbá]]')).toContain('>Yorùbá<');
    expect(sb.expandInlineMarkers('[[sc:Ọlọ́run]]')).toContain('>Ọlọ́run<');
  });

  it('leaves anything else as literal text', () => {
    for (const bad of ['[[sc:]]', '[[sc: Lord]]', '[[sc:a1]]', '[[sc:a_b]]', '[[sc:a-b]]', '[[sc:a&amp;b]]',
                       '[[sc:a<b]]', '[[sc:' + 'a'.repeat(61) + ']]', '[sc:Lord]', '[[SC:Lord]]']) {
      expect(sb.expandInlineMarkers(bad), bad).toBe(bad);
    }
  });

  it('never rewrites inside a tag or attribute value', () => {
    const html = '<a href="[[sc:Lord]]" title=\'[[sc:x]] > y\'>go</a>';
    expect(sb.expandInlineMarkers(html)).toBe(html);
  });

  it('keeps hostile input inert', () => {
    // After DOMPurify or markdown-it the text holds no raw "<", and "<" is not an allowed character.
    for (const hostile of ['[[sc:<img onerror=x>]]', '[[sc:&lt;img onerror=x&gt;]]', '[[sc:Lord</span><script>x</script>]]',
                           '[[sc:"onmouseover=x]]', '[[sc:Lord" onclick="x]]']) {
      const out = sb.expandInlineMarkers(hostile);
      expect(out, hostile).toBe(hostile);
      expect(out).not.toContain('class="divine-name"');
    }
  });
});

describe('[[sc:Text]]: the five contexts', () => {
  const M = 'The [[sc:Lord]] reigns.';

  it('chapter text, HTML format', () => {
    expect(sb.renderFormatted(`<p>${M}</p>`, 'HTML')).toBe(`<p>The ${SPAN} reigns.</p>`);
  });

  it('chapter text, plainText format', () => {
    expect(sb.renderFormatted(M, 'plainText')).toContain(SPAN);
  });

  it('biblePassage.passageText and callout answer (pop-ups, via safeSetHtml)', () => {
    sb.safeSetHtml('pop', `<p><sup>1</sup>${M}</p>`);
    expect(sb.popup.innerHTML).toBe(`<p><sup>1</sup>The ${SPAN} reigns.</p>`);
    sb.safeSetHtml('pop', `<p>${M} [[icon:localValidate]]</p>`);
    expect(sb.popup.innerHTML).toContain(SPAN);
    expect(sb.popup.innerHTML).toContain('id="shield"');
  });

  it('Go Deeper body, HTML format (inserted as authored)', () => {
    expect(goDeeper(`<p>${M}</p>`, 'HTML')).toContain(`<p>The ${SPAN} reigns.</p>`);
  });

  it('Go Deeper body, markdown format, including inside emphasis', () => {
    const out = goDeeper(`${M} *[[sc:Lord]]* and **[[sc:Lord]]**`, 'markdown');
    expect(out.match(/<span class="divine-name">/g)).toHaveLength(3);
    expect(out).toContain(`<em>${SPAN}</em>`);
    expect(out).toContain(`<strong>${SPAN}</strong>`);
  });

  it('markdown arrays (intros) too', () => {
    expect(sb.renderFormattedArray([M], 'markdown')).toContain(SPAN);
  });

  it('an authored <span> in markdown is escaped to visible text (why the marker exists)', () => {
    const out = sb.renderFormatted(`The ${SPAN} reigns.`, 'markdown');
    expect(out).not.toContain('<span');
    expect(out).toContain('&lt;span class=');
  });

  it('hostile markdown input stays inert', () => {
    const out = sb.renderFormatted('[[sc:<img src=x onerror=alert(1)>]] and [[sc:Lord" onclick="x]]', 'markdown');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('class="divine-name"');
  });

  it('footnote markers and sc markers work side by side', () => {
    const out = sb.renderFormatted('The [[sc:Lord]] reigns.[[fn:1]]', 'markdown', [{ id: 1, body: 'Note.' }]);
    expect(out).toContain(SPAN);
    expect(out).toContain('footnote-btn');
  });
});

describe('plain-word consumers', () => {
  it('stripInlineMarkers gives the word, never the marker, and drops icons', () => {
    expect(sb.stripInlineMarkers('The [[sc:Lord]] says [[icon:localValidate]] hi')).toBe('The Lord says  hi');
    expect(sb.stripInlineMarkers(undefined)).toBe('');
    expect(sb.stripInlineMarkers('[[sc:<b>]]')).toBe('[[sc:<b>]]');
  });

  it('text-to-speech reads "Lord", not the marker', () => {
    expect(sb.ttsStripHtml('<p>The [[sc:Lord]] reigns [[icon:localValidate]].</p>')).toBe('The Lord reigns .');
  });

  it('search text uses the plain word', () => {
    expect(sb.stripHtml('<p>The [[sc:Lord]] reigns.</p>')).toBe('The Lord reigns.');
  });

  it('print keeps the word (as a small-capitals span) and drops icons', () => {
    expect(printMarkers('<div>The [[sc:Lord]] [[icon:localValidate]]reigns</div>'))
      .toBe(`<div>The ${SPAN} reigns</div>`);
  });

  it('print resolves markers in intro, bridge and closing, in both builders', () => {
    const sp = read('js/share-print.js');
    expect(sp.match(/_printMarkers\(ch\.intro/g)).toHaveLength(2);
    expect(sp.match(/_printMarkers\(sec\.bridge/g)).toHaveLength(2);
    expect(sp.match(/_printMarkers\(ch\.closing/g)).toHaveLength(2);
  });
});

describe('.divine-name styling', () => {
  const base = read('css/03-base.css');
  const rule = base.slice(base.indexOf('.divine-name {'), base.indexOf('}', base.indexOf('.divine-name {')));

  it('uses small capitals and tracking from a named variable, and sets no colour', () => {
    expect(rule).toContain('font-variant: small-caps');
    expect(rule).toContain('letter-spacing: var(--divine-name-tracking)');
    expect(rule).not.toMatch(/color\s*:/);
    expect(read('css/02-variables.css')).toMatch(/--divine-name-tracking:\s*0\.04em/);
  });

  it('is not overridden in dark mode or in the print styles', () => {
    for (const f of ['css/08-themes.css', 'css/06-overlays.css', 'css/07-pages.css']) {
      expect(read(f), f).not.toMatch(/divine-name/);
    }
  });

  it('is repeated in the print window, which is a separate document', () => {
    const sp = read('js/share-print.js');
    expect(sp).toContain('.divine-name { font-variant: small-caps; letter-spacing: ${divineNameTracking}; }');
    expect(sp).toContain("getPropertyValue('--divine-name-tracking')");
  });
});

describe('old WebViews', () => {
  it('format-text.js has no regex LITERAL with \\p{…}: on Chrome < 64 that would stop the whole file loading', () => {
    const code = read('js/format-text.js').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/\/[^/\n]*\\p\{[^/\n]*\/[gimsuy]*/);
    expect(code).toContain('_UNICODE_PROPS_OK');
  });
});

describe('wiring', () => {
  it('every formatted path, pop-up, Go Deeper body and intro expands markers after sanitising', () => {
    const ft = read('js/format-text.js');
    expect(ft).toContain('return expandInlineMarkers(html);');
    expect(ft.match(/expandInlineMarkers\(items\.map/g)).toHaveLength(2);
    expect(ft).toContain('body: expandInlineMarkers(sanitizeHtml(fn.body))');
    expect(read('js/modals.js')).toContain('expandInlineMarkers(DOMPurify.sanitize(');
    expect(read('js/render-pages.js')).toContain('expandInlineMarkers(Array.isArray(footnotes)');
    expect(read('js/search.js')).toContain('stripInlineMarkers(html)');
    expect(read('js/tts.js')).toContain('stripInlineMarkers(html)');
  });
});
