/**
 * List indentation in Go Deeper / Leaders' Notes cards and in every pop-up.
 *
 * The global reset (03-base.css) strips the browser's list indent, so each
 * container that shows author or study HTML needs its own list rule. These tests
 * read the stylesheets: the actual layout (light, dark, right-to-left, wrapped
 * and nested lists) was checked in a real browser.
 *
 * Paths are relative to testing/tests/ — stylesheets are in ../../app/css/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = f => readFileSync(join(__dirname, '../../app/css', f), 'utf8');
const pages = css('07-pages.css');
const overlays = css('06-overlays.css');
const vars = css('02-variables.css');
const responses = css('05b-components.cards.responses.css');

// The declaration block of the first rule whose selector list contains `selector`.
function ruleFor(sheet, selector) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(sheet))) {
    const sels = m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map(s => s.trim());
    if (sels.includes(selector)) return m[2];
  }
  return null;
}

describe('Go Deeper and Leaders\' Notes lists', () => {
  const containers = ['.go-deeper-block', '.go-deeper-intro', '.leaders-block', '.leaders-intro'];

  it('defines the indent as a named variable', () => {
    expect(vars).toMatch(/--prose-list-indent:\s*1\.4em;/);
  });

  for (const c of containers) {
    for (const tag of ['ul', 'ol']) {
      it(`${c} ${tag} is indented with the variable and a logical property`, () => {
        const rule = ruleFor(pages, `${c} ${tag}`);
        expect(rule, `${c} ${tag}`).not.toBeNull();
        expect(rule).toContain('padding-inline-start: var(--prose-list-indent)');
        expect(rule).not.toMatch(/padding-left|padding-right/);
      });
    }
    it(`${c} nested lists are set tighter`, () => {
      expect(ruleFor(pages, `${c} ul ul`)).toMatch(/margin:\s*4px 0/);
      expect(ruleFor(pages, `${c} ol ul`)).not.toBeNull();
    });
  }

  it('list items read like the paragraphs, in dark mode too', () => {
    expect(ruleFor(pages, '.go-deeper-block li')).toContain('color: var(--text-secondary)');
    expect(ruleFor(pages, 'body.dark-mode .go-deeper-block li')).toContain('var(--dm-text-mid)');
    expect(ruleFor(pages, 'body.dark-mode .leaders-block li')).toContain('var(--dm-text-mid)');
  });

  it('lists inside tables keep their own tighter rule, which comes later and so wins', () => {
    const table = pages.indexOf('.go-deeper-table ul,');
    const block = pages.indexOf('.go-deeper-block ul,');
    expect(block).toBeGreaterThan(-1);
    expect(table).toBeGreaterThan(block);
    expect(ruleFor(pages, '.go-deeper-table li')).toContain('margin-bottom: 0');
  });

  it('avoids :is(), which older Android WebViews do not know', () => {
    expect(pages.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain(':is(');
  });
});

describe('every pop-up that shows study HTML indents its lists', () => {
  const popups = ['.verse-modal-text', '.qa-modal-text', '.deeper-modal-body', '.info-modal-body'];
  for (const p of popups) {
    for (const tag of ['ul', 'ol']) {
      it(`${p} ${tag}`, () => {
        const rule = ruleFor(overlays, `${p} ${tag}`);
        expect(rule, `${p} ${tag}`).not.toBeNull();
        expect(rule).toMatch(/padding-inline-start:\s*[\d.]+(em|rem)|padding-inline-start:\s*var\(--prose-list-indent\)/);
      });
    }
  }
});

describe('author-supplied text outside pop-ups and Go Deeper', () => {
  const cases = [
    ['.question-text', responses],
    ['.howto-block-body', pages],
    ['.title-page-desc', pages],
  ];
  for (const [c, sheet] of cases) {
    for (const tag of ['ul', 'ol']) {
      it(`${c} ${tag} is indented with the variable and a logical property`, () => {
        const rule = ruleFor(sheet, `${c} ${tag}`);
        expect(rule, `${c} ${tag}`).not.toBeNull();
        expect(rule).toContain('padding-inline-start: var(--prose-list-indent)');
        expect(rule).not.toMatch(/padding-left|padding-right/);
      });
    }
  }

  it('How-to list items read like its paragraphs, in dark mode too', () => {
    expect(ruleFor(pages, '.howto-block-body li')).toContain('color: var(--text-secondary)');
    expect(ruleFor(pages, 'body.dark-mode .howto-block-body li')).toContain('var(--dm-text-mid)');
  });
});

describe('the upgrade slide', () => {
  const src = readFileSync(join(__dirname, '../../app/js/onboarding.js'), 'utf8');
  it('no longer describes the old storage change', () => {
    expect(src).not.toContain('moving to database storage');
    expect(src).toContain('Settings → Diagnostics');
  });
});
