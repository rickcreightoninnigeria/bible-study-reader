/**
 * Every locale carries the strings added for error reporting, diagnostics and
 * study-version handling, with the same {placeholders} as the English text
 * (a translated placeholder name would show up literally on screen).
 *
 * Paths are relative to testing/tests/ — locale files are in ../../app/js/locales/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(__dirname, '../../app/js/locales');
const load = lang => JSON.parse(readFileSync(join(LOCALES, lang, `ui_${lang}.json`), 'utf8'));

const en = load('en');
const KEYS = Object.keys(en).filter(k =>
  /^(errorreport_|diag_|versioncheck_)/.test(k) ||
  ['renderpages_tab_diagnostics', 'main_titlepage_study_version', 'studyloader_version_updating'].includes(k));
const placeholders = s => (s.match(/\{[A-Za-z]+\}/g) || []).sort();
const langs = readdirSync(LOCALES).filter(l => l !== 'en');

describe('error-reporting strings in every locale', () => {
  it('covers a meaningful set of keys and every non-English locale', () => {
    expect(KEYS.length).toBe(88);
    expect(langs.length).toBeGreaterThanOrEqual(17);
  });

  for (const lang of langs) {
    it(`${lang}: has every key, non-empty, with the English placeholders`, () => {
      const d = load(lang);
      const problems = [];
      for (const k of KEYS) {
        const v = d[k];
        if (typeof v !== 'string' || !v.trim()) { problems.push(`${k}: missing or empty`); continue; }
        if (placeholders(v).join() !== placeholders(en[k]).join()) problems.push(`${k}: placeholders ${placeholders(v)} vs ${placeholders(en[k])}`);
        if (v !== v.trim()) problems.push(`${k}: surrounding space`);
      }
      expect(problems).toEqual([]);
    });
  }
});
