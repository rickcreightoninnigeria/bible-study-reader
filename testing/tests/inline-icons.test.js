/**
 * Inline icons: [[icon:name]] markers in study text.
 *
 * expandIconMarkers() / stripIconMarkers() (format-text.js) are cut out of the
 * source and run in a vm sandbox with a stand-in ICONS object.
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

const sandbox = { ICONS: { localValidate: '<svg id="shield"></svg>', triggerInfo: '<svg id="info"></svg>' } };
vm.createContext(sandbox);
vm.runInContext(
  slice(read('js/format-text.js'), 'const _ICON_MARKER_RE', '// ── renderFormatted('),
  sandbox, { filename: 'format-text-icons' });
const { expandIconMarkers, stripIconMarkers } = sandbox;

describe('expandIconMarkers', () => {
  it('swaps a known marker for the app icon, wrapped and hidden from screen readers', () => {
    expect(expandIconMarkers('<p>Tap Check [[icon:localValidate]] now</p>'))
      .toBe('<p>Tap Check <span class="inline-icon" aria-hidden="true"><svg id="shield"></svg></span> now</p>');
  });

  it('handles several markers in one string', () => {
    const out = expandIconMarkers('[[icon:localValidate]] and [[icon:triggerInfo]]');
    expect(out).toContain('id="shield"');
    expect(out).toContain('id="info"');
    expect(out).not.toContain('[[');
  });

  it('removes an unknown name instead of showing the marker', () => {
    expect(expandIconMarkers('<p>a [[icon:nope]] b</p>')).toBe('<p>a  b</p>');
  });

  it('does not treat inherited object keys as icons', () => {
    expect(expandIconMarkers('x [[icon:constructor]] y')).toBe('x  y');
    expect(expandIconMarkers('x [[icon:toString]] y')).toBe('x  y');
  });

  it('never puts an icon inside a tag or attribute value', () => {
    const html = '<a href="[[icon:localValidate]]" title=\'[[icon:triggerInfo]] > x\'>go</a>';
    expect(expandIconMarkers(html)).toBe(html);
  });

  it('leaves text without markers, and empty input, untouched', () => {
    expect(expandIconMarkers('<p>plain</p>')).toBe('<p>plain</p>');
    expect(expandIconMarkers('')).toBe('');
    expect(expandIconMarkers(null)).toBe(null);
  });

  it('ignores near-miss markers', () => {
    expect(expandIconMarkers('[[icon:]] [[icon:a b]] [icon:localValidate]'))
      .toBe('[[icon:]] [[icon:a b]] [icon:localValidate]');
  });
});

describe('stripIconMarkers', () => {
  it('removes markers from raw text for search and speech', () => {
    expect(stripIconMarkers('Tap Check [[icon:localValidate]] to see')).toBe('Tap Check  to see');
    expect(stripIconMarkers(undefined)).toBe('');
  });
});

describe('wiring', () => {
  it('is applied on every formatting path and by search and speech', () => {
    const ft = read('js/format-text.js');
    expect(ft).toContain('return expandIconMarkers(html);');
    expect(ft).toMatch(/expandIconMarkers\(items\.map/g);
    expect(ft).toContain('body: expandIconMarkers(sanitizeHtml(fn.body))');
    expect(read('js/render-pages.js')).toContain('expandIconMarkers(Array.isArray(footnotes)');
    expect(read('js/search.js')).toContain('stripIconMarkers(html)');
    expect(read('js/tts.js')).toContain('stripIconMarkers(html)');
  });
});
