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
  // ── Added for Briefing 2 (captured from the code BEFORE the matching refactor) ──
  ['stuck: curly apostrophe',       'I don’t know', {}],                    // intended change: now matched as filler
  ['stuck: straight apostrophe',    "I don't know", {}],
  ['stuck: no idea',                'No idea at all.', {}],
  ['stuck: n/a with hint',          'n/a', { hint: 'Start with verse 1.' }],
  ['too short: five words',         'He told Jonah to go', {}],
  ['exactly six words passes length', 'He told Jonah to go east', {}],
  ['threshold 12 (override)',       'He told Jonah to go to Nineveh now please', { threshold: '12' }],
  ['threshold 12 long enough',      'He told Jonah to go to Nineveh now please and preach to them about sin', { threshold: '12' }],
  ['sample-derived minimum words',  'Go preach now', { sample: 'Go to Nineveh and preach there now' }],
  ['repeats question, with hint',   'What exactly does God ask Jonah to do, and why does he ask it?', { hint: 'Use your own words.' }],
  ['repeats question: hyphen',      'What does God-given authority mean for believers today', { q: 'What does God-given authority mean for believers today?' }],      // intended change: hyphen → space
  ['repeats question: slash',       'Does faith/works language describe how believers are saved', { q: 'Does faith/works language describe how believers are saved?' }],    // intended change: slash → space
  ['repeats question: short q (<=20 chars skip)', 'Why', { q: 'Why does he go?' }],
  ['repeats passage with verse numbers', '1 The word of the Lord came to Jonah son of Amittai Go to the great city of Nineveh', { ref: 'Jonah 1:1-2' }],
  ['passage: own words pass',       'God sent Jonah somewhere dangerous to confront an enemy city about injustice', { ref: 'Jonah 1:1-2' }],
  ['passage: apostrophes',          "Jonah's mission: Nineveh's wickedness had reached God", { ref: 'Jonah 1:1-2' }],
  ['sample: stem-only overlap',     'Forgiven people rejoice daily in thankfulness for what happened there', { sample: 'Believers receive forgiveness through the cross of Jesus Christ', q: 'How do believers receive pardon?' }], // intended change: 5-letter stems
  ['sample: no overlap',            'I enjoyed the weather and sandwiches at our picnic last weekend', { sample: 'Believers receive forgiveness through the cross of Jesus Christ', q: 'How do believers receive pardon?' }],
  ['sample: tiny sample (<=10 chars) ignored', 'Something completely different today for everyone here', { sample: 'Short one' }],
  ['sample: few content words',     'Something completely different today for everyone here', { sample: 'The cross of Christ it is' }],
  ['sample: hyphenated overlap',    'Believers become God-centred people over time through steady growth', { sample: 'God-centred living grows steadily', q: 'What does growth look like?' }],
  ['pass thematic with hint',       'He tells Jonah to travel to Nineveh and speak out about how wicked the people there have become', { sample: SAMPLE, hint: 'Think about why.' }],
  ['off topic with hint',           'I really enjoyed the weather and the sandwiches at our picnic last weekend', { sample: SAMPLE, hint: 'Look at verse 2.' }],
  ['upper case and punctuation',    'GOD ASKS JONAH TO GO TO NINEVEH!!! AND PREACH AGAINST ITS WICKEDNESS.', { sample: SAMPLE }],
  ['numbers and digits',            'Verse 1 and 2 say God told Jonah to go in 3 days', {}],
  ['non-Latin: Chinese (counts as one word today)', '上帝要约拿去尼尼微城宣告审判因为那里的人很邪恶', {}],           // intended change: word count
  ['non-Latin: Arabic',             'يطلب الله من يونان أن يذهب إلى نينوى ويعظ ضد شرها', {}],
  ['non-Latin: Hausa with hooked letters', 'Allah ya aiki Yunana ya je birnin Nineba ya yi wa mutanen gargaɗi game da mugunta', {}],
  ['answer is only punctuation',    '?!?!?!', {}],
  ['multi-line answer',             'He sends Jonah to Nineveh.\nHe wants the city warned.\nIt is full of wickedness.', { sample: SAMPLE }],
  ['multi-translation passage union', 'Go to the great city of Nineveh and preach against it because wickedness', { ref: 'Jonah 1:1-2' }],
];

function runCase(sb, [name, answer, o]) {
  sb.verseData = o.ref ? { [o.ref]: { translations: [{ label: 'NIV', text: PASSAGE }, { label: 'NET', text: PASSAGE + ' Arise' }] } } : {};
  const card = makeCard({ ref: o.ref || null });
  return [name, sb._localValidate(answer, o.q || QUESTION, card, o.sample || null, o.hint || null, o.threshold ?? null, !!o.skip)];
}

// Outputs that changed on purpose in Briefing 2. The golden file still holds the
// old value (so the baseline stays honest); these entries record the new one and why.
const INTENDED_CHANGES = {
  'stuck: curly apostrophe': {
    now: 'validation_lv_stuck_no_hint',
    why: 'a curly apostrophe is now treated like a straight one, so "I don’t know" is recognised as filler',
  },
  'sample: stem-only overlap': {
    now: 'validation_lv_pass_thematic',
    why: 'the sampleAnswer fallback compares five-letter stems, so "forgiven" meets "forgiveness"',
  },
  'non-Latin: Chinese (counts as one word today)': {
    now: 'validation_lv_pass_no_sample_no_hint',
    why: 'words in a script without spaces are now counted, so a normal Chinese answer is no longer "too short"',
  },
};

describe('local validate (golden)', () => {
  const sb = makeValidationSandbox();
  const actual = Object.fromEntries(CASES.map(c => runCase(sb, c)));

  if (process.env.UPDATE_GOLDEN) {
    writeFileSync(GOLDEN, JSON.stringify(actual, null, 2) + '\n');
  }
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));

  it.each(CASES.map(c => c[0]).filter(n => !INTENDED_CHANGES[n]))('%s', name => {
    expect(actual[name]).toBe(golden[name]);
  });

  it.each(Object.keys(INTENDED_CHANGES))('intended change: %s', name => {
    expect(actual[name], INTENDED_CHANGES[name].why).toBe(INTENDED_CHANGES[name].now);
    expect(actual[name]).not.toBe(golden[name]);   // the change really is a change
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
