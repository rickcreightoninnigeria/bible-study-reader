/**
 * The footnote anchor (.footnote-btn): it had no CSS, so the number showed as a
 * default grey browser button nearly the size of the body text. Checks the rule
 * that styles it (CSS is read as text; the look itself is checked in a browser).
 *
 * Paths are relative to testing/tests/ — the stylesheet is ../../app/css/07-pages.css
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dirname, '../../app/css/07-pages.css'), 'utf8');

// The declarations of the first rule whose selector is exactly `selector`.
function rule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}

describe('.footnote-btn', () => {
  const body = rule('.footnote-btn');

  it('has a rule', () => {
    expect(body).not.toBeNull();
  });

  it('is a plain number: no button box', () => {
    expect(body).toMatch(/background:\s*none/);
    expect(body).toMatch(/border:\s*none/);
  });

  it('takes its size from the superscript around it, not the browser default', () => {
    expect(body).toMatch(/font:\s*inherit/);
    expect(body).not.toMatch(/font-size:\s*\d/);   // no fixed size: it scales with the reader's text size
  });

  it('is set apart by the emphasis colour and semi-bold, not by an underline', () => {
    expect(body).toMatch(/color:\s*var\(--emphasis\)/);
    expect(body).toMatch(/font-weight:\s*600/);
    expect(body).not.toMatch(/text-decoration/);
  });

  it('does not make its line taller', () => {
    expect(body).toMatch(/line-height:\s*0\b/);
  });

  it('has an invisible tap area larger than the number, which does not affect layout', () => {
    expect(body).toMatch(/position:\s*relative/);
    const area = rule('.footnote-btn::after');
    expect(area).toMatch(/position:\s*absolute/);
    expect(area).toMatch(/inset:\s*-\d+px -\d+px/);
  });

  it('shows keyboard focus, and has a legible dark-mode colour', () => {
    expect(rule('.footnote-btn:focus-visible')).toMatch(/outline:\s*2px solid/);
    expect(rule('body.dark-mode .footnote-btn')).toMatch(/color:\s*var\(--accent-light\)/);
  });
});
