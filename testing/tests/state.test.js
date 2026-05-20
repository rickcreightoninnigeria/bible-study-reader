/**
* Paths are relative to testing/tests/ — source files are in ../../app/js/
* Tests for state.js key helper functions.
 * Signatures verified against actual state.js source.
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
  vm.runInContext(readFileSync(join(__dirname, '../../app/js/state.js'), 'utf8'), sandbox);
  return sandbox;
}

const {
  answerFieldKey,
  likertFieldKey,
  celebratedIDBKey,
  starFieldKey,
  chapterAnswersIDBKey,
} = loadSandbox();

// ─── answerFieldKey(type, index) ──────────────────────────────────────────────

describe('answerFieldKey', () => {
  it('produces correct key for a question answer', () => {
    expect(answerFieldKey('q', '1_2')).toBe('q_1_2');
  });

  it('produces correct key for a reflection answer', () => {
    expect(answerFieldKey('r', 3)).toBe('r_3');
  });

  it('produces correct key for chapter notes', () => {
    expect(answerFieldKey('notes', 0)).toBe('notes_0');
  });

  it('produces distinct keys for different types', () => {
    expect(answerFieldKey('q', '1_0')).not.toBe(answerFieldKey('r', '1_0'));
  });

  it('produces distinct keys for different indices', () => {
    expect(answerFieldKey('q', '1_0')).not.toBe(answerFieldKey('q', '1_1'));
  });
});

// ─── likertFieldKey(elementId, stIdx) ────────────────────────────────────────

describe('likertFieldKey', () => {
  it('produces correct key for a Likert statement', () => {
    expect(likertFieldKey('el_42', 0)).toBe('likert_el_42_0');
  });

  it('produces distinct keys for different statement indices', () => {
    expect(likertFieldKey('el_42', 0)).not.toBe(likertFieldKey('el_42', 1));
  });

  it('produces distinct keys for different element ids', () => {
    expect(likertFieldKey('el_42', 0)).not.toBe(likertFieldKey('el_99', 0));
  });

  it('does not collide with answerFieldKey output', () => {
    expect(likertFieldKey('el_1', 0)).not.toBe(answerFieldKey('q', '1_0'));
  });
});

// ─── celebratedIDBKey(studyId, chapterNum) ────────────────────────────────────

describe('celebratedIDBKey', () => {
  it('produces correct standalone IDB key', () => {
    expect(celebratedIDBKey('baptism', 2)).toBe('baptism_celebrated_ch2');
  });

  it('produces distinct keys for different chapters', () => {
    expect(celebratedIDBKey('baptism', 1)).not.toBe(celebratedIDBKey('baptism', 2));
  });

  it('produces distinct keys for different studies', () => {
    expect(celebratedIDBKey('baptism', 1)).not.toBe(celebratedIDBKey('markCh5', 1));
  });

  it('does not match chapterAnswersIDBKey (celebrated is a separate IDB entry)', () => {
    expect(celebratedIDBKey('baptism', 2)).not.toBe(chapterAnswersIDBKey('baptism', 2));
  });
});

// ─── starFieldKey(elementId) ─────────────────────────────────────────────────

describe('starFieldKey', () => {
  it('produces correct field key for a starred element', () => {
    expect(starFieldKey('el_7')).toBe('star_el_7');
  });

  it('produces distinct keys for different element ids', () => {
    expect(starFieldKey('el_7')).not.toBe(starFieldKey('el_8'));
  });

  it('does not collide with likertFieldKey', () => {
    expect(starFieldKey('el_1')).not.toBe(likertFieldKey('el_1', 0));
  });
});

// ─── chapterAnswersIDBKey(studyId, chapterNum) ────────────────────────────────

describe('chapterAnswersIDBKey', () => {
  it('produces correct IDB record key', () => {
    expect(chapterAnswersIDBKey('baptism', 3)).toBe('baptism_ch3');
  });

  it('produces distinct keys for different studies', () => {
    expect(chapterAnswersIDBKey('baptism', 1)).not.toBe(chapterAnswersIDBKey('markCh5', 1));
  });

  it('produces distinct keys for different chapters', () => {
    expect(chapterAnswersIDBKey('baptism', 1)).not.toBe(chapterAnswersIDBKey('baptism', 2));
  });
});

// ─── Cross-function collision check ───────────────────────────────────────────

describe('no key collisions across helpers', () => {
  it('all helpers produce distinct output for overlapping inputs', () => {
    const keys = [
      answerFieldKey('q', '1_0'),
      likertFieldKey('el_1', 0),
      celebratedIDBKey('baptism', 1),
      starFieldKey('el_1'),
      chapterAnswersIDBKey('baptism', 1),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
