/**
 * The shelf list (libraryShelvesStructure_*.json) and the validator's check of
 * a study's libraryShelves placements.
 *
 * The app shows sections and subsections in the order of this file, so the order
 * is the display order: Bible books must run in Bible order. Every translation
 * must have the same shape as the English file.
 *
 * Paths are relative to testing/tests/ — locale files are in ../../app/js/locales/
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(__dirname, '../../app/js/locales');
const SCRIPT = join(__dirname, '../../py/validate_study.py');
const load = lang => JSON.parse(readFileSync(join(LOCALES, lang, `libraryShelvesStructure_${lang}.json`), 'utf8'));
const langs = readdirSync(LOCALES);
const en = load('en');
const shelf = name => en.find(s => s.shelf === name);
const names = sec => sec.subsections.map(s => s.name);

const OT_BOOKS = ('Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|1 Samuel|2 Samuel|1 Kings|2 Kings|' +
  '1 Chronicles|2 Chronicles|Ezra|Nehemiah|Esther|Job|Psalms|Proverbs|Ecclesiastes|Song of Songs|Isaiah|Jeremiah|' +
  'Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi').split('|');
const NT_BOOKS = ('Matthew|Mark|Luke|John|Acts|Romans|1 Corinthians|2 Corinthians|Galatians|Ephesians|Philippians|Colossians|' +
  '1 Thessalonians|2 Thessalonians|1 Timothy|2 Timothy|Titus|Philemon|Hebrews|James|1 Peter|2 Peter|1 John|2 John|3 John|' +
  'Jude|Revelation').split('|');
const GROUPS = ['Biblical Theology', 'Pastoral Epistles'];   // not books: whole-testament and multi-book groups

describe('display order in the English shelf list', () => {
  const books = name => shelf(name).sections.flatMap(names).filter(n => !GROUPS.includes(n));

  it('lists the Old Testament books in Bible order, in sections Law, History, Poetry & Wisdom, Prophets', () => {
    expect(books('Old Testament')).toEqual(OT_BOOKS);
    expect(shelf('Old Testament').sections.map(s => s.section)).toEqual(['Overview', 'Law', 'History', 'Poetry & Wisdom', 'Prophets']);
  });

  it('lists the New Testament books in Bible order', () => {
    expect(books('New Testament')).toEqual(NT_BOOKS);
    expect(shelf('New Testament').sections.map(s => s.section)).toEqual(['Overview', 'Gospels & Acts', "Paul's Letters", 'General Letters & Revelation']);
  });

  it('puts Overview first in both testaments, holding Biblical Theology', () => {
    for (const name of ['Old Testament', 'New Testament']) {
      const first = shelf(name).sections[0];
      expect(first.section).toBe('Overview');
      expect(names(first)).toEqual(['Biblical Theology']);
    }
  });

  it('puts the Pastoral Epistles group just before 1 Timothy', () => {
    const paul = shelf('New Testament').sections.find(s => s.section === "Paul's Letters");
    const n = names(paul);
    expect(n.indexOf('Pastoral Epistles')).toBe(n.indexOf('1 Timothy') - 1);
  });

  it('has the subsections that studies in this repo use', () => {
    const sub = (shelfName, section) => names(shelf(shelfName).sections.find(s => s.section === section));
    expect(sub('Beliefs', 'Salvation')).toContain('Sanctification');
    expect(sub('Beliefs', 'God')).toContain('Compassion & Mercy');
  });

  it('has no duplicate section or subsection names inside a shelf or section', () => {
    for (const sh of en) {
      const secs = sh.sections.map(s => s.section);
      expect(new Set(secs).size, sh.shelf).toBe(secs.length);
      for (const sec of sh.sections) expect(new Set(names(sec)).size, `${sh.shelf} > ${sec.section}`).toBe(names(sec).length);
    }
  });
});

describe('translated shelf lists', () => {
  const shape = j => j.map(s => [s.sections.length, s.sections.map(sec => (sec.subsections || []).length)]);
  for (const lang of langs.filter(l => l !== 'en')) {
    it(`${lang}: same shape as English, every name and description filled in`, () => {
      const j = load(lang);
      expect(shape(j)).toEqual(shape(en));
      for (const sh of j) {
        expect(sh.shelf.trim(), 'shelf').not.toBe('');
        for (const sec of sh.sections) {
          expect(sec.section.trim(), 'section').not.toBe('');
          expect(sec.description.trim(), `${sec.section} description`).not.toBe('');
          for (const sub of sec.subsections) {
            expect(sub.name.trim(), 'subsection').not.toBe('');
            expect(sub.description.trim(), `${sub.name} description`).not.toBe('');
          }
        }
      }
    });
  }
});

const hasPython = spawnSync('python3', ['--version']).status === 0;
function validate(libraryShelves) {
  const dir = mkdtempSync(join(tmpdir(), 'bsr-shelves-'));
  try {
    const file = join(dir, 'study.json');
    writeFileSync(file, JSON.stringify({
      studyMetadata: { studyId: 't', studyVersion: 1.01, libraryShelves },
      chapters: [{ chapterNumber: 1, elements: [{ elementId: 'a', type: 'text', format: 'HTML', text: 'x' }] }],
    }));
    return spawnSync('python3', ['-I', SCRIPT, file], { encoding: 'utf8' }).stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!hasPython)('validate_study.py libraryShelves check', () => {
  it('accepts names from the shelf list, as an array or one object', () => {
    expect(validate([
      { Shelf: 'Old Testament', Section: 'Overview', Subsection: 'Biblical Theology' },
      { Shelf: 'Beliefs', Section: 'Salvation', Subsection: 'Sanctification' },
    ])).toContain('0 error(s), 0 warning(s)');
    expect(validate({ Shelf: 'New Testament', Section: "Paul's Letters", Subsection: 'Pastoral Epistles' }))
      .toContain('0 error(s), 0 warning(s)');
    expect(validate({ Shelf: 'Other' })).toContain('0 warning(s)');
  });

  it('is silent when the study has no libraryShelves', () => {
    expect(validate(undefined)).toContain('0 error(s), 0 warning(s)');
  });

  it('warns about an unknown shelf, section and subsection, and suggests the nearest name', () => {
    const out = validate([
      { Shelf: 'Old Testment', Section: 'Law', Subsection: 'Genesis' },
      { Shelf: 'Beliefs', Section: 'Salvaton', Subsection: 'Conversion' },
      { Shelf: 'Beliefs', Section: 'Salvation', Subsection: 'Conversions' },
    ]);
    expect(out).toContain("libraryShelves[0]: Shelf 'Old Testment' is not in libraryShelvesStructure_en.json");
    expect(out).toContain("did you mean 'Old Testament'?");
    expect(out).toContain("libraryShelves[1]: Section 'Salvaton' is not in the 'Beliefs' shelf");
    expect(out).toContain("did you mean 'Salvation'?");
    expect(out).toContain("libraryShelves[2]: Subsection 'Conversions' is not in 'Beliefs' > 'Salvation'");
    expect(out).toContain("did you mean 'Conversion'?");
  });

  it('warns about a placement with no Shelf, and a Subsection with no Section', () => {
    const out = validate([{ Section: 'Law' }, { Shelf: 'Old Testament', Subsection: 'Genesis' }]);
    expect(out).toContain('libraryShelves[0]: no Shelf, so this placement is ignored');
    expect(out).toContain("libraryShelves[1]: Subsection 'Genesis' has no Section");
  });
});
