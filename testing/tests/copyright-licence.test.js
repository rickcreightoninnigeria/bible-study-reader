/**
 * The copyright page shows the study's own licence text when copyrightData
 * supplies licenceText, and the app's CC BY-SA 4.0 text otherwise.
 *
 * _copyrightLicenceParas() is cut out of render-pages.js and run in a sandbox;
 * the page wiring is checked by reading the source (the page itself needs a DOM).
 * The validator part runs the real script on small temporary studies.
 *
 * Paths are relative to testing/tests/ — source is in ../../app/ and ../../py/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../../app/js/render-pages.js'), 'utf8');
const a = src.indexOf('function _copyrightLicenceParas(d)');
const sb = vm.createContext({});
vm.runInContext(src.slice(a, src.indexOf('\n}\n', a) + 3), sb);
const paras = d => sb._copyrightLicenceParas(d);

describe('_copyrightLicenceParas', () => {
  it('takes a string as one paragraph and an array as several', () => {
    expect(paras({ licenceText: 'All rights reserved.' })).toEqual(['All rights reserved.']);
    expect(paras({ licenceText: ['One.', 'Two.'] })).toEqual(['One.', 'Two.']);
  });

  it('ignores empty, blank and non-string values, so the default CC BY-SA text returns', () => {
    for (const bad of [undefined, null, '', '   ', [], ['', '  '], 5, true, {}, [1, null]]) {
      expect(paras({ licenceText: bad }), JSON.stringify(bad)).toEqual([]);
    }
    expect(paras(undefined)).toEqual([]);
    expect(paras({})).toEqual([]);
  });

  it('keeps the good paragraphs when some are bad', () => {
    expect(paras({ licenceText: ['Good.', '', 7, 'Also good.'] })).toEqual(['Good.', 'Also good.']);
  });

  it('ignores the old, never-read licence field', () => {
    expect(paras({ licence: 'CC BY-NC' })).toEqual([]);
  });
});

describe('the copyright page', () => {
  const from = src.indexOf("} else if (activeTab === 'copyright') {");
  const page = src.slice(from, src.indexOf('content.innerHTML = `\n    <div class="howto-page">', from));

  it('shows the CC BY-SA blocks only when there is no custom licence text', () => {
    expect(page).toContain('const licenceParas = _copyrightLicenceParas(d);');
    // the badge and licence link sit inside the "no custom text" branch
    expect(page).toMatch(/licenceParas\.length \? '' : `[\s\S]*?cc-badge[\s\S]*?`;/);
    expect(page).toMatch(/licenceParas\.length\s*\? `<div class="copyright-block">\$\{licenceParas\.map\(x => `<p>\$\{x\}<\/p>`\)/);
    expect(page.match(/cc-badge/g)).toHaveLength(1);
  });

  it('still shows the author line and the notices either way', () => {
    expect(page).toContain('${d.authorLine}');
    expect(page).toContain('${noticesHtml');
  });
});

describe('validate_study.py and copyrightData', () => {
  const hasPython = spawnSync('python3', ['--version']).status === 0;
  const study = copyrightData => ({
    studyMetadata: { studyId: 't', studyVersion: 1.01 },
    chapters: [{ chapterNumber: 1, elements: [] }],
    copyrightData,
  });
  const run = obj => {
    const dir = mkdtempSync(join(tmpdir(), 'bsr-validate-'));
    try {
      const file = join(dir, 'study.json');
      writeFileSync(file, JSON.stringify(obj));
      return spawnSync('python3', ['-I', join(__dirname, '../../py/validate_study.py'), file], { encoding: 'utf8' }).stdout;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };

  it.skipIf(!hasPython)('accepts a string or an array of strings', () => {
    expect(run(study({ licenceText: 'Used with permission.' }))).not.toContain('licenceText');
    expect(run(study({ licenceText: ['A.', 'B.'] }))).not.toContain('licenceText');
  });

  it.skipIf(!hasPython)('errors on a licenceText of the wrong shape', () => {
    for (const bad of ['', '  ', [], [''], [1], 5, { a: 1 }]) {
      expect(run(study({ licenceText: bad })), JSON.stringify(bad)).toContain('licenceText must be a non-empty string');
    }
  });

  it.skipIf(!hasPython)('warns when "All rights reserved" has no licenceText, and not when it has', () => {
    const notices = ['All rights reserved. No part may be copied.'];
    expect(run(study({ notices }))).toContain('no licenceText');
    expect(run(study({ notices, licenceText: 'x' }))).not.toContain('no licenceText');
    expect(run(study({ notices: ['Some other notice.'] }))).not.toContain('no licenceText');
  });

  it.skipIf(!hasPython)('says the old licence field is ignored', () => {
    expect(run(study({ licence: 'x' }))).toContain('copyrightData.licence is ignored');
  });
});
