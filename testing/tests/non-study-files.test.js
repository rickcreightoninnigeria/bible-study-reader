/**
 * Opening a file that is not a study (a PDF sent by mistake, a photo, an empty
 * file) gives a plain explanation instead of "Unexpected token '%' ... is not
 * valid JSON" (study-loader.js, loadAnyFile).
 *
 * The check and the router are cut out of the loader and run in a vm sandbox
 * with stubs for the zip reader and the loaders they call.
 *
 * Paths are relative to testing/tests/ — source files are in ../../app/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS = join(__dirname, '../../app/js');
const src = readFileSync(join(JS, 'study-loader.js'), 'utf8');
const from = src.indexOf('function _notStudyFileMessageKey(');
const to = src.indexOf('// Distinguishes "the bundled-studies asset', from);
if (from < 0 || to < from) throw new Error('could not find loadAnyFile in study-loader.js');

const bytes = s => new TextEncoder().encode(s).buffer;

function makeLoader() {
  const calls = { pickerErrors: [], studyLoads: [], pathwayImports: [], reported: [] };
  const sandbox = {
    TextDecoder, Uint8Array, Math,
    t: key => key,
    JSZip: { loadAsync: async () => { throw new Error('not a zip'); } },   // none of these files is a zip
    showPickerError: m => calls.pickerErrors.push(m),
    looksLikePathwayFile: text => text.includes('"estudyPathwayFileVersion"'),
    importPathwaysFromText: async text => calls.pathwayImports.push(text),
    loadStudyFromFile: async f => calls.studyLoads.push(f),
    _reportLoadError: (e, name, ctx) => calls.reported.push([e.message, name, ctx]),
  };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(from, to), sandbox, { filename: 'loadAnyFile' });
  return { sandbox, calls };
}

const open = async (content) => {
  const { sandbox, calls } = makeLoader();
  const file = { name: 'incoming.estudy', arrayBuffer: async () => content };
  await sandbox.loadAnyFile(file);
  return calls;
};

describe('opening a file that is not a study', () => {
  it('says a PDF is a PDF, and loads nothing', async () => {
    const calls = await open(bytes('%PDF-1.7\n%âãÏÓ\n1 0 obj'));
    expect(calls.pickerErrors).toEqual(['studyloader_error_pdf']);
    expect(calls.studyLoads).toEqual([]);
    expect(calls.reported).toEqual([]);
  });

  it.each([
    ['a PNG', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).buffer],
    ['an empty file', new ArrayBuffer(0)],
    ['plain text', bytes('Theology 2, chapter 10')],
    ['a JSON array', bytes('[1, 2, 3]')],
  ])('gives the general message for %s', async (_name, content) => {
    const calls = await open(content);
    expect(calls.pickerErrors).toEqual(['studyloader_error_not_study']);
    expect(calls.studyLoads).toEqual([]);
  });

  it.each([
    ['plain JSON', '{"studyMetadata":{"studyId":"s"}}'],
    ['JSON after a BOM', '﻿{"studyMetadata":{}}'],
    ['JSON after blank lines', '\n\n  {"studyMetadata":{}}'],
  ])('still opens %s as a study', async (_name, text) => {
    const calls = await open(bytes(text));
    expect(calls.pickerErrors).toEqual([]);
    expect(calls.studyLoads).toHaveLength(1);
  });

  it('still hands a pathway file to the pathway importer', async () => {
    const calls = await open(bytes('{"estudyPathwayFileVersion":1}'));
    expect(calls.pickerErrors).toEqual([]);
    expect(calls.pathwayImports).toHaveLength(1);
    expect(calls.studyLoads).toEqual([]);
  });
});

describe('the two messages in every locale', () => {
  const LOCALES = join(JS, 'locales');
  for (const lang of readdirSync(LOCALES)) {
    it(`${lang}: has both, and they mention .estudy`, () => {
      const d = JSON.parse(readFileSync(join(LOCALES, lang, `ui_${lang}.json`), 'utf8'));
      for (const k of ['studyloader_error_pdf', 'studyloader_error_not_study']) {
        expect(typeof d[k] === 'string' && d[k].trim() !== '', `${k} missing`).toBe(true);
        expect(d[k]).toContain('.estudy');
      }
      expect(d.studyloader_error_pdf).toContain('PDF');
    });
  }
});
