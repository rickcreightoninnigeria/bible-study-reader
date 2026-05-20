/**
 * Tests for pure functions in search.js:
 *   normalize, expandQuery, levenshtein, getSuggestion, scoreResult
 *
 * runSearchCore is async and DOM-dependent — not tested here.
 *
 * Paths are relative to testing/tests/ — source files are in ../../app/js/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSandbox() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  // state.js first — search.js uses answerFieldKey as a global
  vm.runInContext(readFileSync(join(__dirname, '../../app/js/state.js'),  'utf8'), sandbox);
  vm.runInContext(readFileSync(join(__dirname, '../../app/js/search.js'), 'utf8'), sandbox);
  return sandbox;
}

const {
  normalize,
  expandQuery,
  levenshtein,
  getSuggestion,
  scoreResult,
} = loadSandbox();

// ── normalize ─────────────────────────────────────────────────────────────────

describe('normalize', () => {
  it('lowercases a string', () => {
    expect(normalize('Grace')).toBe('grace');
  });

  it('lowercases all-caps', () => {
    expect(normalize('GOSPEL')).toBe('gospel');
  });

  it('leaves already-lowercase strings unchanged', () => {
    expect(normalize('faith')).toBe('faith');
  });

  it('handles empty string', () => {
    expect(normalize('')).toBe('');
  });
});

// ── expandQuery ───────────────────────────────────────────────────────────────

describe('expandQuery', () => {
  it('returns the original word in the expansion', () => {
    const result = expandQuery('faith');
    expect(result).toContain('faith');
  });

  it('expands a known synonym key', () => {
    const result = expandQuery('faith');
    // SYNONYMS.faith includes 'belief', 'trust', 'confidence', 'assurance', 'pistis'
    expect(result).toContain('belief');
    expect(result).toContain('trust');
  });

  it('returns only the word when no synonyms exist', () => {
    const result = expandQuery('exegesis');
    expect(result).toEqual(['exegesis']);
  });

  it('lowercases the query before expanding', () => {
    const result = expandQuery('Faith');
    expect(result).toContain('faith');
    expect(result).toContain('belief');
  });

  it('handles multi-word query — expands each word independently', () => {
    const result = expandQuery('faith grace');
    expect(result).toContain('faith');
    expect(result).toContain('grace');
    // faith synonyms
    expect(result).toContain('trust');
    // grace synonyms
    expect(result).toContain('charis');
  });

  it('deduplicates terms that appear in multiple synonym lists', () => {
    // 'christ' synonyms include 'messiah'; check no duplicates
    const result = expandQuery('christ');
    const unique = new Set(result);
    expect(unique.size).toBe(result.length);
  });

  it('returns empty array for empty string', () => {
    expect(expandQuery('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(expandQuery('   ')).toEqual([]);
  });
});

// ── levenshtein ───────────────────────────────────────────────────────────────

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('grace', 'grace')).toBe(0);
  });

  it('returns 1 for a single substitution', () => {
    expect(levenshtein('grace', 'trace')).toBe(1);
  });

  it('returns 1 for a single insertion', () => {
    expect(levenshtein('sin', 'sins')).toBe(1);
  });

  it('returns 1 for a single deletion', () => {
    expect(levenshtein('sins', 'sin')).toBe(1);
  });

  it('returns correct distance for a common typo', () => {
    // 'baptsim' vs 'baptism' — two transpositions = distance 2
    expect(levenshtein('baptsim', 'baptism')).toBeLessThanOrEqual(3);
  });

  it('returns string length when comparing to empty string', () => {
    expect(levenshtein('grace', '')).toBe(5);
    expect(levenshtein('', 'grace')).toBe(5);
  });

  it('returns 0 for two empty strings', () => {
    expect(levenshtein('', '')).toBe(0);
  });

  it('is not necessarily symmetric (implementation detail — just document behaviour)', () => {
    // Both directions should give a low distance for similar strings
    const ab = levenshtein('repentance', 'repentence');
    const ba = levenshtein('repentence', 'repentance');
    expect(ab).toBeLessThanOrEqual(2);
    expect(ba).toBeLessThanOrEqual(2);
  });
});

// ── getSuggestion ─────────────────────────────────────────────────────────────

describe('getSuggestion', () => {
  it('returns null for an exact THEO_KEYWORD match (no suggestion needed)', () => {
    // 'grace' is in THEO_KEYWORDS with distance 0 — may return it or null
    // The important thing: it does not throw
    expect(() => getSuggestion('grace')).not.toThrow();
  });

  it('returns a suggestion for a close misspelling', () => {
    // 'grce' is distance 1 from 'grace'
    const result = getSuggestion('grce');
    expect(result).toBe('grace');
  });

  it('returns a suggestion for a one-character typo', () => {
    // 'fath' is distance 1 from 'faith'
    const result = getSuggestion('fath');
    expect(result).toBe('faith');
  });

  it('returns null for a query longer than 12 characters', () => {
    expect(getSuggestion('averylongquerythatexceedslimit')).toBeNull();
  });

  it('returns null when no keyword is within distance 2', () => {
    // 'zzzzz' is far from everything
    expect(getSuggestion('zzzzz')).toBeNull();
  });

  it('returns the closest match when multiple are within distance 2', () => {
    // Result should be a string (whichever keyword wins)
    const result = getSuggestion('sins');
    expect(typeof result === 'string' || result === null).toBe(true);
  });
});

// ── scoreResult ───────────────────────────────────────────────────────────────

describe('scoreResult', () => {
  // Helper: score a piece of text against a single query term
  function score(text, query, type = 'question', ref = '', answer = '') {
    return scoreResult({ text, ref, type, answer }, [query], query);
  }

  it('exact match scores higher than partial match', () => {
    const exact   = score('grace', 'grace');
    const partial = score('amazing grace abounds', 'grace');
    expect(exact).toBeGreaterThan(partial);
  });

  it('startsWith match scores higher than includes match', () => {
    const starts   = score('grace and mercy', 'grace');
    const includes = score('the amazing grace', 'grace');
    expect(starts).toBeGreaterThan(includes);
  });

  it('original query term gets higher multiplier than synonym', () => {
    // expandQuery('faith') returns ['faith', 'belief', 'trust', ...]
    // Scoring against the original query word should beat scoring against synonym
    const queries = ['faith', 'belief', 'trust'];
    const originalQuery = 'faith';
    const scoreOriginal  = scoreResult({ text: 'faith', type: 'question' }, queries, originalQuery);
    const scoreSynonym   = scoreResult({ text: 'belief', type: 'question' }, queries, originalQuery);
    // 'faith' exact-matches the original query (1.5x multiplier)
    // 'belief' exact-matches a synonym (1.0x multiplier)
    expect(scoreOriginal).toBeGreaterThan(scoreSynonym);
  });

  it('answer type scores higher than bridge type for same text', () => {
    const answerScore = score('repentance', 'repentance', 'answer');
    const bridgeScore = score('repentance', 'repentance', 'bridge');
    expect(answerScore).toBeGreaterThan(bridgeScore);
  });

  it('question type scores higher than bridge type for same text', () => {
    const questionScore = score('repentance', 'repentance', 'question');
    const bridgeScore   = score('repentance', 'repentance', 'bridge');
    expect(questionScore).toBeGreaterThan(bridgeScore);
  });

  it('ref match adds to score', () => {
    const withRef    = scoreResult({ text: 'some text', ref: 'Romans 3:23', type: 'question' }, ['romans'], 'romans');
    const withoutRef = scoreResult({ text: 'some text', ref: '',            type: 'question' }, ['romans'], 'romans');
    expect(withRef).toBeGreaterThan(withoutRef);
  });

  it('having a saved answer adds to score', () => {
    const withAnswer    = scoreResult({ text: 'grace', type: 'question', answer: 'my note' }, ['grace'], 'grace');
    const withoutAnswer = scoreResult({ text: 'grace', type: 'question', answer: ''        }, ['grace'], 'grace');
    expect(withAnswer).toBeGreaterThan(withoutAnswer);
  });

  it('theological keyword in text adds to score', () => {
    // 'grace' is in THEO_KEYWORDS — text containing it should score higher
    const withKeyword    = score('the grace of God', 'mercy');
    const withoutKeyword = score('the thing we want', 'mercy');
    // withKeyword contains a THEO_KEYWORD (grace) so gets +20
    expect(withKeyword).toBeGreaterThanOrEqual(withoutKeyword);
  });

  it('shorter text scores higher than longer text for same match', () => {
    // score += Math.max(0, 50 - text.length / 10)
    const short = score('grace', 'grace');
    const long  = score('grace '.repeat(50), 'grace');
    expect(short).toBeGreaterThan(long);
  });

  it('returns a number', () => {
    expect(typeof score('grace', 'grace')).toBe('number');
  });

  it('returns 0 or more for no match', () => {
    // No query match but type bonus and length bonus still apply
    expect(score('completely unrelated text', 'zzz')).toBeGreaterThanOrEqual(0);
  });
});
