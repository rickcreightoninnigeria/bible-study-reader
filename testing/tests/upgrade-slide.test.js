/**
 * The post-update ("What's New") slide, getUpgradeOnboardingSlides() in
 * onboarding.js. Policy (see the comment above the function): every reader-visible
 * change adds a bullet; a big update bumps appVersion and starts a new list, and
 * the list is capped at 8 bullets so it stays readable on a phone. When this
 * test fails on the cap, bump the version and clear the old bullets.
 *
 * The function is cut out of onboarding.js and run in a vm sandbox.
 *
 * Paths are relative to testing/tests/ — sources are in ../../app/js/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JS = join(__dirname, '../../app/js');
const about = JSON.parse(readFileSync(join(APP_JS, 'appAboutData_untranslated.json'), 'utf8'));

const MAX_BULLETS = 8;

function slides(appVersion = about.appVersion) {
  const src = readFileSync(join(APP_JS, 'onboarding.js'), 'utf8');
  const a = src.indexOf('function getUpgradeOnboardingSlides() {');
  const b = src.indexOf('// FEATURE TUTORIALS');
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  const sandbox = { window: { appAboutData: { appVersion } } };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(a, b), sandbox, { filename: 'upgrade-slide' });
  return sandbox.getUpgradeOnboardingSlides();
}

describe('the What’s New slide', () => {
  const list = slides();
  const html = list.map(s => s.body).join('');
  const bullets = html.match(/<li>[\s\S]*?<\/li>/g) || [];

  it('has a slide, headed with the current app version', () => {
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].eyebrow).toContain(`v${about.appVersion}`);
    expect(slides('9.9.9')[0].eyebrow).toContain('v9.9.9');
  });

  it(`has at most ${MAX_BULLETS} bullets (more than that: bump the version and start a new list)`, () => {
    expect(bullets.length).toBeGreaterThanOrEqual(1);
    expect(bullets.length).toBeLessThanOrEqual(MAX_BULLETS);
  });

  it('every bullet is a bold lead-in followed by one plain sentence or two', () => {
    for (const li of bullets) {
      expect(li, li).toMatch(/^<li><b>[^<]+<\/b> [^<]{15,}<\/li>$/);
    }
  });

  it('has no repeated lead-in', () => {
    const leads = bullets.map(li => li.match(/<b>([^<]+)<\/b>/)[1]);
    expect(new Set(leads).size).toBe(leads.length);
  });

  it('is well-formed: balanced list tags and no script or attribute', () => {
    expect((html.match(/<ul>/g) || []).length).toBe((html.match(/<\/ul>/g) || []).length);
    expect(html).not.toMatch(/<script|on\w+=|style=/i);
  });
});
