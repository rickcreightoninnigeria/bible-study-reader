/**
 * Structural invariants of the Love & Wisdom study file.
 *
 * The study is "All rights reserved" and is not kept in git. This test reads it
 * from testing/local-fixtures/love_wisdom_study.json (git-ignored) and skips
 * itself when that file is absent, so it only runs on a machine that has it.
 *
 * Each check is something the app depends on, not a content opinion.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '../local-fixtures/love_wisdom_study.json');
const has = existsSync(FIXTURE);
const study = has ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : null;

const GD_RESERVED = new Set(['chapterNumber', 'backToStudy', 'format', 'title', 'footnotes']);
const strings = (o, out = []) => {
  if (typeof o === 'string') out.push(o);
  else if (Array.isArray(o)) o.forEach(v => strings(v, out));
  else if (o && typeof o === 'object') Object.values(o).forEach(v => strings(v, out));
  return out;
};

describe.skipIf(!has)('Love & Wisdom study file', () => {
  const gd = has ? study.goDeeperData.chapters : [];
  const elementsOf = ch => ch.elements || [];

  it('studyId uses only letters, digits, underscore and hyphen', () => {
    expect(study.studyMetadata.studyId).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('every elementId is unique across the study', () => {
    const ids = study.chapters.flatMap(ch => elementsOf(ch).map(e => e.elementId));
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every linkedPassage equals an earlier bibleRef in the same chapter, character for character', () => {
    for (const ch of study.chapters) {
      const seen = new Set();
      for (const e of elementsOf(ch)) {
        if (e.type === 'biblePassage') seen.add(e.bibleRef);
        if (e.linkedPassage) expect(seen.has(e.linkedPassage), `${e.elementId}: ${e.linkedPassage}`).toBe(true);
      }
    }
  });

  it('each Go Deeper chapter\'s [[fn:N]] markers are exactly its footnote ids, and the ids run 1..N', () => {
    for (const ch of gd) {
      const ids = (ch.footnotes || []).map(f => f.id);
      expect(ids, `chapter ${ch.chapterNumber}`).toEqual(ids.map((_, i) => i + 1));
      const text = strings({ ...ch, footnotes: undefined }).join('\n');
      const used = [...new Set([...text.matchAll(/\[\[fn:(\d+)\]\]/g)].map(m => +m[1]))].sort((a, b) => a - b);
      expect(used, `chapter ${ch.chapterNumber}`).toEqual(ids);
    }
  });

  it('no Go Deeper block key ends in a digit (the app would read it as a language slot)', () => {
    for (const ch of gd) {
      for (const key of Object.keys(ch).filter(k => !GD_RESERVED.has(k))) {
        expect(key, `chapter ${ch.chapterNumber}`).not.toMatch(/\d$/);
      }
    }
  });

  it('every study chapter has a Go Deeper chapter with the same number', () => {
    const have = new Set(gd.map(c => c.chapterNumber));
    for (const ch of study.chapters) expect(have.has(ch.chapterNumber), `chapter ${ch.chapterNumber}`).toBe(true);
  });

  it('Go Deeper chapter numbers and study chapter numbers are integers', () => {
    for (const c of [...gd, ...study.chapters]) expect(Number.isInteger(c.chapterNumber)).toBe(true);
  });

  it('table rows are all the same width once colspan is counted', () => {
    let tables = 0;
    for (const body of strings(gd)) {
      for (const m of body.matchAll(/<table\b[\s\S]*?<\/table>/g)) {
        tables++;
        const widths = [...m[0].matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map(r =>
          [...r[0].matchAll(/<t[hd]\b([^>]*)>/g)].reduce((n, c) => n + (+(/colspan="(\d+)"/.exec(c[1]) || [0, 1])[1]), 0));
        expect(new Set(widths).size, `widths ${widths}`).toBe(1);
      }
    }
    expect(tables).toBeGreaterThan(0);
  });
});
