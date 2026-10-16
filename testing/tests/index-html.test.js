/**
 * Tests for the HTML shell (app/index.html and the root index.html copy).
 *
 * The shell loads ~35 classic scripts whose order matters, and the repo keeps
 * a second copy at the root that once drifted (it lacked newer scripts). These
 * tests catch: the copies diverging, a referenced file that doesn't exist, a
 * new js file nobody added a <script> tag for, and a load-time dependency
 * loaded too late.
 *
 * Paths are relative to testing/tests/ — the app is in ../../app/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '../..');
const APP       = join(ROOT, 'app');

const html    = readFileSync(join(APP, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
const styles  = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"?]+)/g)].map(m => m[1]);
const indexOf = name => scripts.indexOf(`js/${name}`);

describe('index.html shell', () => {
  it('the root index.html is identical to app/index.html', () => {
    expect(readFileSync(join(ROOT, 'index.html'), 'utf8')).toBe(html);
  });

  it('references scripts and stylesheets', () => {
    expect(scripts.length).toBeGreaterThan(30);
    expect(styles.length).toBeGreaterThan(5);
  });

  it.each([...scripts, ...styles])('%s exists', file => {
    expect(existsSync(join(APP, file))).toBe(true);
  });

  it('loads every first-party js file in app/js exactly once', () => {
    const files = readdirSync(join(APP, 'js')).filter(f => f.endsWith('.js'));
    for (const f of files) {
      expect(scripts.filter(s => s === `js/${f}`), `${f} should appear once`).toHaveLength(1);
    }
  });

  it('has no duplicate script tags', () => {
    expect(new Set(scripts).size).toBe(scripts.length);
  });
});

describe('script load order (load-time dependencies)', () => {
  const before = (a, b) => expect(indexOf(a), `${a} before ${b}`).toBeLessThan(indexOf(b));

  it('format-text.js needs DOMPurify and markdown-it', () => {
    before('purify.min.js', 'format-text.js');
    before('markdown-it.min.js', 'format-text.js');
  });

  it('render-progress.js and save.js need debounce() from search.js', () => {
    before('search.js', 'render-progress.js');
    before('search.js', 'save.js');
  });

  it('save.js needs updateProgress() from render-progress.js', () => {
    before('render-progress.js', 'save.js');
  });

  it('state.js loads before the files that read its globals', () => {
    for (const f of ['i18n.js', 'idb.js', 'settings.js', 'router.js', 'study-loader.js']) before('state.js', f);
  });

  it('gallery.js loads before render-pages.js (which calls it)', () => {
    before('gallery.js', 'render-pages.js');
  });

  it('answer-match.js loads before validation.js (which calls it)', () => {
    before('answer-match.js', 'validation.js');
  });
});
