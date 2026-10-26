/**
 * The button bar at the foot of a chapter: Print, Share and Recommend (no Save
 * button — answers save themselves). Covers the markup, the rule that drops the
 * icons when a label wraps, the heart icon in every icon set, and the strings
 * in every locale.
 *
 * Paths are relative to testing/tests/ — sources are in ../../app/js/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JS = join(__dirname, '../../app/js');
const LOCALES = join(APP_JS, 'locales');
const load = lang => JSON.parse(readFileSync(join(LOCALES, lang, `ui_${lang}.json`), 'utf8'));
const langs = readdirSync(LOCALES);

function loadBar(extra = {}) {
  const sandbox = {
    console,
    t: key => key,
    ICONS: { print: '<i-print/>', share: '<i-share/>', recommend: '<i-heart/>' },
    debounce: fn => fn,
    window: { addEventListener() {} },
    ...extra,
    document: { addEventListener() {}, ...extra.document },
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(APP_JS, 'render-chapter-ui.js'), 'utf8'), sandbox);
  return sandbox;
}

describe('buildSaveBar', () => {
  const html = loadBar().buildSaveBar({});
  const buttons = html.match(/<button[\s\S]*?<\/button>/g);

  it('has Print, Share and Recommend, in that order, and no Save button', () => {
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toContain('printChapter()');
    expect(buttons[1]).toContain('shareAnswers()');
    expect(buttons[2]).toContain('shareAppLink()');
    expect(html).not.toContain('saveAnswers');
  });

  it('puts each icon and each label in its own span', () => {
    expect(buttons[0]).toContain('<span class="save-btn-icon"><i-print/></span><span class="save-btn-label">renderchapter_print_btn</span>');
    expect(buttons[1]).toContain('<span class="save-btn-icon"><i-share/></span><span class="save-btn-label">renderchapter_share_btn</span>');
    expect(buttons[2]).toContain('<span class="save-btn-icon"><i-heart/></span><span class="save-btn-label">renderchapter_recommend_btn</span>');
  });
});

describe('fitSaveBar', () => {
  // A bar whose labels report the given line tops (one number = one line).
  function setup(labelLines) {
    const classes = new Set();
    const labels = labelLines.map(lines => ({ lines }));
    const bar = {
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
      querySelectorAll: sel => (sel === '.save-btn-label' ? labels : []),
    };
    const document = {
      querySelector: sel => (sel === '.save-bar' ? bar : null),
      createRange: () => {
        let node;
        return { selectNodeContents: n => { node = n; }, getClientRects: () => node.lines.map(top => ({ top })) };
      },
    };
    const ctx = loadBar({ document });
    return { ctx, classes, labels, document };
  }

  it('keeps the icons when every label fits on one line', () => {
    const { ctx, classes } = setup([[10], [10], [10]]);
    ctx.fitSaveBar();
    expect(classes.has('no-icons')).toBe(false);
  });

  it('hides the icons on the whole bar when any one label wraps', () => {
    const { ctx, classes } = setup([[10], [10], [10, 24]]);
    ctx.fitSaveBar();
    expect(classes.has('no-icons')).toBe(true);
  });

  it('treats several rects on one line as one line', () => {
    const { ctx, classes } = setup([[10, 10.2], [10], [10]]);
    ctx.fitSaveBar();
    expect(classes.has('no-icons')).toBe(false);
  });

  it('shows the icons again when the labels fit after a resize', () => {
    const { ctx, classes, labels } = setup([[10], [10], [10, 24]]);
    ctx.fitSaveBar();
    expect(classes.has('no-icons')).toBe(true);
    labels[2].lines = [10];
    ctx.fitSaveBar();
    expect(classes.has('no-icons')).toBe(false);
  });

  it('does nothing when there is no bar on the page', () => {
    const ctx = loadBar({ document: { querySelector: () => null } });
    expect(() => ctx.fitSaveBar()).not.toThrow();
  });
});

describe('the heart icon', () => {
  it('is defined in every icon set', () => {
    const src = readFileSync(join(APP_JS, 'icons.js'), 'utf8');
    expect(src.match(/^ {2}recommend:\s+`<svg/gm)).toHaveLength(3);
  });
});

describe('strings in every locale', () => {
  const en = load('en');

  it('covers every locale', () => {
    expect(langs.length).toBeGreaterThanOrEqual(18);
  });

  for (const lang of langs) {
    it(`${lang}: has the Recommend strings, a short label, and no Save-button strings`, () => {
      const d = load(lang);
      for (const k of ['renderchapter_recommend_btn', 'renderpages_shareapp_know_btn', 'renderpages_shareapp_heading',
        'renderpages_chapters_autosave_label', 'renderpages_chapters_autosave_desc']) {
        expect(typeof d[k] === 'string' && d[k].trim() !== '', `${k} missing or empty`).toBe(true);
        expect(d[k], `${k} has surrounding space`).toBe(d[k].trim());
      }
      // The button has room for about 65px of text beside its icon; this keeps a translation short.
      expect([...d.renderchapter_recommend_btn].length).toBeLessThanOrEqual(12);
      // Recommend is not the same word as Share.
      expect(d.renderchapter_recommend_btn).not.toBe(d.renderchapter_share_btn);
      expect(d).not.toHaveProperty('renderchapter_save_btn');
      expect(d).not.toHaveProperty('renderpages_chapters_save_label');
      expect(d).not.toHaveProperty('renderpages_chapters_save_desc');
    });
  }

  it('English no longer sends readers to a Save button', () => {
    for (const k of ['onboarding_autosave_slide1_body', 'renderchapter_eyebrow_info_body', 'renderpages_chapters_autosave_desc']) {
      expect(en[k]).not.toMatch(/Save button/);
    }
  });
});
