/**
 * validate_study.py: the answer-check test (each sampleAnswer and mainPoint run through
 * the app's own answer-match.js), the --explain detail, the questionHintFirst checks, and
 * the errors when answer-match.js or Node.js is missing.
 * Runs the real script on small temporary studies; skipped if python3 or node is absent.
 *
 * Paths are relative to testing/tests/ — the script is ../../py/validate_study.py
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../../py/validate_study.py');
const ANSWER_MATCH = join(__dirname, '../../app/js/answer-match.js');
const which = cmd => spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).stdout.trim();
const PYTHON = which('python3');
const hasTools = !!PYTHON && !!which('node');

const PASSAGE = '<p><sup>1</sup>In the beginning God created the heavens and the earth.</p>' +
  '<p><sup>2</sup>Now the earth was without shape and empty, and darkness was over the surface of the watery deep.</p>';

function study(question, { meta = {}, passage = PASSAGE } = {}) {
  return {
    studyMetadata: { studyId: 't', studyVersion: 1, ...meta },
    chapters: [{
      chapterNumber: 1,
      elements: [
        { elementId: 'p', type: 'biblePassage', bibleRef: 'Genesis 1:1–2', passageText: passage },
        { elementId: 'q', type: 'question', question: 'What does the passage say about the earth at the start?',
          linkedPassage: 'Genesis 1:1–2', ...question },
      ],
    }],
  };
}

function run(obj, { args = [], env = {}, script = SCRIPT } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bsr-answer-'));
  try {
    const file = join(dir, 'study.json');
    writeFileSync(file, JSON.stringify(obj));
    const r = spawnSync(PYTHON, ['-I', script, ...args, file], { encoding: 'utf8', env: { ...process.env, ...env } });
    return { out: r.stdout, status: r.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const GOOD = {
  keyTerms: ['created|made', 'shape|form', 'darkness|dark'],
  sampleAnswer: 'God made everything, yet at first nothing had its proper form, and it was dark everywhere across the deep.',
};

describe.skipIf(!hasTools)('validate_study.py answer-check test', () => {
  it('is silent when the sample answer and main point reach "strong"', () => {
    const { out } = run(study({ ...GOOD, mainPoint: 'God **made** it, but it had no form and was dark.' }));
    expect(out).toContain('0 error(s), 0 warning(s)');
  });

  it('warns when a sample answer repeats the passage, and says so in --explain with the words it lacks', () => {
    const copy = 'In the beginning God created the heavens and the earth, and the earth was without shape and empty.';
    const { out } = run(study({ ...GOOD, sampleAnswer: copy }), { args: ['--explain'] });
    expect(out).toMatch(/chapter 1, q: sampleAnswer is flagged as repeating the passage/);
    expect(out).toMatch(/q: sampleAnswer: repeatsPassage; keyTerms \d of 3 \(needs 2\); repeats the passage \d+% \(limit 70%\)/);
  });

  it('warns on a "partial" result, with how many key terms matched', () => {
    const { out } = run(study({
      keyTerms: ['created', 'shape', 'darkness', 'surface'],
      sampleAnswer: 'God made the world, and in his hands everything began and was ordered from nothing at all.',
    }));
    expect(out).toMatch(/sampleAnswer matches too few of its keyTerms.*\(0 of 4 keyTerms\)|matches none of its keyTerms \(0 of 4/);
  });

  it('warns that a main point under the minimum length is "too short"', () => {
    const { out } = run(study({ ...GOOD, mainPoint: 'God made it.' }));
    expect(out).toMatch(/mainPoint is too short for the answer check/);
  });

  it('does not run the passage check when skipBibleVerseCheck is true', () => {
    const copy = 'In the beginning God created the heavens and the earth, and the earth was without shape and empty.';
    const { out } = run(study({ ...GOOD, sampleAnswer: copy, skipBibleVerseCheck: true }));
    expect(out).not.toContain('repeating the passage');
  });

  it('reads [[sc:Lord]] as the word, as the app does (it is not a stray "sc" word that counts as original)', () => {
    const passage = '<p><sup>1</sup>The Lord is my shepherd, I lack nothing at all.</p>';
    const { out } = run(study({ keyTerms: ['shepherd'], sampleAnswer: '[[sc:Lord]] [[sc:Lord]] shepherd lack' }, { passage }));
    expect(out).toContain('repeating the passage');
  });

  it('drops a verse number stuck to a word in the passage, as the app does ("2Everything" is the word "everything")', () => {
    const passage = '<p><sup>1</sup>God made the earth.</p><p>2Everything was empty and dark.</p>';
    const { out } = run(study({ keyTerms: ['earth'], sampleAnswer: 'everything everything everything made' }, { passage }));
    expect(out).toContain('repeating the passage');
  });

  it('decodes entities in an answer, as a reader would see them (&amp; is "and", not a stray "amp" word)', () => {
    const passage = '<p><sup>1</sup>Mercy and truth have met together, righteousness and peace have kissed.</p>';
    const { out } = run(study({ keyTerms: ['mercy'], sampleAnswer: 'mercy &amp; truth &amp; righteousness &amp; peace &amp; mercy' }, { passage }));
    expect(out).toContain('repeating the passage');
  });

  it('only tests questions that have an answer to test, and is silent about everything else', () => {
    const { out } = run(study({}));
    expect(out).toContain('0 error(s), 0 warning(s)');
    expect(out).not.toContain('Answer-check detail');
  });

  it('--explain prints a line for each text; without it the output has no detail block', () => {
    const q = { ...GOOD, mainPoint: 'God **made** it, but it had no form and was dark.' };
    const withFlag = run(study(q), { args: ['--explain'] }).out;
    expect(withFlag).toContain('Answer-check detail (sampleAnswer and mainPoint, as the app would judge them):');
    expect(withFlag).toMatch(/q: sampleAnswer: strong; keyTerms 3 of 3 \(needs 2\); repeats the passage \d+% \(limit 70%\); \d+ words \(minimum 6\)/);
    expect(withFlag).toMatch(/q: mainPoint: strong/);
    expect(run(study(q)).out).not.toContain('Answer-check detail');
  });

  it('says the check covers the first language only in a multilingual study', () => {
    const q = { keyTerms1: ['created|made', 'shape', 'dark'], sampleAnswer1: GOOD.sampleAnswer, question1: 'Q?' };
    const obj = study(q, { meta: { language1: 'en', language2: 'ha' } });
    obj.chapters[0].elements[0] = { elementId: 'p', type: 'biblePassage', bibleRef1: 'Genesis 1:1–2', passageText1: PASSAGE };
    obj.chapters[0].elements[1].linkedPassage = 'Genesis 1:1–2';
    const { out } = run(obj, { args: ['--explain'] });
    expect(out).toContain('(first language only):');
  });
});

describe.skipIf(!hasTools)('validate_study.py: answer-match.js or Node.js missing', () => {
  const alone = () => {
    const dir = mkdtempSync(join(tmpdir(), 'bsr-alone-'));
    copyFileSync(SCRIPT, join(dir, 'validate_study.py'));
    return dir;
  };

  it('errors (exit status 1) when answer-match.js cannot be found, and does not look in the current folder', () => {
    const dir = alone();
    try {
      copyFileSync(ANSWER_MATCH, join(dir, 'answer-match.js.not-here'));   // not the right name: must not be found
      const r = spawnSync(PYTHON, ['-I', join(dir, 'validate_study.py'), (() => {
        const f = join(dir, 's.json'); writeFileSync(f, JSON.stringify(study(GOOD))); return f;
      })()], { encoding: 'utf8', cwd: dir, env: { ...process.env, ANSWER_MATCH_JS: '' } });
      expect(r.stdout).toMatch(/ERROR\s+answer-check test cannot run: answer-match\.js not found/);
      expect(r.status).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('finds answer-match.js next to the script (as in a Project Context folder)', () => {
    const dir = alone();
    try {
      copyFileSync(ANSWER_MATCH, join(dir, 'answer-match.js'));
      const f = join(dir, 's.json'); writeFileSync(f, JSON.stringify(study(GOOD)));
      const r = spawnSync(PYTHON, ['-I', join(dir, 'validate_study.py'), f], { encoding: 'utf8', env: { ...process.env, ANSWER_MATCH_JS: '' } });
      expect(r.stdout).toContain('0 error(s), 0 warning(s)');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('honours ANSWER_MATCH_JS', () => {
    const dir = alone();
    try {
      const f = join(dir, 's.json'); writeFileSync(f, JSON.stringify(study(GOOD)));
      const r = spawnSync(PYTHON, ['-I', join(dir, 'validate_study.py'), f], { encoding: 'utf8', env: { ...process.env, ANSWER_MATCH_JS: ANSWER_MATCH } });
      expect(r.stdout).toContain('0 error(s), 0 warning(s)');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('errors when Node.js is not available', () => {
    const { out, status } = run(study(GOOD), { env: { PATH: '/nonexistent' } });
    expect(out).toMatch(/ERROR\s+answer-check test cannot run: Node\.js not found/);
    expect(status).toBe(1);
  });

  it('a study with nothing to test needs neither', () => {
    const { out, status } = run(study({}), { env: { PATH: '/nonexistent' } });
    expect(out).toContain('0 error(s), 0 warning(s)');
    expect(status).toBe(0);
  });
});

describe.skipIf(!PYTHON)('validate_study.py questionHintFirst checks', () => {
  it('warns (not an error) when questionHintFirst is not a string: it is ignored, so there is no first hint', () => {
    const { out } = run(study({ questionHint: 'H', questionHintFirst: ['x'], ...{} }));
    expect(out).toMatch(/warning chapter 1, q: questionHintFirst must be a string; anything else is ignored/);
    expect(out).toContain('0 error(s)');
  });

  it('warns when the first hint is the same as the hint', () => {
    const { out } = run(study({ questionHint: 'Look at verse 2.', questionHintFirst: ' Look at verse 2. ' }));
    expect(out).toContain('questionHintFirst is identical to questionHint');
  });

  it('accepts two different hints', () => {
    const { out } = run(study({ questionHint: 'Verse 2 gives three descriptions.', questionHintFirst: 'Start with verse 2.' }));
    expect(out).not.toContain('questionHintFirst');
  });
});
