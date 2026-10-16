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
  MIN_CHARS_FOR_QUESTION_CHECK: 20,
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
// a word; an alternative containing a space is a phrase matched at a word start;
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
function matchKeyTerms(answer, parsedTerms, lang) {
  const total = Array.isArray(parsedTerms) ? parsedTerms.length : 0;
  if (total === 0) return { matched: 0, total: 0 };
  const text = normaliseText(String(typeof answer === 'string' ? answer : '').slice(0, AM_LIMITS.MAX_ANSWER_CHARS));
  const tokens = tokenise(text, _langKey(lang));
  const ctx = { text, padded: ' ' + text + ' ', compact: text.replace(/ /g, ''), tokens, tokenSet: new Set(tokens) };
  let matched = 0;
  for (const entry of parsedTerms) {
    if (entry && Array.isArray(entry.alternatives) && entry.alternatives.some(alt => _altMatches(alt, ctx))) matched++;
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

function _clip(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

// Inputs (all optional except answer):
//   answer, questionText, passageTexts (array of plain strings), sampleAnswer,
//   keyTerms (raw study value), shortAnswerThreshold (number, numeric string or
//   null = default), skipBibleVerseCheck (boolean), lang
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
      if (ratioAnswer > ratio || !hasOriginalWords) return result('repeatsPassage');
    }
  }

  // 5. Does the answer contain what the author asked for?
  const terms = parseKeyTerms(o.keyTerms);
  if (terms.length > 0) {
    const m = matchKeyTerms(answer, terms, lang);
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
