/**
 * validate_study.py: [[sc:Text]] and <span class="divine-name"> checks.
 * Runs the real script on a small temporary study; skipped if python3 is absent.
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

const SPAN = '<span class="divine-name">Lord</span>';
const study = (elements, extra = {}) => ({
  studyMetadata: { studyId: 't', studyVersion: 1 },
  chapters: [{ chapterNumber: 1, elements }],
  ...extra,
});

function validate(obj) {
  const dir = mkdtempSync(join(tmpdir(), 'bsr-validate-'));
  try {
    const file = join(dir, 'study.json');
    writeFileSync(file, JSON.stringify(obj));
    return spawnSync('python3', ['-I', SCRIPT, file], { encoding: 'utf8' }).stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!hasPython)('validate_study.py marker checks', () => {
  it('accepts well-formed [[sc:…]] markers', () => {
    const out = validate(study([{ elementId: 'a', type: 'text', format: 'HTML',
      text: 'The [[sc:Lord]] reigns. [[sc:Lord of hosts]] [[sc:Yorùbá]] [[sc:God’s Name.]]' }]));
    expect(out).not.toContain('[[sc:');
    expect(out).toContain('0 error(s), 0 warning(s)');
  });

  it('warns on disallowed characters, a leading space, and over-long text', () => {
    const out = validate(study([{ elementId: 'a', type: 'text', format: 'HTML',
      text: `[[sc:Lord1]] [[sc:<b>]] [[sc: x]] [[sc:${'a'.repeat(61)}]]` }]));
    expect(out.match(/has disallowed characters/g)).toHaveLength(4);
  });

  it('warns about a divine-name span in a markdown element, mainPoint, and Go Deeper body', () => {
    const out = validate(study([
      { elementId: 'b', type: 'text', format: 'markdown', text: `The ${SPAN} reigns.` },
      { elementId: 'd', type: 'question', question: 'q', mainPoint: SPAN },
    ], { goDeeperData: { format: 'markdown', chapters: [
      { chapterNumber: 1, s: { subtype: 'standard', body: `x ${SPAN}` } },
    ] } }));
    expect(out).toContain('element b.text: <span class="divine-name">');
    expect(out).toContain('element d.mainPoint');
    expect(out).toContain('goDeeperData chapter 1');
  });

  it('does not warn about the span where it works (HTML fields, HTML Go Deeper chapters)', () => {
    const out = validate(study([
      { elementId: 'b', type: 'text', format: 'HTML', text: `The ${SPAN} reigns.` },
      { elementId: 'd', type: 'question', question: 'q', mainPoint: SPAN, mainPointFormat: 'HTML' },
    ], { goDeeperData: { format: 'markdown', chapters: [
      { chapterNumber: 1, format: 'HTML', s: { subtype: 'standard', body: `x ${SPAN}` } },
    ] } }));
    expect(out).not.toContain('divine-name');
  });
});

describe.skipIf(!hasPython)('validate_study.py studyVersion check', () => {
  const withVersion = (v) => ({ ...study([]), studyMetadata: { studyId: 't', studyVersion: v } });

  it.each([1, 1.03, 1.1, '1.10', '2'])('accepts %j', (v) => {
    expect(validate(withVersion(v))).not.toContain('studyVersion');
  });

  it.each(['v2', '1.', '1.2.3', '', true])('warns about %j', (v) => {
    expect(validate(withVersion(v))).toContain('studyVersion should be a decimal number');
  });

  it('warns about spaces around a string version', () => {
    expect(validate(withVersion(' 1.10 '))).toContain('studyVersion has spaces around it');
  });
});
