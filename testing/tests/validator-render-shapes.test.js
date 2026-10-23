/**
 * validate_study.py: field shapes that make the renderer throw or draw nothing.
 * Runs the real script on small temporary studies; skipped if python3 is absent.
 *
 * Paths are relative to testing/tests/ — the script is ../../py/validate_study.py
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../../py/validate_study.py');
const hasPython = spawnSync('python3', ['--version']).status === 0;

const base = (elements, extra = {}) => ({
  studyMetadata: { studyId: 't', studyVersion: 1.01 },
  chapters: [{ chapterNumber: 1, elements }],
  ...extra,
});
const likert = (extra) => ({ elementId: 'l1', type: 'likertScale', scale: ['No', 'Yes'], statements: ['I try'], ...extra });

function validate(obj) {
  const dir = mkdtempSync(join(tmpdir(), 'bsr-validate-'));
  try {
    const file = join(dir, 'study.json');
    writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj));
    const r = spawnSync('python3', ['-I', SCRIPT, file], { encoding: 'utf8' });
    return { out: r.stdout, err: r.stderr, status: r.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!hasPython)('validate_study.py render-shape checks', () => {
  it('passes a well-formed study with every element type, with no messages', () => {
    const { out } = validate(base([
      { elementId: 'h', type: 'heading', subtype: 'section', text: 'A' },
      { elementId: 't', type: 'text', text: 'Hello' },
      { elementId: 'q', type: 'question', question: 'Why?' },
      { elementId: 'c', type: 'callout', subtype: 'highlighted', term: 'x', body: 'y' },
      likert(),
      likert({ elementId: 'l2', subtype: 'bipolar', statements: undefined, statementPairs: [{ left: 'a', right: 'b' }] }),
      { repeatElement: 'q' },
    ]));
    expect(out).toContain('0 error(s), 0 warning(s)');
  });

  it('reports structure that would crash, without crashing itself', () => {
    const cases = [
      [{ studyMetadata: { studyId: 't' }, chapters: ['oops'] }, 'chapters[0] is not an object'],
      [base(null, { chapters: [{ chapterNumber: 1, elements: 'abc' }] }), 'elements must be an array'],
      [base([null, 5]), 'elements[0] is not an object'],
      [base([], { goDeeperData: [] }), 'goDeeperData must be an object'],
      [base([], { goDeeperData: { chapters: 'x' } }), 'goDeeperData.chapters must be an array'],
      [base([], { goDeeperData: { chapters: [{ chapterNumber: 1, footnotes: ['x'] }] } }), 'footnotes must be an array of'],
      ['[1, 2]', 'the file must hold one JSON object'],
      [{ chapters: [] }, 'studyMetadata is missing'],
    ];
    for (const [study, msg] of cases) {
      const r = validate(study);
      expect(r.err, msg).not.toContain('Traceback');
      expect(r.out, msg).toContain(msg);
    }
  });

  it('errors on a text field that is not a string', () => {
    const { out, status } = validate(base([
      { elementId: 'a', type: 'text', text: ['para one', 'para two'] },
      { elementId: 'b', type: 'text', text1: 'ok', text2: 3 },
      { elementId: 'c', type: 'image', caption: { x: 1 } },
      { elementId: 'd', type: 'question', subtype: 'header', header: ['x'], question: 'q' },
      { elementId: 'e', type: 'callout', subtype: 'highlighted', body: ['x'] },
    ]));
    expect(status).toBe(1);
    expect(out).toContain('a: text must be a string, not list');
    expect(out).toContain('b: text2 must be a string, not int');
    expect(out).not.toContain('text1 must');
    expect(out).toContain('c: caption must be a string');
    expect(out).toContain('d: header must be a string');
    expect(out).toContain('e: body must be a string');
  });

  it('errors on Likert fields of the wrong shape', () => {
    const { out } = validate(base([
      likert({ elementId: 'a', statements: 'one statement' }),
      likert({ elementId: 'b', statements: ['ok', 3] }),
      likert({ elementId: 'c', scale: 'No|Yes' }),
      likert({ elementId: 'd', subtype: 'bipolar', statements: undefined, statementPairs: [{ left: 'a' }] }),
      likert({ elementId: 'e', subtype: 'bipolar', statements: undefined, statementPairs: 'x' }),
    ]));
    expect(out).toContain('a: statements must be an array');
    expect(out).toContain('b: statements should be an array of strings');
    expect(out).toContain('c: scale must be an array of label strings');
    expect(out).toContain('d: statementPairs[0] must be an object with string "left" and "right"');
    expect(out).toContain('e: statementPairs must be an array');
  });

  it('checks numbered slots too', () => {
    const { out } = validate(base([likert({ statements: undefined, statements1: ['ok'], statements2: 'bad' })]));
    expect(out).toContain('statements2 must be an array');
    expect(out).not.toContain('statements1 must');
  });

  it('warns about a Likert card with no rows and a scaleNumber outside 1-10', () => {
    const { out } = validate(base([
      likert({ elementId: 'a', statements: [] }),
      likert({ elementId: 'b', scaleNumber: 12 }),
      likert({ elementId: 'c', scaleNumber: '7' }),
    ]));
    expect(out).toContain('a: no statements, so the card has no rows');
    expect(out).toContain("b: scaleNumber 12 is not between 1 and 10");
    expect(out).not.toContain('c: scaleNumber');
  });

  it('warns about unknown types and subtypes that draw nothing, but not about repeatElement pointers', () => {
    const { out } = validate(base([
      { elementId: 'a', type: 'video' },
      { elementId: 'b' },
      { elementId: 'c', type: 'heading', subtype: 'big', text: 'x' },
      { elementId: 'd', type: 'callout', subtype: 'fancy' },
      { elementId: 'q', type: 'question', question: 'q' },
      { repeatElement: 'q' },
    ]));
    expect(out).toContain("a: unknown type 'video'");
    expect(out).toContain('b: no type');
    expect(out).toContain("c: heading subtype 'big' renders nothing");
    expect(out).toContain("d: callout subtype 'fancy' renders nothing");
    expect(out.match(/no type/g)).toHaveLength(1);
  });
});
