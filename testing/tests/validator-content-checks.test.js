/**
 * validate_study.py: keyTerms that look like regular expressions (and the limits
 * on entries), bibleTranslation1 in a single-translation study, and Leaders' Notes
 * chapter numbers, block keys and tables.
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

const study = (elements, { meta = {}, ...extra } = {}) => ({
  studyMetadata: { studyId: 't', studyVersion: 1, ...meta },
  chapters: [{ chapterNumber: 1, elements }],
  ...extra,
});
const question = keyTerms => [{ elementId: 'a', type: 'question', question: 'q', keyTerms }];
const passage = fields => [{ elementId: 'p', type: 'biblePassage', bibleRef: 'John 3:16', ...fields }];

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

describe.skipIf(!hasPython)('validate_study.py keyTerms checks', () => {
  it('accepts plain words, a trailing $, a leading * and alternatives', () => {
    const out = validate(study(question(['justif', 'sin$', '*kristo', 'God’s grace|favour', 'the Lord is king'])));
    expect(out).toContain('0 error(s), 0 warning(s)');
  });

  it('warns that regular-expression habits become plain phrases, and says which phrase', () => {
    const out = validate(study(question(['moses.*not able', 'grace\\s+alone', '[abc]x'])));
    expect(out.match(/looks like a regular expression/g)).toHaveLength(3);
    expect(out).toContain("only matches the phrase 'moses not able'");
    expect(out).toContain("'grace s alone'");
  });

  it('warns about more than 10 alternatives in one entry, and about one over 60 characters', () => {
    const many = Array.from({ length: 11 }, (_, i) => `w${i}`).join('|');
    const out = validate(study(question([many, 'x'.repeat(61)])));
    expect(out).toContain('has 11 alternatives; only the first 10 are used');
    expect(out).toContain('is over 60 characters and is cut short');
  });
});

describe.skipIf(!hasPython)('validate_study.py bibleTranslation1 check', () => {
  const meta = { bibleTranslation1: 'NET' };

  it('errors on an unnumbered passageText when bibleTranslation1 is set', () => {
    const out = validate(study(passage({ passageText: '<p>x</p>' }), { meta }));
    expect(out).toContain('studyMetadata.bibleTranslation1 is set');
    expect(out).toContain('1 error(s)');
  });

  it('accepts numbered passage text with bibleTranslation1, and unnumbered text without it', () => {
    expect(validate(study(passage({ passageText1: '<p>x</p>' }), { meta }))).toContain('0 error(s)');
    expect(validate(study(passage({ passageText: '<p>x</p>' })))).toContain('0 error(s)');
  });
});

describe.skipIf(!hasPython)("validate_study.py Leaders' Notes checks", () => {
  const leaders = (chapters, format) => study([], { leadersNotesData: { ...(format ? { format } : {}), chapters } });
  const block = body => ({ subtype: 'standard', body });

  it('errors on a chapterNumber that is not an integer (the chapter would get no tab)', () => {
    const out = validate(leaders([{ chapterNumber: '1', title: 't' }]));
    expect(out).toContain("Leaders' Notes chapterNumber '1' must be an integer");
  });

  it('warns about a block key ending in a digit; errors for it in a multilingual study', () => {
    const chapters = [{ chapterNumber: 2, block1: block('x') }];
    expect(validate(leaders(chapters))).toMatch(/warning Leaders' Notes 2: block key 'block1' ends in a digit/);
    const ml = validate(study([], { meta: { language1: 'en', language2: 'ha' }, leadersNotesData: { chapters } }));
    expect(ml).toMatch(/ERROR\s+Leaders' Notes 2: block key 'block1' ends in a digit \(a language slot/);
  });

  it('errors on a table in a markdown-format chapter, not in an HTML one', () => {
    const chapters = [{ chapterNumber: 3, blockA: block('<table></table>') }];
    expect(validate(leaders(chapters, 'markdown'))).toContain('table in a markdown-format chapter is stripped');
    expect(validate(leaders(chapters, 'HTML'))).toContain('0 error(s)');
  });

  it('accepts well-formed Leaders\' Notes', () => {
    const out = validate(leaders([{ chapterNumber: 1, title: 'One', blockA: block('x') }]));
    expect(out).toContain('0 error(s), 0 warning(s)');
  });
});
