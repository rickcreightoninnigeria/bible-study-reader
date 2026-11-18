// ── ANSWER MATCHING ───────────────────────────────────────────────────────────
// Pure, DOM-free text matching for "local validate" (validation.js). Nothing in
// this file touches the document, t(), or any study global, so it runs
// unchanged in the vitest vm sandboxes. validation.js owns the UI: it passes
// plain values in, and maps the result codes back to translated messages.
//
// Why a separate file:
//   • The old in-function normalise() kept only a-z0-9, so for Hausa, Yorùbá,
//     Arabic, Chinese and the other supported languages it deleted most of the
//     answer. Matching here is Unicode-aware instead.
//   • keyTerms / mainPoint (Briefing 2) need the same normalisation as the
//     existing checks, and are easier to test away from the DOM.
//
// Study content is untrusted: nothing here builds a RegExp from study text.
// keyTerms are matched with plain string operations, every input is type-checked,
// and nothing throws.
//
// Browser support (Android 9+): the \p{…} property escapes need Chrome 64+ and
// Intl.Segmenter needs Chrome 87+. Both are feature-detected. Without \p the
// punctuation clean-up uses explicit ranges; without Intl.Segmenter, scripts
// written without spaces fall back to character pairs. English behaves the
// same either way.
//
// Public functions (all globals, like the rest of the app):
//   normaliseText, foldMarks, tokenise, countWords, contentTokens, stem,
//   parseKeyTerms, matchKeyTerms, tierFor, evaluateAnswer
// Public constants: STOPWORDS_BY_LANG, AM_LIMITS

// ── Limits ────────────────────────────────────────────────────────────────────
const AM_LIMITS = {
  MAX_ANSWER_CHARS:    5000,   // validation runs on every blur in auto mode
  MAX_CONTEXT_CHARS:  20000,   // question / passage / sample text
  MAX_KEY_TERMS:         12,   // entries per question
  MAX_ALTERNATIVES:      10,   // alternatives per entry
  MAX_ALTERNATIVE_CHARS: 60,
  RATIO_WITH_STOPWORDS: 0.70,  // "repeats the question / passage" threshold (English)
  // Without a stopword list, function words inflate the overlap ratio, so the
  // threshold is higher. A judgement call: needs checking by people who read
  // those languages.
  RATIO_NO_STOPWORDS:   0.85,
  MIN_LETTERS_LATIN:       3,  // content-token length where there is no stopword list
  STEM_LENGTH:             5,
  MAX_NOT_TYPOS:          30,  // most words an author may list in notTypos for one question
  FUZZY_MIN_LETTERS:       5,  // shortest keyTerms word that forgives a spelling slip
  MIN_CHARS_FOR_QUESTION_CHECK: 20,
  // "Repeats the passage" (English only): between RATIO_WITH_STOPWORDS and this,
  // an answer repeats the passage only if runs of COPY_RUN_WORDS or more words
  // taken straight from it make up COPY_RUN_SHARE of the answer, or the answer
  // does not read like sentences (under MIN_STOPWORD_SHARE little words).
  RATIO_COPY_CERTAIN:   0.85,
  COPY_RUN_WORDS:          5,
  COPY_RUN_SHARE:        0.5,
  MIN_STOPWORD_SHARE:   0.15,
};

// ── Stopwords ─────────────────────────────────────────────────────────────────
// Per language so more can be added with no code change: add a Set under the
// primary language subtag. Only English has a list today.
const STOPWORDS_BY_LANG = {
  en: new Set([
    'the','a','an','and','or','but','in','on','of','to','is','it','he','his',
    'was','for','with','that','this','are','as','at','by','from','have','had',
    'not','be','has','were','they','we','you','i','my','our','their','him','her',
    'its','so','if','then','will','would','can','could','should','all','one',
    'who','what','which','when','how','do','did','been','more','no','up','out',
    // High-frequency biblical vocabulary that appears in almost every passage
    'god','jesus','lord','christ','said','went','came','upon','into','them',
    'him','us','me','thy','thee','thou','ye','unto','hath','doth','shall',
  ]),
};

// ── Feature detection ─────────────────────────────────────────────────────────
const _AM_HAS_UNICODE_PROPS = (() => {
  try { new RegExp('\\p{L}', 'u'); return true; } catch (e) { return false; }
})();

// Punctuation → space. Anything that is not a letter, number, combining mark or
// whitespace. The fallback lists the common ASCII, Latin-1 and general-
// punctuation ranges instead (no \p support).
const _AM_PUNCT_RE = _AM_HAS_UNICODE_PROPS
  ? new RegExp('[^\\p{L}\\p{N}\\p{M}\\s]+', 'gu')
  : /[\u0000-&(-/:-@[-`{-¿×÷ -⁯←-⯿　-〿︀-﹯＀-／：-＠［-｀｛-･]+/g;

const _AM_APOSTROPHES_RE = /['’ʼ]/g;                 // deleted, not replaced, so "don't" → "dont"
const _AM_ZERO_WIDTH_RE  = /[​-‍⁠﻿]/g;

// Scripts written without spaces between words. Marks that belong to these
// scripts sit inside the same ranges, so they stay attached to their letters.
const _AM_SPACELESS_CLASS = '\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u0E00-\\u0EFF\\u1000-\\u109F\\u1780-\\u17FF\\u0F00-\\u0FFF';
const _AM_SPACELESS_TEST = new RegExp('[' + _AM_SPACELESS_CLASS + ']');
const _AM_SPACELESS_RUNS = new RegExp('[' + _AM_SPACELESS_CLASS + ']+|[^' + _AM_SPACELESS_CLASS + ']+', 'g');
// A character plus any marks attached to it (Burmese syllables, Thai vowels, …).
const _AM_CLUSTER_RE = _AM_HAS_UNICODE_PROPS
  ? new RegExp('\\P{M}\\p{M}*', 'gu')
  : /[\s\S][̀-ͯัิ-ฺ็-๎ါ-ှၖ-ၙា-៓]*/g;

// Latin, Greek and Cyrillic (plus digits and combining marks): the scripts
// where diacritics are optional in everyday writing, so they are folded away.
const _AM_FOLDABLE_RE = /^[0-9A-Za-zÀ-ɏ̀-ͯͰ-ϿЀ-ԯḀ-῿]+$/;
const _AM_LATIN_START_RE = /^[0-9A-Za-zÀ-ɏḀ-ỿ]/;
const _AM_DIGITS_ONLY_RE = /^[0-9]+$/;

// Arabic-script and Hebrew marks that writers usually omit (harakat, tatweel,
// niqqud), and letter variants that are interchangeable in ordinary writing.
const _AM_OPTIONAL_MARKS_RE = /[ـً-ٰٟۖ-ۭ֑-ׇ]/g;

// ── Normalisation ─────────────────────────────────────────────────────────────

// Removes combining marks from a Latin, Greek or Cyrillic token, so "Jésù" and
// "Jesu" match (Yorùbá writers often leave tone marks out). Tokens in any other
// script are returned unchanged: there the marks are part of the word. Letters
// such as Hausa ɓ ɗ ƙ have no decomposition, so they survive.
function foldMarks(token) {
  if (typeof token !== 'string' || !_AM_FOLDABLE_RE.test(token)) return typeof token === 'string' ? token : '';
  try {
    return token.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
  } catch (e) {
    return token;
  }
}

function _foldArabicHebrew(s) {
  return s
    .replace(_AM_OPTIONAL_MARKS_RE, '')
    .replace(/[آأإٱ]/g, 'ا')   // alef variants → alef
    .replace(/ى/g, 'ي')                         // alef maksura → ya
    .replace(/ی/g, 'ي')                         // Persian/Urdu ya → Arabic ya
    .replace(/ک/g, 'ك')                         // Persian/Urdu kaf → Arabic kaf
    .replace(/ة/g, 'ه');                        // ta marbuta → ha
}

// NFC; lower-case; apostrophes deleted; other punctuation → space; marks kept
// (except optional ones in Latin/Greek/Cyrillic and Arabic/Hebrew); whitespace
// collapsed. Always returns a string.
function normaliseText(str) {
  if (typeof str !== 'string' || str === '') return '';
  let s = str;
  try { s = s.normalize('NFC'); } catch (e) { /* keep as is */ }
  s = s.toLowerCase()
    .replace(_AM_ZERO_WIDTH_RE, '');
  s = _foldArabicHebrew(s)
    .replace(_AM_APOSTROPHES_RE, '')
    .replace(_AM_PUNCT_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s === '') return '';
  return s.split(' ').map(foldMarks).join(' ');
}

// ── Tokenising ────────────────────────────────────────────────────────────────

const _am_segmenters = {};
function _segmenterFor(lang) {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;   // checked every call, so a test can remove it
  const key = lang || '';
  if (key in _am_segmenters) return _am_segmenters[key];
  let seg = null;
  try { seg = new Intl.Segmenter(lang || undefined, { granularity: 'word' }); }
  catch (e) {
    try { seg = new Intl.Segmenter(undefined, { granularity: 'word' }); } catch (e2) { seg = null; }
  }
  _am_segmenters[key] = seg;
  return seg;
}

function _hasSpaceless(str) { return _AM_SPACELESS_TEST.test(str); }

// Splits one run of spaceless-script characters into tokens.
function _segmentSpaceless(run, lang) {
  const seg = _segmenterFor(lang);
  if (seg) {
    const out = [];
    for (const part of seg.segment(run)) {
      if (part.isWordLike) out.push(part.segment);
    }
    if (out.length > 0) return out;
  }
  // Fallback: overlapping pairs of characters (a single character stays whole).
  const chars = run.match(_AM_CLUSTER_RE) || [];
  if (chars.length <= 1) return chars;
  const pairs = [];
  for (let i = 0; i < chars.length - 1; i++) pairs.push(chars[i] + chars[i + 1]);
  return pairs;
}

// Splits already-normalised text into tokens. Spaced scripts split on spaces;
// spaceless scripts use Intl.Segmenter when present, else character pairs.
function tokenise(text, lang) {
  if (typeof text !== 'string' || text === '') return [];
  const out = [];
  for (const chunk of text.split(' ')) {
    if (!chunk) continue;
    if (!_hasSpaceless(chunk)) { out.push(chunk); continue; }
    for (const run of chunk.match(_AM_SPACELESS_RUNS) || []) {
      if (_hasSpaceless(run)) out.push(..._segmentSpaceless(run, lang));
      else out.push(run);
    }
  }
  return out;
}

// Replaces split(/\s+/): a Chinese or Burmese answer used to count as one
// word, so it always tripped the "too short" check. Spaced text counts exactly
// as before (every whitespace-separated piece is a word).
function countWords(text, lang) {
  if (typeof text !== 'string') return 0;
  let n = 0;
  for (const chunk of text.split(/\s+/)) {
    if (!chunk) continue;
    if (!_hasSpaceless(chunk)) { n++; continue; }
    const seg = _segmenterFor(lang);
    for (const run of chunk.match(_AM_SPACELESS_RUNS) || []) {
      if (_hasSpaceless(run)) {
        if (seg) {
          for (const part of seg.segment(run)) if (part.isWordLike) n++;
        } else {
          // No segmenter: roughly two characters to a word.
          n += Math.ceil((run.match(_AM_CLUSTER_RE) || []).length / 2);
        }
      } else if (/[^\s\u0000-/:-@[-`{-¿ -⁯　-〿＀-･]/.test(run)) {
        n++;   // letters or digits mixed in with the spaceless text
      }
    }
  }
  return n;
}

// ── Content tokens, stems ─────────────────────────────────────────────────────

function _langKey(lang) {
  if (typeof lang !== 'string' || lang === '') return 'en';
  return lang.toLowerCase().split(/[-_]/)[0] || 'en';
}

// Is this token worth comparing? With a stopword list (English): not a
// stopword and longer than minLen−1. Without one: a length filter only, because
// we can't tell function words from content words — at least 3 letters for
// Latin script, any length for scripts where one character carries meaning.
function _isContent(token, lang, minLen) {
  const stop = STOPWORDS_BY_LANG[lang];
  if (stop) return token.length >= minLen && !stop.has(token);
  if (_AM_LATIN_START_RE.test(token) && !_AM_DIGITS_ONLY_RE.test(token)) {
    return token.length >= AM_LIMITS.MIN_LETTERS_LATIN;
  }
  return token.length >= 1;
}

// Tokens of `text` that carry content. `text` is raw (it is normalised here).
function contentTokens(text, lang) {
  const key = _langKey(lang);
  return tokenise(normaliseText(text), key).filter(tok => _isContent(tok, key, 2));
}

// First five letters of a Latin-script word, so "forgiven" and "forgiveness"
// meet. Other scripts, and numbers, are returned whole. Used only for the
// sampleAnswer fallback, where a loose match is wanted.
function stem(token) {
  if (typeof token !== 'string') return '';
  if (_AM_LATIN_START_RE.test(token) && !_AM_DIGITS_ONLY_RE.test(token)) {
    return token.slice(0, AM_LIMITS.STEM_LENGTH);
  }
  return token;
}

// ── keyTerms ──────────────────────────────────────────────────────────────────

// Turns the raw study value into [{ alternatives: [{ text, exact, inside, … }] }].
// Grammar, per entry string: alternatives separated by "|"; a trailing "$"
// means the whole word exactly; a single word otherwise matches at the start of
// a word (give or take one spelling slip in a word of five or more letters; see
// _fuzzyAltMatches); an alternative containing a space is a phrase matched at a word start;
// in scripts without spaces an alternative is matched as a substring. A leading
// "*" matches the text anywhere inside a word (for languages that attach prefixes
// to words, such as Arabic "bil-iman"); "$" is ignored with it. Anything
// that is not an array of strings is ignored, and over-long input is clipped,
// never thrown at.
function parseKeyTerms(raw) {
  const entries = [];
  try {
    if (!Array.isArray(raw)) return entries;
    for (let i = 0; i < raw.length && entries.length < AM_LIMITS.MAX_KEY_TERMS; i++) {
      const item = raw[i];
      if (typeof item !== 'string' || item === '') continue;
      // Clip before splitting so a huge string can't cost anything.
      const clipped = item.slice(0, (AM_LIMITS.MAX_ALTERNATIVE_CHARS + 1) * AM_LIMITS.MAX_ALTERNATIVES);
      const alternatives = [];
      for (const part of clipped.split('|')) {
        if (alternatives.length >= AM_LIMITS.MAX_ALTERNATIVES) break;
        let piece = part.trim().slice(0, AM_LIMITS.MAX_ALTERNATIVE_CHARS);
        let exact = false, inside = false;
        if (piece.startsWith('*')) { inside = true; piece = piece.slice(1); }
        else if (piece.endsWith('$')) { exact = true; piece = piece.slice(0, -1); }
        const text = normaliseText(piece);
        if (!text) continue;
        const spaceless = _hasSpaceless(text);
        alternatives.push({
          text, exact, inside,
          spaceless,
          phrase: !spaceless && text.indexOf(' ') !== -1,
          compact: spaceless ? text.replace(/ /g, '') : '',
        });
      }
      if (alternatives.length > 0) entries.push({ alternatives });
    }
  } catch (e) {
    return [];
  }
  return entries;
}

// ── Spelling slips ────────────────────────────────────────────────────────────
// A keyTerms word of FUZZY_MIN_LETTERS or more letters also matches a word that
// is one slip away (a letter wrong, missing, extra, or two swapped), provided
// the first letters agree: "forgivnes" meets forgiv. Only a-z words, only the
// non-$, non-* forms, and one slip however long the word: two slips let
// "religion" through for "religious". Tried only after the exact match fails.
const _AM_PLAIN_WORD_RE = /^[a-z]+$/;

// Real words that are one slip from a word an author is likely to use
// (think/thank, grace/grave, truth/trust, there/three). A reader who typed one
// of these meant it, so it is never forgiven as a slip; it still counts when
// the key term itself begins with it. English only. Picked from the words that
// the studies use most and that sit one wrong letter or swap from a key-term
// word. A word that is only an ending away (believed/believes) is not here.
const _AM_REAL_WORDS = new Set((
  'think thinks thinking thick thing things there these three those their where were whole white while whose ' +
  'would world word words works worth wound being bring begin bridge father faith heard hearing heart hearts ' +
  'grace grave graves truth trust truths same shame still place peace divine divide change chance chain ' +
  'sins signs shows shoes saying saving alone atone woman women among lives loves share shape better bitter ' +
  'brought bought present prevent honest homes means meals cross crops often four flour whether wheat what'
).split(' '));

// Common real words per language, beside STOPWORDS_BY_LANG. A language without
// an entry has no general list yet: its authors guard single questions with
// notTypos (below), and a word that keeps turning up can be promoted here.
const REAL_WORDS_BY_LANG = { en: _AM_REAL_WORDS };

// The words never forgiven as a slip for one question: the language's list plus
// the author's own notTypos (an array of words, normalised like an answer).
function _realWordsFor(langKey, notTypos) {
  const base = REAL_WORDS_BY_LANG[langKey] || null;
  if (!Array.isArray(notTypos) || notTypos.length === 0) return base;
  const set = new Set(base || []);
  for (const w of notTypos.slice(0, AM_LIMITS.MAX_NOT_TYPOS)) {
    if (typeof w !== 'string') continue;
    for (const tok of tokenise(normaliseText(w.slice(0, 60)), langKey)) set.add(tok);
  }
  return set;
}

// Is `a` within one slip of `b`? (Damerau–Levenshtein distance ≤ 1.)
function _withinOneSlip(a, b) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (i === la && i === lb) return true;
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;                                   // one letter wrong
    return i + 1 < la && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);   // two swapped
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);         // one letter extra / missing
}

// Does `tok` start with `word`, give or take one slip? Tried at the three
// lengths a slip can leave the start of the word at.
function _fuzzyStartsWith(word, tok) {
  if (tok[0] !== word[0] || !_AM_PLAIN_WORD_RE.test(tok)) return false;
  for (let n = word.length - 1; n <= word.length + 1; n++) {
    if (n <= tok.length && _withinOneSlip(word, tok.slice(0, n))) return true;
  }
  return false;
}

function _fuzzyAltMatches(alt, ctx) {
  if (alt.spaceless || alt.inside || alt.exact) return false;
  const words = alt.text.split(' ');
  const forgiving = w => w.length >= AM_LIMITS.FUZZY_MIN_LETTERS && _AM_PLAIN_WORD_RE.test(w);
  const real = tok => !!ctx.realWords && ctx.realWords.has(tok);
  if (!words.some(forgiving)) return false;
  const tokens = ctx.tokens;
  for (let i = 0; i + words.length <= tokens.length; i++) {
    let ok = true;
    for (let k = 0; k < words.length && ok; k++) {
      const w = words[k], tok = tokens[i + k];
      if (k < words.length - 1) {            // earlier words of a phrase are whole words
        ok = tok === w || (forgiving(w) && !real(tok) && tok[0] === w[0] && _AM_PLAIN_WORD_RE.test(tok) && _withinOneSlip(w, tok));
      } else {                               // the last word (or a lone word) is a word start
        ok = tok.startsWith(w) || (forgiving(w) && !real(tok) && _fuzzyStartsWith(w, tok));
      }
    }
    if (ok) return true;
  }
  return false;
}

function _altMatches(alt, ctx) {
  if (alt.spaceless) return ctx.compact.indexOf(alt.compact) !== -1;
  if (alt.inside) return ctx.text.indexOf(alt.text) !== -1;
  if (alt.phrase) {
    return alt.exact
      ? ctx.padded.indexOf(' ' + alt.text + ' ') !== -1
      : (' ' + ctx.text).indexOf(' ' + alt.text) !== -1;
  }
  if (alt.exact) return ctx.tokenSet.has(alt.text);
  for (const tok of ctx.tokens) if (tok.startsWith(alt.text)) return true;
  return false;
}

// How many keyTerms entries does the answer contain? An entry matches if ANY of
// its alternatives does. `parsedTerms` is the output of parseKeyTerms().
// `opts.exactOnly` turns the spelling tolerance off; `opts.notTypos` adds words
// the question's author has marked as never a slip.
function matchKeyTerms(answer, parsedTerms, lang, opts) {
  const total = Array.isArray(parsedTerms) ? parsedTerms.length : 0;
  if (total === 0) return { matched: 0, total: 0 };
  const text = normaliseText(String(typeof answer === 'string' ? answer : '').slice(0, AM_LIMITS.MAX_ANSWER_CHARS));
  const tokens = tokenise(text, _langKey(lang));
  const ctx = { text, padded: ' ' + text + ' ', compact: text.replace(/ /g, ''), tokens, tokenSet: new Set(tokens), realWords: _realWordsFor(_langKey(lang), opts && opts.notTypos) };
  const exactOnly = !!(opts && opts.exactOnly);   // authors' lint: spelling slips would hide a missing word form
  let matched = 0;
  for (const entry of parsedTerms) {
    if (!entry || !Array.isArray(entry.alternatives)) continue;
    if (entry.alternatives.some(alt => _altMatches(alt, ctx)) ||
        (!exactOnly && entry.alternatives.some(alt => _fuzzyAltMatches(alt, ctx)))) matched++;
  }
  return { matched, total };
}

// strong: at least half of the entries, and never fewer than two when there
// are two or more. partial: at least one. none: zero.
function tierFor(result) {
  const matched = result && Number.isFinite(result.matched) ? result.matched : 0;
  const total   = result && Number.isFinite(result.total)   ? result.total   : 0;
  if (total <= 0 || matched <= 0) return 'none';
  return matched >= Math.max(Math.ceil(total / 2), Math.min(2, total)) ? 'strong' : 'partial';
}

// ── The whole chain ───────────────────────────────────────────────────────────

// English-only filler list (kept for every language, as before).
const _AM_LOW_ENGAGEMENT = /^(i\s+don'?t\s+know|not\s+sure|not\s+really\s+sure|not\s+sure\s+about\s+this|no\s+idea|no\s+idea\s+at\s+all|no\s+clue|idk|idc|n\/a|yes|no|maybe|yeah|yep|nope|nah|ok|okay|sure|fine|true|false|dunno|duno|don'?t\s+know|tbh|tbd|tbc|t\.b\.c\.|todo|to\s+do|later|will\s+do|come\s+back\s+to\s+this|revisit|unsure|pass|skip|test|testing|asdf|qwerty|aaa+|xxx+|123+|--|[-?]|\?|\.{2,})\.?$/i;

// Share of `tokens` that sit inside a run of COPY_RUN_WORDS or more consecutive
// words found, in that order, in one of the passages. Stopwords count, so the
// run is the words as the reader would see them copied.
function _copiedShare(tokens, passages, lang) {
  const n = AM_LIMITS.COPY_RUN_WORDS;
  if (tokens.length < n) return 0;
  const grams = new Set();
  for (const p of passages) {
    const pt = tokenise(p, lang);
    for (let i = 0; i + n <= pt.length; i++) grams.add(pt.slice(i, i + n).join(' '));
  }
  const copied = new Array(tokens.length).fill(false);
  for (let i = 0; i + n <= tokens.length; i++) {
    if (grams.has(tokens.slice(i, i + n).join(' '))) for (let j = i; j < i + n; j++) copied[j] = true;
  }
  return copied.filter(Boolean).length / tokens.length;
}

function _clip(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

// Inputs (all optional except answer):
//   answer, questionText, passageTexts (array of plain strings), sampleAnswer,
//   keyTerms (raw study value), shortAnswerThreshold (number, numeric string or
//   null = default), skipBibleVerseCheck (boolean), lang,
//   notTypos (array of words that are never forgiven as spelling slips)
// Returns { code, matched, total }; code is one of
//   stuck | tooShort | repeatsQuestion | repeatsPassage | offTopic |
//   partial | strong | pass | passNoSample
// No user-visible text is built here.
function evaluateAnswer(input) {
  try {
    return _evaluateAnswer(input);
  } catch (e) {
    // Hostile or broken input must never break typing or saving. This is a
    // last resort: the field checks above already ignore bad types.
    return { code: 'passNoSample', matched: 0, total: 0 };
  }
}

function _evaluateAnswer(input) {
  const o = input && typeof input === 'object' ? input : {};
  const lang = _langKey(o.lang);
  const ratio = STOPWORDS_BY_LANG[lang] ? AM_LIMITS.RATIO_WITH_STOPWORDS : AM_LIMITS.RATIO_NO_STOPWORDS;
  const answer = _clip(o.answer, AM_LIMITS.MAX_ANSWER_CHARS).trim();
  const sample = _clip(o.sampleAnswer, AM_LIMITS.MAX_CONTEXT_CHARS);
  const result = (code, matched = 0, total = 0) => ({ code, matched, total });

  // 1. Low-engagement filler. Curly apostrophes are treated as straight ones.
  if (_AM_LOW_ENGAGEMENT.test(answer.replace(/[’ʼ]/g, "'"))) return result('stuck');

  // 2. Very short answer. The minimum is calibrated against the sample answer
  // when there is one; an author-supplied threshold overrides it, and 0 turns
  // the check off.
  const wordCount = countWords(answer, lang);
  let minWords;
  const th = o.shortAnswerThreshold;
  const override = (typeof th === 'number' || (typeof th === 'string' && th !== '')) ? parseInt(th, 10) : NaN;
  if (Number.isFinite(override)) minWords = override;
  else if (sample) minWords = Math.min(6, Math.round(countWords(sample, lang) * 0.35));
  else minWords = 6;
  if (minWords > 0 && wordCount < minWords) return result('tooShort');

  const normAnswer = normaliseText(answer);
  const answerTokens = tokenise(normAnswer, lang);

  // 3. The answer repeats the question.
  const normQuestion = normaliseText(_clip(o.questionText, AM_LIMITS.MAX_CONTEXT_CHARS));
  if (normQuestion.length > AM_LIMITS.MIN_CHARS_FOR_QUESTION_CHECK) {
    const qWords = new Set(tokenise(normQuestion, lang).filter(tok => _isContent(tok, lang, 2)));
    const aList  = answerTokens.filter(tok => _isContent(tok, lang, 1));
    const overlap = aList.filter(tok => qWords.has(tok)).length;
    if ((aList.length > 0 ? overlap / aList.length : 0) > ratio) return result('repeatsQuestion');
  }

  // 4. The answer repeats a linked Bible passage (any translation).
  if (!o.skipBibleVerseCheck && Array.isArray(o.passageTexts)) {
    const passages = o.passageTexts
      .filter(s => typeof s === 'string' && s.length > AM_LIMITS.MIN_CHARS_FOR_QUESTION_CHECK)
      .map(s => normaliseText(s.slice(0, AM_LIMITS.MAX_CONTEXT_CHARS)));
    if (passages.length > 0) {
      const pWords = new Set();
      for (const p of passages) for (const tok of tokenise(p, lang)) if (_isContent(tok, lang, 2)) pWords.add(tok);
      const aList = answerTokens.filter(tok => _isContent(tok, lang, 2));
      const overlap = aList.filter(tok => pWords.has(tok)).length;
      const ratioAnswer = aList.length > 0 ? overlap / aList.length : 0;
      const hasOriginalWords = aList.some(tok => !pWords.has(tok));
      if (!hasOriginalWords) return result('repeatsPassage');
      if (ratioAnswer > ratio) {
        // Where there is a stopword list, an answer that merely shares the passage's
        // vocabulary (a correct answer on the same topic) is not a copy: it repeats
        // the passage only if it is nearly all passage words, copies runs of it, or
        // is a list of words rather than sentences.
        const stop = STOPWORDS_BY_LANG[lang];
        if (!stop || ratioAnswer > AM_LIMITS.RATIO_COPY_CERTAIN) return result('repeatsPassage');
        const sentenceLike = answerTokens.filter(tok => stop.has(tok)).length / answerTokens.length >= AM_LIMITS.MIN_STOPWORD_SHARE;
        if (!sentenceLike || _copiedShare(answerTokens, passages, lang) >= AM_LIMITS.COPY_RUN_SHARE) return result('repeatsPassage');
      }
    }
  }

  // 5. Does the answer contain what the author asked for?
  const terms = parseKeyTerms(o.keyTerms);
  if (terms.length > 0) {
    const m = matchKeyTerms(answer, terms, lang, { notTypos: o.notTypos });
    const tier = tierFor(m);
    if (tier === 'strong')  return result('strong',  m.matched, m.total);
    if (tier === 'partial') return result('partial', m.matched, m.total);
    return result('offTopic', m.matched, m.total);
  }

  // No keyTerms: only the loose sampleAnswer check, which can never earn praise
  // beyond the generic "pass".
  if (sample.trim().length > 10) {
    const sampleStems = new Set(tokenise(normaliseText(sample), lang).filter(tok => _isContent(tok, lang, 2)).map(stem));
    if (sampleStems.size >= 3) {
      const aStems = new Set(answerTokens.filter(tok => _isContent(tok, lang, 2)).map(stem));
      let shared = 0;
      for (const s of aStems) if (sampleStems.has(s)) shared++;
      if (shared === 0) return result('offTopic');
    }
    return result('pass');
  }
  return result('passNoSample');
}
