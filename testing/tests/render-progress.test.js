/**
 * Tests for _getChapterProgressFromRecord() in render-progress.js.
 *
 * Paths are relative to testing/tests/ — source files are in ../../app/js/
 *
 * This function has had multiple bug fixes (bipolar Likert, sections null guard)
 * so it is a priority regression target.
 *
 * Strategy: load state.js and render-progress.js into a shared vm sandbox so
 * that answerFieldKey / likertFieldKey are available as globals when
 * _getChapterProgressFromRecord runs — exactly as they are in the WebView.
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
  // Load state.js first so key helpers are available as globals
  const stateCode    = readFileSync(join(__dirname, '../../app/js/state.js'),           'utf8');
  const progressCode = readFileSync(join(__dirname, '../../app/js/render-progress.js'), 'utf8');
  vm.runInContext(stateCode,    sandbox);
  vm.runInContext(progressCode, sandbox);
  return sandbox;
}

const { _getChapterProgressFromRecord } = loadSandbox();

// ── Helpers to build minimal chapter/record objects ───────────────────────────

// Builds a chapter with n questions spread across one section.
function chapterWithQuestions(n) {
  const questions = Array.from({ length: n }, (_, i) => ({ elementId: `q_el_${i}` }));
  return { sections: [{ questions }], elements: [] };
}

// Builds an answer record with all questions answered.
function answeredRecord(ch) {
  const record = {};
  (ch.sections || []).forEach(sec =>
    (sec.questions || []).forEach(q => {
      record[`q_${q.elementId}`] = 'some answer';
    })
  );
  return record;
}

// ── Empty / null guard tests ──────────────────────────────────────────────────

describe('_getChapterProgressFromRecord — empty chapter', () => {
  it('returns zero totals for a chapter with no sections or elements', () => {
    const ch = { sections: [], elements: [] };
    expect(_getChapterProgressFromRecord(ch, {})).toEqual({ total: 0, answered: 0, pct: 0 });
  });

  it('returns zero totals when sections is undefined', () => {
    const ch = {};
    expect(_getChapterProgressFromRecord(ch, {})).toEqual({ total: 0, answered: 0, pct: 0 });
  });

  it('returns pct 0 (not NaN or error) when total is 0', () => {
    const result = _getChapterProgressFromRecord({}, {});
    expect(result.pct).toBe(0);
  });
});

// ── Question counting ─────────────────────────────────────────────────────────

describe('_getChapterProgressFromRecord — questions', () => {
  it('counts unanswered questions correctly', () => {
    const ch = chapterWithQuestions(3);
    const result = _getChapterProgressFromRecord(ch, {});
    expect(result).toEqual({ total: 3, answered: 0, pct: 0 });
  });

  it('counts answered questions correctly', () => {
    const ch = chapterWithQuestions(3);
    const record = answeredRecord(ch);
    const result = _getChapterProgressFromRecord(ch, record);
    expect(result).toEqual({ total: 3, answered: 3, pct: 100 });
  });

  it('counts partially answered questions correctly', () => {
    const ch = chapterWithQuestions(4);
    const record = {};
    // Answer only the first two
    record[`q_${ch.sections[0].questions[0].elementId}`] = 'answer';
    record[`q_${ch.sections[0].questions[1].elementId}`] = 'answer';
    const result = _getChapterProgressFromRecord(ch, record);
    expect(result).toEqual({ total: 4, answered: 2, pct: 50 });
  });

  it('ignores whitespace-only answers', () => {
    const ch = chapterWithQuestions(2);
    const record = {};
    record[`q_${ch.sections[0].questions[0].elementId}`] = '   ';
    const result = _getChapterProgressFromRecord(ch, record);
    expect(result.answered).toBe(0);
  });

  it('counts questions across multiple sections', () => {
    const ch = {
      sections: [
        { questions: [{ elementId: 'q_a' }, { elementId: 'q_b' }] },
        { questions: [{ elementId: 'q_c' }] },
      ],
      elements: [],
    };
    const result = _getChapterProgressFromRecord(ch, {});
    expect(result.total).toBe(3);
  });
});

// ── Reflection counting ───────────────────────────────────────────────────────

describe('_getChapterProgressFromRecord — reflections', () => {
  it('counts unanswered reflections', () => {
    const ch = {
      sections: [],
      elements: [
        { type: 'question', subtype: 'reflection', elementId: 'r_el_0' },
        { type: 'question', subtype: 'reflection', elementId: 'r_el_1' },
      ],
      reflection: ['prompt 1', 'prompt 2'],
    };
    const result = _getChapterProgressFromRecord(ch, {});
    expect(result).toEqual({ total: 2, answered: 0, pct: 0 });
  });

  it('counts answered reflections', () => {
    const ch = {
      sections: [],
      elements: [
        { type: 'question', subtype: 'reflection', elementId: 'r_el_0' },
      ],
      reflection: ['prompt 1'],
    };
    const record = { 'r_r_el_0': 'my reflection' };
    const result = _getChapterProgressFromRecord(ch, record);
    expect(result).toEqual({ total: 1, answered: 1, pct: 100 });
  });

  it('excludes repeatElement reflections from count', () => {
    const ch = {
      sections: [],
      elements: [
        { type: 'question', subtype: 'reflection', elementId: 'r_el_0' },
        { type: 'question', subtype: 'reflection', elementId: 'r_el_1', repeatElement: true },
      ],
      reflection: ['prompt 1', 'prompt 2'],
    };
    // Only r_el_0 should be counted (r_el_1 is a repeatElement)
    const result = _getChapterProgressFromRecord(ch, {});
    expect(result.total).toBe(2); // reflection array drives the count, not elements
  });
});

// ── Standard Likert counting ──────────────────────────────────────────────────

describe('_getChapterProgressFromRecord — standard Likert', () => {
  it('counts each statement as a separate answerable item', () => {
    const ch = {
      sections: [],
      elements: [{
        type: 'likertScale',
        subtype: 'standard',
        elementId: 'el_lk1',
        statements: ['stmt 0', 'stmt 1', 'stmt 2'],
      }],
    };
    const result = _getChapterProgressFromRecord(ch, {});
    expect(result.total).toBe(3);
    expect(result.answered).toBe(0);
  });

  it('counts answered Likert statements', () => {
    const ch = {
      sections: [],
      elements: [{
        type: 'likertScale',
        subtype: 'standard',
        elementId: 'el_lk1',
        statements: ['stmt 0', 'stmt 1'],
      }],
    };
    const record = {
      'likert_el_lk1_0': '3',
      'likert_el_lk1_1': '5',
    };
    const result = _getChapterProgressFromRecord(ch, record);
    expect(result).toEqual({ total: 2, answered: 2, pct: 100 });
  });

  it('excludes repeatElement Likert from count', () => {
    const ch = {
      sections: [],
      elements: [{
        type: 'likertScale',
        elementId: 'el_lk1',
        statements: ['stmt 0'],
        repeatElement: true,
      }],
    };
    const result = _getChapterProgressFromRecord(ch, {});
    expect(result.total).toBe(0);
  });
});

// ── Bipolar Likert counting ───────────────────────────────────────────────────

describe('_getChapterProgressFromRecord — bipolar Likert', () => {
  it('uses statementPairs (not statements) for row count', () => {
    const ch = {
      sections: [],
      elements: [{
        type: 'likertScale',
        subtype: 'bipolar',
        elementId: 'el_bp1',
        statementPairs: [
          { left: 'cold', right: 'hot' },
          { left: 'dark', right: 'light' },
        ],
        // statements is absent — should not cause an error or wrong count
      }],
    };
    const result = _getChapterProgressFromRecord(ch, {});
    expect(result.total).toBe(2);
    expect(result.answered).toBe(0);
  });

  it('counts answered bipolar Likert statements', () => {
    const ch = {
      sections: [],
      elements: [{
        type: 'likertScale',
        subtype: 'bipolar',
        elementId: 'el_bp1',
        statementPairs: [
          { left: 'cold', right: 'hot' },
          { left: 'dark', right: 'light' },
        ],
      }],
    };
    const record = {
      'likert_el_bp1_0': '2',
      'likert_el_bp1_1': '4',
    };
    const result = _getChapterProgressFromRecord(ch, record);
    expect(result).toEqual({ total: 2, answered: 2, pct: 100 });
  });

  it('does not fall back to statements array for bipolar subtype', () => {
    // A bipolar element that also has a statements array (shouldn't happen, but
    // guards against a regression where standard logic ran for bipolar too).
    const ch = {
      sections: [],
      elements: [{
        type: 'likertScale',
        subtype: 'bipolar',
        elementId: 'el_bp2',
        statementPairs: [{ left: 'a', right: 'b' }],
        statements: ['extra1', 'extra2', 'extra3'],  // should be ignored
      }],
    };
    const result = _getChapterProgressFromRecord(ch, {});
    expect(result.total).toBe(1); // statementPairs length, not statements length
  });
});

// ── Mixed content chapters ─────────────────────────────────────────────────────

describe('_getChapterProgressFromRecord — mixed content', () => {
  it('totals questions, reflections, and Likert together', () => {
    const ch = {
      sections: [{ questions: [{ elementId: 'q_el_0' }, { elementId: 'q_el_1' }] }],
      elements: [
        { type: 'question', subtype: 'reflection', elementId: 'r_el_0' },
        { type: 'likertScale', subtype: 'standard', elementId: 'el_lk1', statements: ['s0', 's1'] },
      ],
      reflection: ['reflect 1'],
    };
    // 2 questions + 1 reflection + 2 Likert = 5 total
    const result = _getChapterProgressFromRecord(ch, {});
    expect(result.total).toBe(5);
    expect(result.answered).toBe(0);
  });

  it('calculates percentage correctly for mixed partial answers', () => {
    const ch = {
      sections: [{ questions: [{ elementId: 'q_el_0' }, { elementId: 'q_el_1' }] }],
      elements: [
        { type: 'likertScale', subtype: 'standard', elementId: 'el_lk1', statements: ['s0', 's1', 's2'] },
      ],
    };
    // 2 questions + 3 Likert = 5 total; answer 1 question + 2 Likert = 3 answered = 60%
    const record = {
      'q_q_el_0':       'answer',
      'likert_el_lk1_0': '3',
      'likert_el_lk1_1': '4',
    };
    const result = _getChapterProgressFromRecord(ch, record);
    expect(result.total).toBe(5);
    expect(result.answered).toBe(3);
    expect(result.pct).toBe(60);
  });
});
