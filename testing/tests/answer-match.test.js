/**
 * Unit tests for app/js/answer-match.js — the pure, DOM-free matching logic behind
 * "local validate". The file is loaded into a bare vm sandbox with no DOM and no
 * stubs, which is itself part of what is being tested.
 *
 * Non-English fixtures are written by a non-native speaker and are marked
 * "needs native-speaker review": they check that the mechanics work (marks,
 * scripts, prefixes), not that the example sentences are ideal.
 *
 * Paths are relative to testing/tests/ — source files are in ../../app/js/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../app/js/answer-match.js'), 'utf8');

function load({ noSegmenter = false, noUnicodeProps = false } = {}) {
  const sandbox = { console };
  vm.createContext(sandbox);
  if (noUnicodeProps) {
    // Simulate an old WebView: constructing a RegExp with \p{…} throws.
    vm.runInContext(`(() => {
      const Native = RegExp;
      globalThis.RegExp = class extends Native {
        constructor(src, flags) {
          if (String(src).includes('\\\\p{') || String(src).includes('\\\\P{')) throw new SyntaxError('Invalid property name');
          super(src, flags);
        }
      };
    })()`, sandbox);
  }
  if (noSegmenter) vm.runInContext('delete Intl.Segmenter', sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'answer-match.js' });
  sandbox.__eval = code => vm.runInContext(code, sandbox);
  return sandbox;
}

const am = load();
const amNoSeg = load({ noSegmenter: true });
const amOldWebView = load({ noUnicodeProps: true, noSegmenter: true });

describe('normaliseText', () => {
  it('lower-cases, collapses whitespace and drops emoji and punctuation', () => {
    expect(am.normaliseText('  Hello,   WORLD!!  🙂 ')).toBe('hello world');
  });

  it('deletes apostrophes (straight, curly, modifier) but turns other punctuation into spaces', () => {
    expect(am.normaliseText("don't")).toBe('dont');
    expect(am.normaliseText('don’t')).toBe('dont');
    expect(am.normaliseText('donʼt')).toBe('dont');
    expect(am.normaliseText('God-given grace/faith')).toBe('god given grace faith');
  });

  it('treats NFC and NFD input as equal', () => {
    expect(am.normaliseText('café')).toBe(am.normaliseText('café'));
    expect(am.normaliseText('ọ̀')).toBe(am.normaliseText('ọ̀'));
  });

  it('keeps Hausa hooked letters ɓ ɗ ƙ', () => {
    for (const ch of ['ɓ', 'ɗ', 'ƙ']) expect(am.normaliseText(`a${ch}a`)).toBe(`a${ch}a`);
    expect(am.normaliseText('ƙauna')).not.toBe(am.normaliseText('kauna'));   // ƙ is a different letter from k
  });

  it('folds Yorùbá tone marks and dots below so "Jésù" matches "Jesu"', () => {
    expect(am.normaliseText('Jésù')).toBe('jesu');
    expect(am.normaliseText('Jesu')).toBe('jesu');
    expect(am.normaliseText('ìgbàgbọ́')).toBe(am.normaliseText('igbagbo'));
  });

  it('folds optional Arabic and Hebrew marks but keeps the letters', () => {
    expect(am.normaliseText('الإِيمَانُ')).toBe(am.normaliseText('الايمان'));
    expect(am.normaliseText('اللّٰه')).not.toBe('');
    expect(am.normaliseText('שָׁלוֹם')).toBe(am.normaliseText('שלום'));
  });

  it('keeps combining marks in other scripts (Devanagari matras, Burmese)', () => {
    const withMatra = am.normaliseText('अनुग्रह');
    expect(withMatra).toBe('अनुग्रह');
    expect(withMatra).not.toBe(am.normaliseText('अनग्रह'));   // a missing matra is a different word
    expect(am.normaliseText('ယေရှု')).toBe('ယေရှု');
  });

  it('never throws on non-strings', () => {
    for (const bad of [undefined, null, 5, {}, [], () => 1, Symbol('x')]) {
      expect(am.normaliseText(bad)).toBe('');
    }
  });
});

describe('foldMarks', () => {
  it('folds Latin, Greek and Cyrillic only', () => {
    expect(am.foldMarks('é')).toBe('e');
    expect(am.foldMarks('ά')).toBe('α');
    expect(am.foldMarks('ё')).toBe('е');
    expect(am.foldMarks('हिन्दी')).toBe('हिन्दी');
  });
});

describe('tokenise', () => {
  it('splits spaced text on spaces', () => {
    expect(am.tokenise('faith and works', 'en')).toEqual(['faith', 'and', 'works']);
  });

  it('segments Chinese into words when Intl.Segmenter is available', () => {
    const tokens = am.tokenise('上帝要约拿去尼尼微', 'zh');
    expect(tokens.length).toBeGreaterThan(1);
    expect(tokens.join('')).toBe('上帝要约拿去尼尼微');
  });

  it('falls back to overlapping character pairs without Intl.Segmenter', () => {
    expect(amNoSeg.__eval('typeof Intl.Segmenter')).toBe('undefined');
    expect(amNoSeg.tokenise('上帝要约', 'zh')).toEqual(['上帝', '帝要', '要约']);
    expect(amNoSeg.tokenise('信', 'zh')).toEqual(['信']);
  });

  it('keeps Burmese syllable marks attached in the fallback', () => {
    const tokens = amNoSeg.tokenise('ယေရှုက', 'my');
    expect(tokens.length).toBeGreaterThan(0);
    for (const tok of tokens) expect(/^[က-႟]+$/.test(tok)).toBe(true);
    expect(tokens.every(tok => !/^[ါ-ှ]/.test(tok))).toBe(true);   // never starts with a bare mark
  });

  it('handles mixed Latin and Chinese', () => {
    expect(amNoSeg.tokenise('god 上帝要', 'zh')).toEqual(['god', '上帝', '帝要']);
  });
});

describe('countWords', () => {
  it('counts spaced text exactly as split(/\\s+/) did', () => {
    expect(am.countWords('one two  three\nfour', 'en')).toBe(4);
    expect(am.countWords('', 'en')).toBe(0);
    expect(am.countWords('--', 'en')).toBe(1);      // punctuation-only pieces still counted, as before
    expect(am.countWords(null, 'en')).toBe(0);
  });

  it('counts a Chinese answer as more than one word', () => {
    expect(am.countWords('上帝要约拿去尼尼微城宣告审判', 'zh')).toBeGreaterThan(3);
    expect(amNoSeg.countWords('上帝要约拿去尼尼微城宣告审判', 'zh')).toBe(7);   // 14 characters, about two to a word
  });

  it('counts Burmese and Thai text', () => {
    expect(am.countWords('ယေရှုသည်ကျွန်ုပ်တို့ကိုချစ်သည်', 'my')).toBeGreaterThan(1);
    expect(amNoSeg.countWords('ยอนาห์ไปนีนะเวห์', 'th')).toBeGreaterThan(1);
  });
});

describe('stopwords and content tokens', () => {
  it('has an English list and none for other languages', () => {
    expect(Object.keys(am.__eval('STOPWORDS_BY_LANG'))).toEqual(['en']);
    expect(am.contentTokens('the faith of God', 'en')).toEqual(['faith']);
  });

  it('uses a length filter, not a list, for other Latin-script languages', () => {
    expect(am.contentTokens('Allah ya aiki Yunana', 'ha')).toEqual(['allah', 'aiki', 'yunana']);
  });

  it('keeps single characters in scripts where one character carries meaning', () => {
    expect(amNoSeg.contentTokens('信', 'zh')).toEqual(['信']);
  });

  it('stem: five letters for Latin words, whole token otherwise', () => {
    expect(am.stem('forgiveness')).toBe('forgi');
    expect(am.stem('forgiven')).toBe('forgi');
    expect(am.stem('42')).toBe('42');
    expect(am.stem('上帝')).toBe('上帝');
  });

  it('uses the stricter 0.85 repeats-the-question threshold when there is no stopword list', () => {
    // 3 of 4 answer words come from the question: 0.75.
    const q = 'alpha bravo charlie delta echo foxtrot golf hotel';
    const a = 'alpha bravo charlie zulu';
    expect(am.evaluateAnswer({ answer: a, questionText: q, lang: 'en', shortAnswerThreshold: 0 }).code).toBe('repeatsQuestion');
    expect(am.evaluateAnswer({ answer: a, questionText: q, lang: 'ha', shortAnswerThreshold: 0 }).code).toBe('passNoSample');
    // 7 of 8 words: 0.875 > 0.85, so repeated in either.
    const b = 'alpha bravo charlie delta echo foxtrot golf zulu';
    expect(am.evaluateAnswer({ answer: b, questionText: q, lang: 'ha', shortAnswerThreshold: 0 }).code).toBe('repeatsQuestion');
  });
});

describe('parseKeyTerms: grammar', () => {
  const alt = (raw, i = 0) => am.parseKeyTerms(raw)[i];

  it('splits alternatives on | and flags a trailing $', () => {
    const [e] = am.parseKeyTerms(['justif|declared righteous|sin$']);
    expect(e.alternatives.map(a => [a.text, a.exact])).toEqual([['justif', false], ['declared righteous', false], ['sin', true]]);
  });

  it('normalises alternatives like answers (case, marks, punctuation)', () => {
    expect(alt(['Jésù|GRACE!']).alternatives.map(a => a.text)).toEqual(['jesu', 'grace']);
  });

  it('clips to 12 entries, 10 alternatives and 60 characters', () => {
    const many = Array.from({ length: 20 }, (_, i) => `term${i}`);
    expect(am.parseKeyTerms(many)).toHaveLength(12);
    const alts = Array.from({ length: 15 }, (_, i) => `a${i}`).join('|');
    expect(alt([alts]).alternatives).toHaveLength(10);
    expect(alt(['x'.repeat(200)]).alternatives[0].text).toHaveLength(60);
  });

  it('ignores anything that is not a non-empty string, and never throws', () => {
    expect(am.parseKeyTerms(undefined)).toEqual([]);
    expect(am.parseKeyTerms('faith')).toEqual([]);
    expect(am.parseKeyTerms({ 0: 'faith', length: 1 })).toEqual([]);
    expect(am.parseKeyTerms([null, 5, {}, [], '', '   ', '|||', '$', 'ok'])).toHaveLength(1);
  });
});

describe('matchKeyTerms', () => {
  const run = (answer, terms, lang = 'en') => am.matchKeyTerms(answer, am.parseKeyTerms(terms), lang);

  it('matches a single word as a word-start prefix', () => {
    expect(run('We are justified by faith', ['justif']).matched).toBe(1);
    expect(run('Justification is a gift', ['justif']).matched).toBe(1);
    expect(run('unjustified', ['justif']).matched).toBe(0);            // not at a word start
  });

  it('matches a whole word with a trailing $', () => {
    expect(run('Sin separates us', ['sin$']).matched).toBe(1);
    expect(run('since then', ['sin$']).matched).toBe(0);
    expect(run('since then', ['sin']).matched).toBe(1);                // without $, a prefix
  });

  it('matches a phrase at a word start', () => {
    expect(run('He was declared righteous.', ['declared righteous']).matched).toBe(1);
    expect(run('declared righteousness', ['declared righteous']).matched).toBe(1);
    expect(run('undeclared righteous', ['declared righteous']).matched).toBe(0);
    expect(run('declared righteousness', ['declared righteous$']).matched).toBe(0);
  });

  it('counts an entry once if any alternative matches', () => {
    expect(run('faith', ['faith|trust|belief', 'grace']).matched).toBe(1);
    expect(run('faith trust belief', ['faith|trust|belief', 'grace'])).toEqual({ matched: 1, total: 2 });
  });

  it('"*" matches anywhere inside a word (for prefixing languages)', () => {
    expect(run('نخلص بالإيمان', ['*ايمان'], 'ar').matched).toBe(1);
    expect(run('نخلص بالإيمان', ['ايمان'], 'ar').matched).toBe(0);
  });

  it('matches by substring in scripts without spaces', () => {
    expect(run('我们因信称义，不是靠行为', ['称义', '信']).matched).toBe(2);
    expect(amNoSeg.matchKeyTerms('我们因信称义', amNoSeg.parseKeyTerms(['称义']), 'zh').matched).toBe(1);
  });

  it('is not fooled by regular-expression characters, and stays fast', () => {
    const nasty = ['.*+?^${}()|[]\\', '(a+)+$', '[a-', 'a{1000000}', '\\', '(?:', '*', '$$$'];
    const long = 'a'.repeat(5000);
    const started = Date.now();
    expect(() => run(long, nasty)).not.toThrow();
    expect(() => run('(a+)+$ and .*', ['(a+)+$', '.*'])).not.toThrow();
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('returns zero for no terms', () => {
    expect(run('anything', [])).toEqual({ matched: 0, total: 0 });
  });
});

describe('tierFor', () => {
  // [total, matched] → tier
  const table = {
    1: ['none', 'strong'],
    2: ['none', 'partial', 'strong'],
    3: ['none', 'partial', 'strong', 'strong'],
    4: ['none', 'partial', 'strong', 'strong', 'strong'],
    5: ['none', 'partial', 'partial', 'strong', 'strong', 'strong'],
    6: ['none', 'partial', 'partial', 'strong', 'strong', 'strong', 'strong'],
  };
  for (const [total, tiers] of Object.entries(table)) {
    tiers.forEach((expected, matched) => {
      it(`${matched} of ${total} → ${expected}`, () => {
        expect(am.tierFor({ matched, total: Number(total) })).toBe(expected);
      });
    });
  }

  it('is none for no terms or bad input', () => {
    expect(am.tierFor({ matched: 0, total: 0 })).toBe('none');
    expect(am.tierFor(null)).toBe('none');
    expect(am.tierFor({ matched: NaN, total: 3 })).toBe('none');
  });
});

describe('evaluateAnswer: the outcome table', () => {
  const base = { questionText: 'What does Paul say about how a person is made right with God?', lang: 'en' };
  const SAMPLE = 'Paul says a person is declared righteous by faith in Christ and not by anything they do.';
  const ANSWER_FULL = 'Paul teaches that we are declared righteous through faith, not by our works.';
  const ANSWER_PART = 'Paul teaches that we are made right through our own works.';
  const ANSWER_NONE = 'I enjoyed the weather and the sandwiches at our picnic last weekend.';
  const KEY = ['righteous|justif', 'faith|trust'];

  it('keyTerms present, none matched → offTopic', () => {
    expect(am.evaluateAnswer({ ...base, answer: ANSWER_NONE, keyTerms: KEY })).toMatchObject({ code: 'offTopic', matched: 0, total: 2 });
  });

  it('keyTerms present, partial → partial', () => {
    expect(am.evaluateAnswer({ ...base, answer: 'Paul says we are justified by what we do and how we live.', keyTerms: KEY })).toMatchObject({ code: 'partial', matched: 1, total: 2 });
  });

  it('keyTerms present, strong → strong', () => {
    expect(am.evaluateAnswer({ ...base, answer: ANSWER_FULL, keyTerms: KEY })).toMatchObject({ code: 'strong', matched: 2, total: 2 });
  });

  it('no keyTerms, sampleAnswer, some overlap → pass (never strong)', () => {
    expect(am.evaluateAnswer({ ...base, answer: ANSWER_FULL, sampleAnswer: SAMPLE }).code).toBe('pass');
  });

  it('no keyTerms, sampleAnswer, no overlap → offTopic', () => {
    expect(am.evaluateAnswer({ ...base, answer: ANSWER_NONE, sampleAnswer: SAMPLE }).code).toBe('offTopic');
  });

  it('no keyTerms, no sample → passNoSample', () => {
    expect(am.evaluateAnswer({ ...base, answer: ANSWER_PART }).code).toBe('passNoSample');
  });

  it('can never say "strong" or "partial" without keyTerms, whatever the answer', () => {
    const answers = [ANSWER_FULL, ANSWER_PART, ANSWER_NONE, SAMPLE, SAMPLE + ' ' + SAMPLE, 'faith', 'righteous faith', 'x '.repeat(50)];
    for (const answer of answers) {
      for (const keyTerms of [undefined, null, [], [''], 'faith', {}, [5], [[]]]) {
        const code = am.evaluateAnswer({ ...base, answer, sampleAnswer: SAMPLE, keyTerms }).code;
        expect(['strong', 'partial']).not.toContain(code);
      }
    }
  });

  it('the earlier checks still come first', () => {
    expect(am.evaluateAnswer({ ...base, answer: 'idk', keyTerms: KEY }).code).toBe('stuck');
    expect(am.evaluateAnswer({ ...base, answer: 'faith', keyTerms: KEY }).code).toBe('tooShort');
    expect(am.evaluateAnswer({ ...base, answer: base.questionText, keyTerms: KEY }).code).toBe('repeatsQuestion');
    expect(am.evaluateAnswer({
      ...base, answer: 'The word of the Lord came to Jonah and he was told to go to Nineveh the great city', keyTerms: ['nineveh'],
      passageTexts: ['The word of the Lord came to Jonah and he was told to go to Nineveh the great city'],
    }).code).toBe('repeatsPassage');
  });

  it('an author threshold of 0 turns the short-answer check off', () => {
    expect(am.evaluateAnswer({ ...base, answer: 'faith', keyTerms: ['faith'], shortAnswerThreshold: 0 }).code).toBe('strong');
    expect(am.evaluateAnswer({ ...base, answer: 'faith', keyTerms: ['faith'], shortAnswerThreshold: '0' }).code).toBe('strong');
    expect(am.evaluateAnswer({ ...base, answer: 'faith', keyTerms: ['faith'], shortAnswerThreshold: 3 }).code).toBe('tooShort');
  });

  it('skipBibleVerseCheck skips the passage check', () => {
    const passage = 'The word of the Lord came to Jonah and he was told to go to Nineveh the great city';
    expect(am.evaluateAnswer({ ...base, answer: passage, passageTexts: [passage] }).code).toBe('repeatsPassage');
    expect(am.evaluateAnswer({ ...base, answer: passage, passageTexts: [passage], skipBibleVerseCheck: true }).code).toBe('passNoSample');
  });

  it('truncates a very long answer and still finishes quickly', () => {
    const started = Date.now();
    const result = am.evaluateAnswer({ ...base, answer: 'faith '.repeat(500000), keyTerms: ['faith'] });
    expect(result.code).toBe('strong');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

// ── Languages. NEEDS NATIVE-SPEAKER REVIEW: these check the mechanics (marks,
// scripts, prefixes), not whether the example sentences are ideal. ───────────
describe('evaluateAnswer in other languages (needs native-speaker review)', () => {
  const run = (lang, answer, keyTerms, extra = {}) =>
    am.evaluateAnswer({ lang, answer, questionText: '', keyTerms, shortAnswerThreshold: 0, ...extra });

  it('English', () => {
    expect(run('en', 'We are saved by grace through faith.', ['grace', 'faith']).code).toBe('strong');
  });

  it('Yorùbá, with and without tone marks', () => {
    const terms = ['ìgbàgbọ́|igbagbo', 'oore-ọ̀fẹ́|oore ofe'];
    expect(run('yo', 'Nípasẹ̀ ìgbàgbọ́ àti oore-ọ̀fẹ́ ni a fi gbà wá là', terms).code).toBe('strong');
    expect(run('yo', 'Nipase igbagbo ati oore ofe ni a fi gba wa la', terms).code).toBe('strong');
    expect(run('yo', 'Nipase igbagbo nikan ni a fi gba wa la', terms).code).toBe('partial');
  });

  it('Hausa, keeping the hooked letters distinct', () => {
    const terms = ['bangaskiya|imani', 'alheri'];
    expect(run('ha', 'Ta hanyar bangaskiya da alherin Allah ake ceton mu', terms).code).toBe('strong');
    expect(run('ha', 'Allah yana da ƙauna', ['ƙauna']).code).toBe('strong');
    expect(run('ha', 'Allah yana da kauna', ['ƙauna']).code).toBe('offTopic');
  });

  it('Arabic, ignoring vowel marks and attached prefixes with "*"', () => {
    expect(run('ar', 'نخلص بالإِيمَانِ وبنعمة الله', ['*ايمان', '*نعمة']).code).toBe('strong');
    expect(run('ar', 'نخلص بالإيمان', ['*ايمان', '*نعمة']).code).toBe('partial');
  });

  it('Chinese', () => {
    expect(run('zh-CN', '我们因信称义，不是靠行为', ['称义|稱義', '信']).code).toBe('strong');
    expect(run('zh', '我们因信称义', ['称义', '恩典', '行为']).code).toBe('partial');
  });

  it('Hindi, where a missing matra is a different word', () => {
    const terms = ['विश्वास|भरोसा', 'अनुग्रह'];
    expect(run('hi', 'हम विश्वास और अनुग्रह से बचाए गए हैं', terms).code).toBe('strong');
    expect(run('hi', 'हम विश्वास और अनग्रह से बचाए गए हैं', terms).code).toBe('partial');
  });

  it('Burmese', () => {
    expect(run('my', 'ယုံကြည်ခြင်းအားဖြင့် ကယ်တင်ခြင်းခံရသည်', ['ယုံကြည်', 'ကယ်တင်']).code).toBe('strong');
  });
});

describe('older WebViews (no \\p{…} property escapes, no Intl.Segmenter)', () => {
  it('still loads and handles English', () => {
    expect(amOldWebView.normaliseText("God's grace — and faith!")).toBe('gods grace and faith');
    expect(amOldWebView.evaluateAnswer({ answer: 'We are saved by grace through faith alone', keyTerms: ['grace', 'faith'], lang: 'en' }).code).toBe('strong');
  });

  it('still folds Yorùbá marks and keeps Hausa letters', () => {
    expect(amOldWebView.normaliseText('Jésù')).toBe('jesu');
    expect(amOldWebView.normaliseText('ƙauna ɗa')).toBe('ƙauna ɗa');
  });

  it('still matches Chinese by substring', () => {
    expect(amOldWebView.matchKeyTerms('我们因信称义', amOldWebView.parseKeyTerms(['称义']), 'zh').matched).toBe(1);
  });
});

describe('hostile input', () => {
  const bomb = { toString() { throw new Error('boom'); }, valueOf() { throw new Error('boom'); } };

  it('evaluateAnswer never throws, whatever it is given', () => {
    const inputs = [
      undefined, null, 5, 'text', [], () => {},
      { answer: bomb }, { answer: 'x', questionText: bomb }, { answer: 'faith', keyTerms: bomb },
      { answer: 'faith', keyTerms: [bomb, 'faith'] }, { answer: 'x', passageTexts: [bomb, 5, null] },
      { answer: 'faith', keyTerms: JSON.parse('{"__proto__":{"polluted":1}}') },
      { answer: 'x'.repeat(2e6), keyTerms: ['x'.repeat(2e6)], sampleAnswer: 'y'.repeat(2e6) },
      { answer: 'faith', keyTerms: Array.from({ length: 1e6 }, () => 'a') },
      { answer: 'faith', shortAnswerThreshold: bomb }, { answer: 'faith', lang: bomb },
    ];
    const started = Date.now();
    for (const input of inputs) expect(() => am.evaluateAnswer(input)).not.toThrow();
    expect(Date.now() - started).toBeLessThan(3000);
    expect(({}).polluted).toBeUndefined();
  });

  it('parseKeyTerms and matchKeyTerms never throw', () => {
    for (const bad of [bomb, [bomb], new Proxy([], { get() { throw new Error('boom'); } })]) {
      expect(() => am.parseKeyTerms(bad)).not.toThrow();
    }
    expect(() => am.matchKeyTerms(bomb, [{ alternatives: bomb }, null, 5], 'en')).not.toThrow();
  });
});
