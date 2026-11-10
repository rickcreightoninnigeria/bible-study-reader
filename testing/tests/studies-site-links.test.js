/**
 * Download links in the locale files (learningPathways_*, libraryShelvesStructure_*)
 * that point at the bsr-studies site must name a file the site really has.
 * The site's catalogue.json is read from the bsr-studies checkout next to this
 * repo (py/build_studies_site.py writes it there); without that checkout the
 * test is skipped.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(__dirname, '../../app/js/locales');
const CATALOGUE = join(__dirname, '../../../bsr-studies/catalogue.json');
const BASE = 'https://rickcreightoninnigeria.github.io/bsr-studies/';

function siteLinks() {
  const links = [];
  for (const lang of readdirSync(LOCALES)) {
    for (const f of readdirSync(join(LOCALES, lang))) {
      if (!/^(learningPathways|libraryShelvesStructure).*\.json$/.test(f)) continue;
      const text = readFileSync(join(LOCALES, lang, f), 'utf8');
      for (const m of text.matchAll(/"downloadLocation"\s*:\s*"([^"]*)"/g)) {
        if (m[1].startsWith(BASE)) links.push({ file: `${lang}/${f}`, path: m[1].slice(BASE.length) });
      }
    }
  }
  return links;
}

describe.skipIf(!existsSync(CATALOGUE))('studies site links', () => {
  it('every link names a study or bundle on the site', () => {
    const cat = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
    const files = new Set([...cat.studies, ...cat.bundles].map(x => x.file));
    const links = siteLinks();
    expect(links.length).toBeGreaterThan(0);
    expect(links.filter(l => !files.has(l.path))).toEqual([]);
  });

  it('the app defaults point at the site and its sample study', () => {
    const cat = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
    const about = JSON.parse(readFileSync(join(__dirname, '../../app/js/appAboutData_untranslated.json'), 'utf8'));
    expect(about.studiesSiteUrl).toBe(BASE);
    expect(cat.studies.map(s => s.file)).toContain(about.sampleStudyFile);
  });
});
