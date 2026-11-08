/**
 * test_answers.py: the answer-check test harness (lint, generated weak answers, briefing, run).
 * Runs the real script, with the real answer-match.js, on a small temporary study; skipped if
 * python3 or node is absent.
 *
 * Paths are relative to testing/tests/ — the script is ../../py/test_answers.py
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../../py/test_answers.py');
const which = cmd => spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).stdout.trim();
const PYTHON = which('python3');
const hasTools = !!PYTHON && !!which('node');

const PASSAGE = '<p><sup>1</sup>In the beginning God created the heavens and the earth.</p>' +
  '<p><sup>2</sup>Now the earth was without shape and empty, and darkness was over the surface of the watery deep.</p>';

function question(over = {}) {
  return {
    elementId: 'q1', type: 'question', question: 'What does the passage tell us about the earth at the very start?',
    linkedPassage: 'Genesis 1:1–2', keyTerms: ['created|made', 'shape|form', 'dark|gloom', 'empty|void'],
    sampleAnswer: 'God made everything, yet at first nothing had its proper form: the world was empty and dark everywhere across the deep.',
    mainPoint: 'God **made** it, but at first it had no form and was dark and empty.',
    questionHintFirst: 'Look at verse 2.', questionHint: 'Think about what was missing.', ...over,
  };
}
function study(qs = [question()], meta = {}) {
  return {
    studyMetadata: { studyId: 't', studyVersion: 1, language: 'en', ...meta },
    chapters: [{ chapterNumber: 1, elements: [
      { elementId: 'p', type: 'biblePassage', bibleRef: 'Genesis 1:1–2', passageText: PASSAGE }, ...qs] }],
  };
}

const STRONG = [
  ['S1', 'model', 'At the very start God made the world, but it had no real form and it was empty and dark.'],
  ['S2', 'formal', 'Initially the creation was formless, vacant and shrouded in darkness, though God had brought it into being.'],
  ['S3', 'casual', 'Basically God made it all but it was a bit of a mess, empty and pitch dark with no proper form.'],
  ['S4', 'textspeak', 'god made it but it was empty & dark, no form yet'],
  ['S5', 'concise', 'God made it, but it was empty and dark.'],
  ['S6', 'long', 'What strikes me is that God made everything yet the earth began in a strange way, with no form at all, completely empty and covered in a deep darkness that I find hard to picture.'],
  ['S7', 'simpleEnglish', 'God make the earth. But it has no form. It is empty and dark in the beginning.'],
  ['S8', 'synonyms', 'The planet had been produced by the Almighty, yet it was shapeless, vacant and gloomy at first.'],
  ['S9', 'otherAngle', 'The striking thing is that nothing was ready: the world God made had no form, only emptiness and gloom.'],
  ['S10', 'notes', '- God made it\n- no form yet\n- empty\n- dark'],
  ['S11', 'quoteComment', 'The text says "without shape and empty" and then "darkness", though God had made it.'],
  ['S12', 'hugging', 'God made it, but it was empty, with no shape and dark.'],
  ['S13', 'typos', 'God maed the erth but it had no form, it was emty and dak.'],
];
const WEAK = [
  ['W1', 'passageReword', 'In the beginning God made the heavens and the earth. Now the earth was without form and empty, and darkness lay over the surface of the watery deep.'],
  ['W2', 'offTopic', 'I think this chapter shows why we should always rest on Sundays and give our money to the church every week without complaining.'],
  ['W3', 'halfRight', 'The passage says that it was dark at the beginning of the story of the world.'],
  ['W4', 'misguided', 'The passage shows that the earth was always here, perfectly ordered and bright, with nobody responsible for it at all.'],
];
function answers(over = {}, meta = {}) {
  return {
    meta: { studyId: 't', studyVersion: 1, protocol: 'blind', ...meta },
    questions: { q1: {
      strong: STRONG.map(([id, style, text]) => ({ id, style, text })),
      weak: WEAK.map(([id, kind, text]) => ({ id, kind, text })), ...over } },
  };
}

const made = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

function run(args, { study: s = study(), ans, script = SCRIPT, files = {}, env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bsr-testans-')); made.push(dir);
  writeFileSync(join(dir, 'study.json'), JSON.stringify(s));
  if (ans) writeFileSync(join(dir, 'answers.json'), typeof ans === 'string' ? ans : JSON.stringify(ans));
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), JSON.stringify(c));
  const a = args.map(x => x.replace('{dir}', dir));
  const r = spawnSync(PYTHON, ['-I', script, join(dir, 'study.json'), ...a], { encoding: 'utf8', env: { ...process.env, ...env } });
  const read = n => (existsSync(join(dir, n)) ? readFileSync(join(dir, n), 'utf8') : '');
  return { out: r.stdout, err: r.stderr, status: r.status, report: read('r.md'), json: read('r.json') ? JSON.parse(read('r.json')) : null, dir, read };
}
const RUN = ['--run', '{dir}/answers.json', '--report', '{dir}/r.md', '--json', '{dir}/r.json'];

describe.skipIf(!hasTools)('test_answers.py --run', () => {
  it('passes a complete, sound answer set and reports by style and by kind', () => {
    const r = run(RUN, { ans: answers() });
    expect(r.status, r.err + r.out).toBe(0);
    expect(r.report).toContain('1 PASS, 0 not passed');
    expect(r.report).toContain('| typos | diagnostic |');
    expect(r.report).toContain('| keySaladFresh (generated) | B |');
  });

  it('includes the generated weak answers for every tested question', () => {
    const r = run(RUN, { ans: answers() });
    const auto = r.json.answers.filter(a => a.auto).map(a => a.label);
    expect(auto).toEqual(expect.arrayContaining(['filler', 'fragment', 'echoQuestion', 'passageCopy', 'keySalad', 'keySaladFresh']));
    expect(r.json.answers.filter(a => a.label === 'passageCopy' && a.auto)[0].code).toBe('repeatsPassage');
  });

  it('marks a question INCOMPLETE when a required style is missing, unless --allow-incomplete', () => {
    const a = answers(); a.questions.q1.strong = a.questions.q1.strong.filter(x => x.style !== 'typos');
    const r = run(RUN, { ans: a });
    expect(r.status).toBe(1);
    expect(r.report).toContain('INCOMPLETE');
    expect(r.report).toContain('Missing from the answers file:** typos');
    const ok = run([...RUN, '--allow-incomplete'], { ans: a });
    expect(ok.status).toBe(0);
    expect(ok.report).toContain('--allow-incomplete');
  });

  it('does not let one strong answer and no weak answers pass', () => {
    const a = answers({ strong: [{ id: 'S1', style: 'model', text: STRONG[0][2] }], weak: [] });
    const r = run(RUN, { ans: a });
    expect(r.status).toBe(1);
    expect(r.report).toContain('INCOMPLETE');
  });

  it('fails a question whose core answer is not rated strong', () => {
    const a = answers(); a.questions.q1.strong[0].text = 'God did something at the very start of everything that we read about here.';
    const r = run(RUN, { ans: a });
    expect(r.status).toBe(1);
    expect(r.report).toContain('Core answers not rated "strong"');
  });

  it('rejects labels that do not fit the answer (a reword labelled as a copy) with exit 2', () => {
    const a = answers(); a.questions.q1.weak.push({ id: 'W5', kind: 'passageCopy', text: 'Something quite different about worship songs and harvest suppers.' });
    const r = run(RUN, { ans: a });
    expect(r.status).toBe(2);
    expect(r.report).toContain('PROBLEMS WITH THE ANSWERS FILE');
    expect(r.report).toContain('labelled a passage copy');
  });

  it('rejects an unknown strong style, a duplicated style and an empty answer with exit 2', () => {
    const a = answers(); a.questions.q1.strong.push({ id: 'S14', style: 'madeUp', text: 'God made it.' }, { id: 'S15', style: 'model', text: '' });
    const r = run(RUN, { ans: a });
    expect(r.status).toBe(2);
    expect(r.report).toContain("unknown strong style 'madeUp'");
    expect(r.report).toContain("strong style 'model' appears 2 times");
    expect(r.report).toContain('empty answer text');
  });

  it('refuses answers written for a different study (exit 2) and warns about a different version', () => {
    expect(run(RUN, { ans: answers({}, { studyId: 'other' }) }).status).toBe(2);
    expect(run([...RUN, '--ignore-meta'], { ans: answers({}, { studyId: 'other' }) }).status).toBe(0);
    const r = run(RUN, { ans: answers({}, { studyVersion: 0.9 }) });
    expect(r.report).toContain('written for studyVersion 0.9');
  });

  it('uses exit code 2, on stderr, when the files cannot be read', () => {
    const r = run(RUN, { ans: '{ not json' });
    expect(r.status).toBe(2);
    expect(r.err).toContain('ERROR cannot read');
  });

  it('uses exit code 2 when answer-match.js cannot be found', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bsr-lone-'));
    try {
      copyFileSync(SCRIPT, join(dir, 'test_answers.py'));
      const r = run(['--auto'], { script: join(dir, 'test_answers.py'), env: { ANSWER_MATCH_JS: '' } });
      expect(r.status).toBe(2);
      expect(r.err).toContain('answer-match.js not found');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('compares with an earlier run and fails when an answer got worse', () => {
    const first = run(RUN, { ans: answers() });
    expect(first.status).toBe(0);
    const worse = study([question({ keyTerms: ['zzz|yyy', 'xxx|www', 'shape|form', 'vvv|uuu'] })]);
    const r = run([...RUN, '--compare', '{dir}/prev.json'], { study: worse, ans: answers(), files: { 'prev.json': first.json } });
    expect(r.report).toContain('Answers that behave **worse** than before');
    expect(r.report).toMatch(/→ \*\*(partial|offTopic)\*\*/);
    expect(r.status).toBe(1);
  });

  it('flags a strong answer that passes with the bare minimum of key terms as fragile', () => {
    const r = run(RUN, { ans: answers() });
    expect(r.report).toContain('Fragile passes');
    expect(r.report).toContain('only 2 of 4 key terms (the minimum)');
  });
});

describe.skipIf(!hasTools)('test_answers.py --auto', () => {
  it('runs generated weak answers for every question with no answers file, exit 0 when all are caught', () => {
    const r = run(['--auto', '--report', '{dir}/r.md', '--json', '{dir}/r.json']);
    expect(r.status, r.err + r.out).toBe(0);
    expect(r.json.answers.map(a => a.label)).toEqual(expect.arrayContaining(['filler', 'fragment', 'echoQuestion', 'passageCopy']));
    expect(r.json.answers.every(a => a.auto)).toBe(true);
  });

  it('shows how far the key terms can be gamed: a padded salad of key words reaches "strong"', () => {
    const r = run(['--auto', '--json', '{dir}/r.json']);
    const salad = r.json.answers.filter(a => a.label === 'keySaladFresh')[0];
    expect(salad.code).toBe('strong');
  });

  it('tests questions the app checks that the older harness skipped: no linkedPassage, or a reflection with one', () => {
    const s = study([question({ elementId: 'q2', linkedPassage: undefined }),
      question({ elementId: 'q3', subtype: 'reflection' }), question({ elementId: 'q4', subtype: 'reflection', linkedPassage: undefined })]);
    const r = run(['--auto', '--json', '{dir}/r.json'], { study: s });
    const ids = new Set(r.json.answers.map(a => a.question));
    expect([...ids].sort()).toEqual(['q2', 'q3']);   // q4 is a reflection with no linkedPassage: no check in the app
  });

  it('reads skipBibleVerseCheck the way the app does: only true or "true" skips the check', () => {
    const has = v => run(['--auto', '--json', '{dir}/r.json'], { study: study([question({ skipBibleVerseCheck: v })]) })
      .json.answers.some(a => a.label === 'passageCopy');
    expect(has('false')).toBe(true);
    expect(has(false)).toBe(true);
    expect(has(true)).toBe(false);
    expect(has('true')).toBe(false);
  });
});

describe.skipIf(!hasTools)('test_answers.py --lint', () => {
  const lintOf = keyTerms => run(['--lint'], { study: study([question({ keyTerms })]) }).out;

  it('says love will not match loving, from the real matcher, and offers the form', () => {
    const out = lintOf(['love|hate', 'created|made', 'shape|form', 'dark']);
    expect(out).toContain('`love|hate` does not match “hating”, “loving”');
    expect(out).toContain('add `hating`, `loving`');
  });

  it('does not invent forms that the matcher already covers, or non-words', () => {
    const out = lintOf(['confess|conquer|dwell', 'created|made', 'shape|form', 'dark']);
    expect(out).not.toMatch(/confesing|conqueing|dweling/);
    expect(out).not.toMatch(/\[form\]/);
  });

  it('catches belief, testified and irregular forms that a list of -e verbs would miss', () => {
    const out = lintOf(['believe', 'testify', 'teach', 'dark']);
    expect(out).toContain('“belief”');
    expect(out).toContain('“testified”');
    expect(out).toContain('“taught”');
  });

  it('flags 3-letter prefixes and stopword alternatives, but not whole-word ones', () => {
    const out = lintOf(['sin', 'god', 'dark$', 'created|made']);
    expect(out).toMatch(/\[shortStem\] `sin`/);
    expect(out).toMatch(/\[generic\] alternative `god`/);
    expect(out).not.toMatch(/\[(shortStem|generic)\][^\n]*dark\$/);
  });
});

describe.skipIf(!hasTools)('test_answers.py --brief', () => {
  it('keeps the reference answer, hints and key terms out of the writer\'s briefing', () => {
    const r = run(['--brief', '{dir}/out']);
    const brief = r.read('out/brief.md'), ref = r.read('out/reference.md'), skel = JSON.parse(r.read('out/answers_skeleton.json'));
    expect(brief).toContain('What does the passage tell us');
    expect(brief).not.toContain('proper form');            // the sample answer
    expect(brief).not.toContain('Look at verse 2');        // the first hint
    expect(brief).not.toContain('created|made');           // the key terms
    expect(ref).toContain('proper form');
    expect(ref).toContain('created|made');
    expect(ref).toContain('Do NOT give this file');
    expect(skel.meta.protocol).toBe('blind');
    expect(skel.questions.q1.strong).toHaveLength(13);
    expect(skel.questions.q1.weak).toHaveLength(4);
  });

  it('with --with-reference shows the reference answer and records the run as semi-blind', () => {
    const r = run(['--brief', '{dir}/out', '--with-reference']);
    expect(r.read('out/brief.md')).toContain('proper form');
    expect(JSON.parse(r.read('out/answers_skeleton.json')).meta.protocol).toBe('semi-blind');
  });
});
