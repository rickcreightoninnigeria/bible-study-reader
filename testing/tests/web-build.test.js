/**
 * The web build: py/build_web.py, the manifest and the head tags that make the
 * app installable.
 *
 *  - The build copies app/ without the author tools, writes sw.js with a file
 *    list and a build id that changes whenever any cached file changes, and
 *    refuses unsafe output folders.
 *  - It is run on the real app/ too: every file the shell needs is in the
 *    list, and every listed file exists.
 *  - manifest.webmanifest and index.html name icons that exist.
 *
 * Paths are relative to testing/tests/ — source files are in ../../
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync, readdirSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');
const APP = join(REPO, 'app');
const SCRIPT = join(REPO, 'py', 'build_web.py');

const scratch = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'bsr-web-')); scratch.push(d); return d; };
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })));

const run = (script, args) => spawnSync('python3', ['-I', script, ...args], { encoding: 'utf8' });

function precacheOf(swPath) {
  const sw = readFileSync(swPath, 'utf8');
  const m = sw.match(/^const PRECACHE = (\[[\s\S]*?\]);\s*\/\/ __PRECACHE__/m);
  expect(m, 'PRECACHE line').toBeTruthy();
  return { sw, list: JSON.parse(m[1]), id: sw.match(/^const BUILD_ID = '([^']+)'/m)[1] };
}

// ── a small fixture repo: py/build_web.py plus a tiny app/ ───────────────────

function fixture() {
  const root = tmp();
  mkdirSync(join(root, 'py'));
  copyFileSync(SCRIPT, join(root, 'py', 'build_web.py'));
  const app = join(root, 'app');
  for (const d of ['css', 'js/locales/en', 'images', 'fonts', 'estudy']) mkdirSync(join(app, d), { recursive: true });
  const w = (p, c) => writeFileSync(join(app, p), c);
  w('index.html', '<html><head><link rel="stylesheet" href="css/a.css?v=2"><link rel="manifest" href="manifest.webmanifest">' +
    '<link rel="icon" href="images/favicon.svg"></head><body><script src="js/app.js"></script>' +
    '<script src="https://cdn.example.com/x.js"></script></body></html>');
  w('manifest.webmanifest', '{}');
  w('css/a.css', 'body{}');
  w('css/01-fonts.css', "@font-face{src:url('../fonts/Inter-Regular.ttf')} @font-face{src:url('../fonts/NotoSansArabic-Regular.ttf')}");
  w('js/app.js', 'console.log(1)');
  w('js/appAboutData_untranslated.json', '{}');
  w('js/locales/en/ui_en.json', '{}');
  w('images/favicon.svg', '<svg/>');
  w('fonts/Inter-Regular.ttf', 'inter');
  w('fonts/NotoSansArabic-Regular.ttf', 'noto');
  w('estudy-editor.html', 'editor'); w('study-editor.html', 'editor'); w('ui-translate.html', 'tool');
  w('sw.js', readFileSync(join(APP, 'sw.js'), 'utf8'));
  return { root, app, script: join(root, 'py', 'build_web.py'), out: join(root, 'dist', 'web') };
}

describe('the build', () => {
  it('copies the app without the author tools, and writes a generated sw.js', () => {
    const f = fixture();
    const r = run(f.script, ['--out', f.out]);
    expect(r.status, r.stderr).toBe(0);
    for (const kept of ['index.html', 'manifest.webmanifest', 'css/a.css', 'js/app.js', 'fonts/Inter-Regular.ttf']) {
      expect(existsSync(join(f.out, kept)), kept).toBe(true);
    }
    for (const left of ['estudy-editor.html', 'study-editor.html', 'ui-translate.html']) {
      expect(existsSync(join(f.out, left)), left).toBe(false);
    }
    const { sw, id } = precacheOf(join(f.out, 'sw.js'));
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(sw).toContain('// __BUILD_ID__');
  });

  it('lists what the shell needs (without query strings or other sites), strings, and only the Latin fonts', () => {
    const f = fixture();
    run(f.script, ['--out', f.out]);
    const { list } = precacheOf(join(f.out, 'sw.js'));
    const urls = list.map(e => e.url);
    expect(urls).toEqual(expect.arrayContaining(['index.html', 'manifest.webmanifest', 'css/a.css', 'js/app.js',
      'js/appAboutData_untranslated.json', 'js/locales/en/ui_en.json']));
    expect(urls.some(u => u.includes('cdn.example.com') || u.includes('?'))).toBe(false);
    expect(urls).toContain('fonts/Inter-Regular.ttf');
    expect(urls).not.toContain('fonts/NotoSansArabic-Regular.ttf');
    const byUrl = Object.fromEntries(list.map(e => [e.url, e]));
    expect(byUrl['js/app.js'].optional).toBeUndefined();
    expect(byUrl['fonts/Inter-Regular.ttf'].optional).toBe(true);
    expect(byUrl['images/favicon.svg'].optional).toBe(true);
  });

  it('ships the starter studies but does not precache them (the first run fetches them once)', () => {
    const f = fixture();
    writeFileSync(join(f.app, 'estudy', 'firstEstudies.zip'), 'zip');
    run(f.script, ['--out', f.out]);
    expect(existsSync(join(f.out, 'estudy', 'firstEstudies.zip'))).toBe(true);
    expect(precacheOf(join(f.out, 'sw.js')).list.some(x => x.url === 'estudy/firstEstudies.zip')).toBe(false);
  });

  it('renders PRIVACY_POLICY.md as privacy.html (Google Play\'s privacy policy URL), not precached', () => {
    const f = fixture();
    writeFileSync(join(f.root, 'PRIVACY_POLICY.md'), [
      'PRIVACY POLICY — TEST APP', '', 'Last updated: 1 January 2026', '', 'Intro <b>text</b>.', '',
      '────────', '1. SUMMARY', '', 'Mail a@b.org please.', '', '• one', '• two', '',
      '────────', '2. TEXT-TO-SPEECH (READ ALOUD)', '', '2a. A sub-heading', 'Body.', ''].join('\n'));
    run(f.script, ['--out', f.out]);
    const page = readFileSync(join(f.out, 'privacy.html'), 'utf8');
    expect(page).toContain('<title>Privacy Policy — Test App</title>');
    expect(page).toContain('<p class="updated">Last updated: 1 January 2026</p>');
    expect(page).toContain('<h2>1. Summary</h2>');
    expect(page).toContain('<h2>2. Text-to-speech (read aloud)</h2>');
    expect(page).toContain('<h3>2a. A sub-heading</h3>');
    expect(page).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(page).toContain('Intro &lt;b&gt;text&lt;/b&gt;.');
    expect(page).toContain('<a href="mailto:a@b.org">a@b.org</a>');
    expect(precacheOf(join(f.out, 'sw.js')).list.some(x => x.url === 'privacy.html')).toBe(false);
  });

  it('writes no privacy.html when there is no PRIVACY_POLICY.md', () => {
    const f = fixture();
    run(f.script, ['--out', f.out]);
    expect(existsSync(join(f.out, 'privacy.html'))).toBe(false);
  });

  it('gives the same id for the same files, and a new id (and new sw.js) when a cached file changes', () => {
    const f = fixture();
    run(f.script, ['--out', f.out]);
    const a = precacheOf(join(f.out, 'sw.js'));
    run(f.script, ['--out', f.out]);
    expect(precacheOf(join(f.out, 'sw.js')).id).toBe(a.id);

    writeFileSync(join(f.app, 'js', 'app.js'), 'console.log(2)');
    run(f.script, ['--out', f.out]);
    const b = precacheOf(join(f.out, 'sw.js'));
    expect(b.id).not.toBe(a.id);
    expect(b.sw).not.toBe(a.sw);
    expect(b.list.find(e => e.url === 'js/app.js').hash).not.toBe(a.list.find(e => e.url === 'js/app.js').hash);
    expect(b.list.find(e => e.url === 'css/a.css').hash).toBe(a.list.find(e => e.url === 'css/a.css').hash);
  });

  it('keeps the id when only an uncached file (an unused font) changes', () => {
    const f = fixture();
    run(f.script, ['--out', f.out]);
    const a = precacheOf(join(f.out, 'sw.js')).id;
    writeFileSync(join(f.app, 'fonts', 'NotoSansArabic-Regular.ttf'), 'changed');
    run(f.script, ['--out', f.out]);
    expect(precacheOf(join(f.out, 'sw.js')).id).toBe(a);
  });

  it('stops when a file the shell needs is missing', () => {
    const f = fixture();
    rmSync(join(f.app, 'js', 'app.js'));
    const r = run(f.script, ['--out', f.out]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('js/app.js');
  });

  it('stops when the marked lines in sw.js have gone', () => {
    const f = fixture();
    writeFileSync(join(f.app, 'sw.js'), '// no markers here\n');
    const r = run(f.script, ['--out', f.out]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('PRECACHE');
  });

  it('refuses an output folder that could be the source, or that holds other files', () => {
    const f = fixture();
    for (const bad of [f.root, f.app, join(f.app, '..', '..')]) {
      expect(run(f.script, ['--out', bad]).status, bad).not.toBe(0);
    }
    const other = tmp();
    writeFileSync(join(other, 'precious.txt'), 'keep me');
    expect(run(f.script, ['--out', other]).status).not.toBe(0);
    expect(existsSync(join(other, 'precious.txt'))).toBe(true);
    expect(existsSync(join(f.app, 'index.html'))).toBe(true);
  });

  it('may replace an earlier build in the same folder', () => {
    const f = fixture();
    expect(run(f.script, ['--out', f.out]).status).toBe(0);
    expect(run(f.script, ['--out', f.out]).status).toBe(0);
  });
});

describe('the real app', () => {
  const out = join(tmp(), 'web');
  const r = run(SCRIPT, ['--out', out]);

  it('builds', () => {
    expect(r.status, r.stderr).toBe(0);
  });

  it('lists every script and stylesheet index.html loads, and every listed file exists', () => {
    const { list } = precacheOf(join(out, 'sw.js'));
    const urls = new Set(list.map(e => e.url));
    const html = readFileSync(join(APP, 'index.html'), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"?#]+)/g)].map(m => m[1]);
    expect(refs.length).toBeGreaterThan(30);
    for (const ref of refs) expect(urls.has(ref), ref).toBe(true);
    for (const e of list) expect(existsSync(join(out, e.url)), e.url).toBe(true);
    for (const must of ['index.html', 'manifest.webmanifest', 'js/appAboutData_untranslated.json', 'js/locales/en/ui_en.json']) {
      expect(urls.has(must), must).toBe(true);
    }
  });

  it('does not ship the author tools, and ships the service worker and the starter studies', () => {
    expect(existsSync(join(out, 'estudy-editor.html'))).toBe(false);
    expect(existsSync(join(out, 'sw.js'))).toBe(true);
    expect(existsSync(join(out, 'estudy', 'firstEstudies.zip'))).toBe(true);
    expect(precacheOf(join(out, 'sw.js')).list.some(e => e.url === 'estudy/firstEstudies.zip')).toBe(false);
  });

  it('keeps the precache modest (so a first visit on mobile data stays small)', () => {
    const { list } = precacheOf(join(out, 'sw.js'));
    const bytes = list.reduce((n, e) => n + readFileSync(join(out, e.url)).length, 0);
    expect(bytes).toBeLessThan(10 * 1024 * 1024);
  });
});

describe('installability', () => {
  const manifest = JSON.parse(readFileSync(join(APP, 'manifest.webmanifest'), 'utf8'));
  const html = readFileSync(join(APP, 'index.html'), 'utf8');

  it('has a manifest an iPhone and Android can install from', () => {
    expect(manifest.short_name).toBe('BSR');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.theme_color).toBe('#1c1710');
  });

  it('names icons that exist, including a maskable one', () => {
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    for (const icon of manifest.icons) expect(existsSync(join(APP, icon.src)), icon.src).toBe(true);
    expect(manifest.icons.some(i => i.purpose === 'maskable')).toBe(true);
    expect(manifest.icons.some(i => i.sizes === '192x192')).toBe(true);
    expect(manifest.icons.some(i => i.sizes === '512x512' && i.purpose === 'any')).toBe(true);
  });

  it('links the manifest and Apple tags from index.html', () => {
    expect(html).toContain('<link rel="manifest" href="manifest.webmanifest">');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="BSR">');
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">');
    expect(html).toContain('<meta name="theme-color" content="#1c1710">');
    const touch = html.match(/<link rel="apple-touch-icon" href="([^"]+)">/);
    expect(touch).toBeTruthy();
    expect(existsSync(join(APP, touch[1]))).toBe(true);
  });

  it('has a touch icon with no transparency (iPhone fills transparent pixels with black)', () => {
    const png = readFileSync(join(APP, 'images', 'apple-touch-icon.png'));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    const colourType = png[25];             // IHDR colour type: 2 = RGB, 6 = RGBA
    expect(colourType).toBe(2);
  });

  it('uses relative paths only, so it works from a sub-folder such as github.io/bible-study-reader/', () => {
    for (const icon of manifest.icons) expect(icon.src.startsWith('/')).toBe(false);
    expect(readFileSync(join(APP, 'js', 'web-app.js'), 'utf8')).toContain("'sw.js'");
  });
});
