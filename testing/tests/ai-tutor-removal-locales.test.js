/**
 * Guard for the removal of the AI tutor from the locale files: none of the
 * removed UI strings may remain in ANY of the 18 ui_*.json files, every file
 * must still parse, and the local-validate strings must survive.
 *
 * Paths are relative to testing/tests/ — the app is in ../../app/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, '../../app');

const REMOVED_KEYS = [
  'renderchapter_ask_ai_tutor',
  'renderchapter_answer_tools_aichat_label',
  'renderchapter_answer_tools_aichat_desc',
  'renderpages_settings_answerchecking_heading',
  'renderpages_settings_answerbtn_label',
  'renderpages_settings_answerbtn_desc',
];

describe('AI tutor removal: locale files', () => {
  const locales = readdirSync(join(APP, 'js/locales'))
    .map(d => join(APP, 'js/locales', d, `ui_${d}.json`)).filter(existsSync);

  it('finds all 18 locale files', () => {
    expect(locales.length).toBe(18);
  });

  it.each(locales.map(f => [f.split('/').slice(-2, -1)[0], f]))('ui_%s.json has no tutor strings and still parses', (_lang, file) => {
    const raw = readFileSync(file, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(/validation_tutor_/.test(raw)).toBe(false);
    expect(/AI tutor panel UI|AI tutor error toasts/.test(raw)).toBe(false);
    for (const key of REMOVED_KEYS) expect(raw.includes(key), key).toBe(false);
  });

  it('keeps the local-validate strings in English', () => {
    const en = JSON.parse(readFileSync(join(APP, 'js/locales/en/ui_en.json'), 'utf8'));
    for (const key of ['validation_lv_too_short', 'renderchapter_check_my_answer', 'renderchapter_answer_tools_localvalidate_label', 'renderpages_settings_answercheck_heading']) {
      expect(en[key], key).toBeTruthy();
    }
  });
});
