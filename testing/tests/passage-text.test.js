/**
 * The plain text of a linked passage, as the "repeats the passage" check sees it
 * (validation.js: _lvPlainPassage, _lvPassageTexts).
 *
 * Poetry lines separated by <br>, [[sc:Lord]] markers and verse numbers all
 * used to leave the passage's word list wrong: tags were removed with no space
 * ("livestock<br>and" became "livestockand"), [[sc:Lord]] stayed as literal
 * text, and a "<sup>14</sup>" verse number could survive as a stray word.
 *
 * Paths are relative to testing/tests/ — helpers are in ./helpers/
 */

import { describe, it, expect } from 'vitest';
import vm from 'vm';
import { makeValidationSandbox, makeCard } from './helpers/validation-sandbox.js';

const REF = 'Genesis 3:14-15';
const sandboxWith = text => {
  const sb = makeValidationSandbox();
  sb.verseData = { [REF]: { translations: [{ label: 'T', text }] } };
  return sb;
};
const passageOf = text => sandboxWith(text)._lvPassageTexts(makeCard({ ref: REF }))[0];

// What the app does for one answer, with the passage check on.
const check = (text, answer, extra = {}) => {
  const sb = sandboxWith(text);
  return sb.evaluateAnswer({ answer, passageTexts: sb._lvPassageTexts(makeCard({ ref: REF })), lang: 'en', ...extra });
};

const POETRY =
  '<p><sup>14</sup>So the [[sc:Lord]] God said to the snake, ‘Because you have done this,</p>' +
  '<p>‘Cursed are you above all livestock<br>and all wild animals!<br>You will crawl on your belly<br>' +
  'and you will eat dust<br>all the days of your life.</p>';

describe('poetry lines separated by <br>', () => {
  it('keeps the words on either side of a line break apart', () => {
    const t = passageOf(POETRY);
    expect(t).toContain('livestock and all wild animals!');
    expect(t).toContain('belly and you will eat dust all the days');
    expect(t).not.toMatch(/livestockand|bellyand|dustall/);
  });

  it('treats a verbatim copy of the lines as a repeat (every word is found)', () => {
    const copy = 'Cursed are you above all livestock and all wild animals! You will crawl on your belly and you will eat dust all the days of your life.';
    const r = check(POETRY, copy);
    expect(r.code).toBe('repeatsPassage');
  });

  it('measures the overlap against the real words: the glued-words figure was lower', () => {
    // Words "livestock", "belly", "dust" are in the copy; they must be found in the passage.
    const sb = sandboxWith(POETRY);
    const words = sb.tokenise(sb.normaliseText(sb._lvPassageTexts(makeCard({ ref: REF }))[0]), 'en');
    for (const w of ['livestock', 'belly', 'dust', 'crawl']) expect(words).toContain(w);
  });

  it('still lets a genuine paraphrase through', () => {
    const r = check(POETRY, 'The serpent is punished by being brought low, and has to move along the ground, which shows judgment on his deception.', { keyTerms: ['snake|serpent'] });
    expect(r.code).not.toBe('repeatsPassage');
  });

  it('puts a space for every kind of tag, not only <br>', () => {
    expect(passageOf('<p>first line of the psalm</p><p>second line of the psalm</p>')).toBe('first line of the psalm second line of the psalm');
    expect(passageOf('one<br/>two<br />three four five six seven eight')).toBe('one two three four five six seven eight');
    expect(passageOf('<b>Holy</b><i>ground</i> is where you stand, said the voice')).toBe('Holy ground is where you stand, said the voice');
  });

  it('collapses runs of spaces and line breaks', () => {
    expect(passageOf('the  first   line<br> <br>\n\nand the   second  line of it')).toBe('the first line and the second line of it');
  });
});

describe('[[sc:Lord]] small-capitals markers', () => {
  it('becomes plain "Lord", so "[[sc:Lord]]’s" reads as "Lord’s"', () => {
    const t = passageOf('<p>The earth is the [[sc:Lord]]’s, and everything in it, the world, and all who live in it.</p>');
    expect(t).toBe('The earth is the Lord’s, and everything in it, the world, and all who live in it.');
    expect(t).not.toContain('[[');
  });

  it('lets an answer that quotes it be recognised as a repeat', () => {
    const passage = '<p><sup>1</sup>The earth is the [[sc:Lord]]’s, and everything in it, the world, and all who live in it;</p>';
    const r = check(passage, 'The earth is the Lord’s and everything in it, the world and all who live in it.');
    expect(r.code).toBe('repeatsPassage');
  });

  it('expands several markers, including inside a longer name', () => {
    expect(passageOf('[[sc:Lord]] God, the [[sc:Lord]] Almighty, is with you always, to the very end')).toBe('Lord God, the Lord Almighty, is with you always, to the very end');
  });
});

describe('verse numbers', () => {
  it('removes a number stuck to a word in plain text ("14So", "21For")', () => {
    const t = passageOf('14So the Lord God said to the snake, and 21For the Lord God made garments of skin');
    expect(t).toBe('So the Lord God said to the snake, and For the Lord God made garments of skin');
  });

  it('drops a verse number in <sup>, with or without a following space', () => {
    expect(passageOf('<sup>14</sup>So the Lord God said to the snake, <sup>15</sup> and I will put enmity')).toBe('So the Lord God said to the snake, and I will put enmity');
    expect(passageOf('<sup>2</sup>‘Wash away all my iniquity and cleanse me from my sin, <sup>3a</sup>for I know my transgressions')).toBe('‘Wash away all my iniquity and cleanse me from my sin, for I know my transgressions');
  });

  it('leaves a number that is part of the text, such as an age or a count', () => {
    expect(passageOf('Noah was 600 years old when the floodwaters came on the earth, and 40 days of rain')).toContain('600 years old');
  });

  it('does not let a verse number count as a word an answer can match', () => {
    const sb = sandboxWith('<sup>14</sup>So the Lord God said to the snake, <sup>15</sup>and I will put enmity between you and the woman');
    const words = sb.tokenise(sb.normaliseText(sb._lvPassageTexts(makeCard({ ref: REF }))[0]), 'en');
    expect(words).not.toContain('14');
    expect(words).not.toContain('15');
  });
});

describe('entities and stray characters', () => {
  it('decodes entities, and never turns text into markup', () => {
    expect(passageOf('Salt &amp; light, the world &lt;b&gt; is not markup here, said the teacher to them')).toBe('Salt & light, the world <b> is not markup here, said the teacher to them');
    expect(passageOf('a < b and the rest of this sentence is long enough to count as a passage')).toContain('a < b');
  });

  it('keeps the 20-character minimum for a passage to be used', () => {
    const sb = sandboxWith('<br>short<br>');
    expect(sb._lvPassageTexts(makeCard({ ref: REF }))).toEqual([]);
  });

  it('skips a translation with no text, and returns every translation otherwise', () => {
    const sb = makeValidationSandbox();
    sb.verseData = { [REF]: { translations: [{ text: 'In the beginning<br>God created the heavens' }, { text: '' }, { text: 'Long ago<br>God made the sky and the land' }] } };
    expect(sb._lvPassageTexts(makeCard({ ref: REF }))).toEqual(['In the beginning God created the heavens', 'Long ago God made the sky and the land']);
  });
});

describe('thresholds are unchanged', () => {
  it('still uses 0.70 with the English stopword list and 0.85 without one', () => {
    const sb = makeValidationSandbox();
    expect(vm.runInContext('AM_LIMITS.RATIO_WITH_STOPWORDS', sb)).toBe(0.7);
    expect(vm.runInContext('AM_LIMITS.RATIO_NO_STOPWORDS', sb)).toBe(0.85);
  });
});
