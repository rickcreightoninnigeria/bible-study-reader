/**
 * Characterisation tests for the local-validate half of validation.js.
 *
 * The golden file (fixtures/local-validate-golden.json) was captured from the
 * code BEFORE the AI tutor was removed, so a pass here proves local validate
 * behaves identically afterwards. Regenerate it only on purpose:
 *   UPDATE_GOLDEN=1 npx vitest run tests/validation.test.js
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { makeValidationSandbox, makeCard } from './helpers/validation-sandbox.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, 'fixtures/local-validate-golden.json');

const PASSAGE = '<sup>1</sup>The word of the Lord came to Jonah son of Amittai: Go to the great city of Nineveh and preach against it, because its wickedness has come up before me.';
const SAMPLE  = 'God asks Jonah to go to Nineveh and preach against the city because of its wickedness.';
const QUESTION = 'What exactly does God ask Jonah to do, and why does he ask it?';

// Each case: [name, answer, options]. Options mirror _localValidate's arguments.
const CASES = [
  ['filler: idk',            'idk', {}],
  ['filler: not sure',       'Not sure.', { hint: 'Try rereading verse 2.' }],
  ['too short (default 6)',  'He ran away', {}],
  ['too short with hint',    'Go preach', { hint: 'Look at verse 2.', sample: SAMPLE }],
  ['threshold 0 disables short check', 'Nineveh', { threshold: '0' }],
  ['threshold 3 (override)', 'Go to Nineveh', { threshold: '3' }],
  ['threshold 3 too short',  'Go away', { threshold: '3' }],
  ['repeats question',       'What exactly does God ask Jonah to do and why does he ask it', {}],
  ['repeats passage',        'The word of the Lord came to Jonah son of Amittai: Go to the great city of Nineveh and preach against it', { ref: 'Jonah 1:1-2' }],
  ['repeats passage, skipBibleVerseCheck', 'The word of the Lord came to Jonah son of Amittai: Go to the great city of Nineveh and preach against it', { ref: 'Jonah 1:1-2', skip: true }],
  ['off topic vs sample',     'I really enjoyed the weather and the sandwiches at our picnic last weekend', { sample: SAMPLE }],
  ['pass thematic',          'He tells Jonah to travel to Nineveh and speak out about how wicked the people there have become', { sample: SAMPLE }],
  ['pass, no sample',        'I think God wants Jonah to warn the people of the big city about their behaviour', {}],
  ['pass, no sample, hint',  'I think God wants Jonah to warn the people of the big city about their behaviour', { hint: 'Think about why.' }],
  ['answer with transcript appended',
    'He tells Jonah to travel to Nineveh and speak out about how wicked the people there have become\n\n--- AI Tutor ---\nYou: is that right?\nAI Tutor: Good start.', { sample: SAMPLE }],
  ['multi-translation passage union', 'Go to the great city of Nineveh and preach against it because wickedness', { ref: 'Jonah 1:1-2' }],
];

function runCase(sb, [name, answer, o]) {
  sb.verseData = o.ref ? { [o.ref]: { translations: [{ label: 'NIV', text: PASSAGE }, { label: 'NET', text: PASSAGE + ' Arise' }] } } : {};
  const card = makeCard({ ref: o.ref || null });
  return [name, sb._localValidate(answer, QUESTION, card, o.sample || null, o.hint || null, o.threshold ?? null, !!o.skip)];
}

describe('local validate (golden)', () => {
  const sb = makeValidationSandbox();
  const actual = Object.fromEntries(CASES.map(c => runCase(sb, c)));

  if (process.env.UPDATE_GOLDEN) {
    writeFileSync(GOLDEN, JSON.stringify(actual, null, 2) + '\n');
  }
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));

  it.each(CASES.map(c => c[0]))('%s', name => {
    expect(actual[name]).toBe(golden[name]);
  });

  it('covers every case in the golden file', () => {
    expect(Object.keys(golden).sort()).toEqual(Object.keys(actual).sort());
  });

  it('exercises more than one distinct outcome', () => {
    expect(new Set(Object.values(actual)).size).toBeGreaterThan(5);
  });
});

describe('local validate helpers', () => {
  const sb = makeValidationSandbox();

  it('_stripHtml strips tags', () => {
    expect(sb._stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('_getQuestionText reads .question-text, with a fallback', () => {
    const card = { querySelector: sel => (sel === '.question-text' ? { innerText: '  Why?  ' } : null) };
    expect(sb._getQuestionText(card)).toBe('Why?');
    expect(sb._getQuestionText({ querySelector: () => null })).toBe('(question not found)');
  });

  it('localValidateEligible: standard or passage-linked only', () => {
    const c = (subtype, linked = '') => ({ dataset: { questionSubtype: subtype, linkedPassage: linked } });
    expect(sb.localValidateEligible(c('standard'))).toBe(true);
    expect(sb.localValidateEligible(c(''))).toBe(true);
    expect(sb.localValidateEligible(c('reflection'))).toBe(false);
    expect(sb.localValidateEligible(c('reflection', 'John 1:1'))).toBe(true);
    expect(sb.localValidateEligible(null)).toBe(false);
  });
});
