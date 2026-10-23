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

// A translated placeholder name is shown literally on screen. Translations may
// leave a placeholder out, but may never invent or rename one.
describe('placeholders in every string of every locale', () => {
  const noPlural = s => s.replace(/\{\w+,\s*plural,[^}]*\}[^}]*\}\}/g, '');
  const simple = s => (noPlural(s).match(/\{[^{}\s,]+\}/g) || []);
  for (const lang of langs) {
    it(`${lang}: uses only placeholders that the English string has`, () => {
      const d = load(lang);
      const bad = [];
      for (const [k, v] of Object.entries(d)) {
        if (typeof v !== 'string' || typeof en[k] !== 'string') continue;
        const allowed = new Set(simple(en[k]));
        for (const p of simple(v)) if (!allowed.has(p)) bad.push(`${k}: ${p}`);
      }
      expect(bad).toEqual([]);
    });
  }
});

describe('t() plural form', () => {
  const src = readFileSync(join(__dirname, '../../app/js/i18n.js'), 'utf8');
  const a = src.indexOf('function t(key, vars)');
  const b = src.indexOf('\n}\n', a) + 3;
  const make = strings => new Function('window', 'console', src.slice(a, b) + '; return t;')({ appStrings: strings }, { warn() {} });

  it('picks one/other by count', () => {
    const t = make({ k: '{count} more section{count, plural, one{} other{s}} left' });
    expect(t('k', { count: 1 })).toBe('1 more section left');
    expect(t('k', { count: 3 })).toBe('3 more sections left');
  });

  it('leaves strings without a plural alone, and copes with no variables', () => {
    const t = make({ a: 'Hello {name}', p: 'x{count, plural, one{} other{s}}' });
    expect(t('a', { name: 'Ada' })).toBe('Hello Ada');
    expect(t('p')).toBe('xs');
  });

  it('the English Paths note no longer shows the raw pattern', () => {
    const t = make({ k: en.renderlib_paths_hidden_note });
    expect(t('k', { count: 2 })).toMatch(/^2 more sections in this pathway/);
    expect(t('k', { count: 1 })).toMatch(/^1 more section in this pathway/);
  });
});

describe('every locale is complete', () => {
  const keys = Object.keys(en).filter(k => !k.startsWith('___'));
  for (const lang of langs) {
    it(`${lang}: has every English key`, () => {
      const d = load(lang);
      expect(keys.filter(k => typeof d[k] !== 'string' || !d[k].trim())).toEqual([]);
    });
  }

  for (const lang of langs) {
    it(`${lang}: has no keys that English lacks (they would never be used)`, () => {
      const extra = Object.keys(load(lang)).filter(k => !k.startsWith('___') && !(k in en));
      expect(extra).toEqual([]);
    });
  }

  it('the Reset-all confirmation word is "reset" everywhere, so what the body asks for is what is checked', () => {
    for (const lang of ['en', ...langs]) {
      const d = load(lang);
      expect(d.settings_resetall_confirm2_keyword, lang).toBe('reset');
      expect(d.settings_resetall_confirm2_body, lang).toContain('<strong>reset</strong>');
    }
  });
});
