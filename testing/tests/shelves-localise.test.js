/**
 * A study's libraryShelves names are English; the Shelves tab is built from the
 * list for the interface language. localiseShelfPlacement() swaps each English
 * name for the translated name at the same position (render-library.js).
 *
 * The two helpers are cut out of the library file and run in a vm sandbox.
 *
 * Paths are relative to testing/tests/ — sources are in ../../app/js/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(__dirname, '../../app/js/locales');
const src = readFileSync(join(__dirname, '../../app/js/render-library.js'), 'utf8');
const a = src.indexOf('// ── SHELF PLACEMENT NAMES'), b = src.indexOf('async function renderLibrary()');
if (a < 0 || b < a) throw new Error('could not find the shelf placement helpers in render-library.js');
const ctx = vm.createContext({});
vm.runInContext(src.slice(a, b), ctx);
const { localiseShelfPlacement, localisedOtherShelfName } = ctx;

const load = lang => JSON.parse(readFileSync(join(LOCALES, lang, `libraryShelvesStructure_${lang}.json`), 'utf8'));
const langs = readdirSync(LOCALES).filter(l => l !== 'en');
const en = load('en');
const clone = o => JSON.parse(JSON.stringify(o));   // helpers run in another realm; compare plain objects

describe('localiseShelfPlacement', () => {
  const ha = load('ha');

  it('swaps English names for the translated ones at the same position', () => {
    const p = clone(localiseShelfPlacement({ Shelf: 'Old Testament', Section: 'Law', Subsection: 'Genesis' }, ha, en));
    expect(p.Shelf).toBe(ha[0].shelf);
    expect(p.Section).toBe(ha[0].sections[1].section);       // Overview is now first, so Law is index 1
    expect(p.Subsection).toBe(ha[0].sections[1].subsections[0].name);
    expect(p.Shelf).not.toBe('Old Testament');
  });

  it('maps the new Overview > Biblical Theology placement', () => {
    const p = clone(localiseShelfPlacement({ Shelf: 'New Testament', Section: 'Overview', Subsection: 'Biblical Theology' }, ha, en));
    expect(p).toEqual({ Shelf: ha[1].shelf, Section: ha[1].sections[0].section, Subsection: ha[1].sections[0].subsections[0].name });
  });

  it('leaves English as it is', () => {
    expect(clone(localiseShelfPlacement({ Shelf: 'Beliefs', Section: 'Salvation', Subsection: 'Conversion' }, en, en)))
      .toEqual({ Shelf: 'Beliefs', Section: 'Salvation', Subsection: 'Conversion' });
  });

  it('keeps names that are not in the English list, translating what it can', () => {
    expect(clone(localiseShelfPlacement({ Shelf: 'Christian Living', Section: 'x', Subsection: 'y' }, ha, en)))
      .toEqual({ Shelf: 'Christian Living', Section: 'x', Subsection: 'y' });
    const p = clone(localiseShelfPlacement({ Shelf: 'Beliefs', Section: 'Made Up', Subsection: 'Odd' }, ha, en));
    expect(p).toEqual({ Shelf: ha[2].shelf, Section: 'Made Up', Subsection: 'Odd' });
    const q = clone(localiseShelfPlacement({ Shelf: 'Beliefs', Section: 'Salvation', Subsection: 'Odd' }, ha, en));
    expect(q).toEqual({ Shelf: ha[2].shelf, Section: ha[2].sections[6].section, Subsection: 'Odd' });
  });

  it('keeps names that are already translated', () => {
    const p = { Shelf: ha[0].shelf, Section: ha[0].sections[1].section, Subsection: '' };
    expect(clone(localiseShelfPlacement(p, ha, en))).toEqual(p);
  });

  it('handles a shelf with no section, and names with stray spaces', () => {
    expect(clone(localiseShelfPlacement({ Shelf: 'Old Testament' }, ha, en)))
      .toEqual({ Shelf: ha[0].shelf, Section: '', Subsection: '' });
    expect(clone(localiseShelfPlacement({ Shelf: ' Old Testament ', Section: 'Law ' }, ha, en)).Shelf).toBe(ha[0].shelf);
  });

  for (const lang of langs) {
    it(`${lang}: every English placement maps to a name in that language's own list`, () => {
      const loc = load(lang);
      en.forEach((sh, i) => sh.sections.forEach((sec, j) => (sec.subsections || []).forEach((sub, k) => {
        const p = clone(localiseShelfPlacement({ Shelf: sh.shelf, Section: sec.section, Subsection: sub.name }, loc, en));
        expect(p).toEqual({ Shelf: loc[i].shelf, Section: loc[i].sections[j].section, Subsection: loc[i].sections[j].subsections[k].name });
      })));
    });
  }
});

describe('localisedOtherShelfName', () => {
  it('is Other in English and the translated name elsewhere', () => {
    expect(localisedOtherShelfName(en, en)).toBe('Other');
    const ha = load('ha');
    expect(localisedOtherShelfName(ha, en)).toBe(ha[ha.length - 1].shelf);
  });

  it('falls back to Other when the list has no such shelf', () => {
    expect(localisedOtherShelfName([], [])).toBe('Other');
  });
});

describe('names in the translated lists', () => {
  const words = s => s.trim().split(/\s+/);
  // Repeated on purpose: Igbo "dị iche iche" ("various"), Fulfulde "Jimol Jimol" ("Song of Songs").
  const ALLOWED = ['Ozi Omenala Dị Iche Iche', 'Jimol Jimol'];
  for (const lang of langs) {
    it(`${lang}: Old and New Testament are named differently, and no name repeats a word`, () => {
      const j = load(lang);
      expect(j[0].shelf.trim()).not.toBe(j[1].shelf.trim());
      const all = j.flatMap(sh => [sh.shelf, ...sh.sections.flatMap(sec => [sec.section, ...sec.subsections.map(s => s.name)])]);
      for (const n of all.filter(x => !ALLOWED.includes(x.trim()))) {
        const w = words(n);
        for (let i = 1; i < w.length; i++) expect(w[i] === w[i - 1], `"${n}" repeats a word`).toBe(false);
      }
    });
  }
});
