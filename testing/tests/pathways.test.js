/**
 * Tests for built-in pathway IDs and active-pathway key conversion
 * (pathways-import.js + locales/{lang}/learningPathways_{lang}.json).
 *
 * The active pathway is stored as "builtin:{pathwayId}", so every language's
 * pathway file must carry the same permanent IDs. These tests catch a
 * translator or editor dropping or changing one before it reaches users, and
 * check that keys saved by older versions ("1_2", "builtin:1_2") convert to
 * the pathway they always meant, whatever the current order.
 *
 * Paths are relative to testing/tests/ — source files are in ../../app/js/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const LOCALES    = join(__dirname, '../../app/js/locales');
const ID_RE      = /^[A-Za-z0-9._-]{1,64}$/;

const readJson = p => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''));

// Every learningPathways_*.json under every locale folder (including drafts
// such as learningPathways_2_en.json).
const pathwayFiles = readdirSync(LOCALES).flatMap(lang =>
  readdirSync(join(LOCALES, lang))
    .filter(f => /^learningPathways_.*\.json$/.test(f))
    .map(f => join(lang, f)));

const idsIn = file => readJson(join(LOCALES, file)).learningPathways
  .flatMap(g => (g.pathways || []).map(p => p.pathwayId));

const englishIds = idsIn('en/learningPathways_en.json');

// Loads pathways-import.js into a sandbox with a fake localStorage.
function loadModule(stored, appAboutData) {
  const store = new Map(stored === undefined ? [] : [['bsr_activePathwayId', stored]]);
  const sandbox = {
    window: { appAboutData },
    console,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
  };
  sandbox.safeSetItem = (k, v) => sandbox.localStorage.setItem(k, v);
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(__dirname, '../../app/js/pathways-import.js'), 'utf8'), sandbox);
  return { sandbox, store };
}

describe('built-in pathway IDs in the locale files', () => {
  it('finds the pathway files', () => {
    expect(pathwayFiles.length).toBeGreaterThan(1);
  });

  it('English pathways all have valid, unique IDs', () => {
    expect(englishIds.every(id => typeof id === 'string' && ID_RE.test(id))).toBe(true);
    expect(new Set(englishIds).size).toBe(englishIds.length);
  });

  it.each(pathwayFiles)('%s has the same pathway IDs as English', file => {
    expect([...idsIn(file)].sort()).toEqual([...englishIds].sort());
  });
});

describe('legacy active-pathway key conversion', () => {
  const appAboutData = { learningPathways: readJson(join(LOCALES, 'en/learningPathways_en.json')) };

  it('every frozen legacy position maps to a current pathway ID', () => {
    const { sandbox } = loadModule(undefined, appAboutData);
    const table = vm.runInContext('LEGACY_BUILTIN_PATHWAY_IDS', sandbox);
    expect(Object.values(table).every(id => englishIds.includes(id))).toBe(true);
  });

  it.each([['0_2'], ['builtin:0_2']])('converts %s to builtin:deeper-understanding and saves it', raw => {
    const { sandbox, store } = loadModule(raw, appAboutData);
    expect(sandbox.getActivePathwayKey()).toBe('builtin:deeper-understanding');
    expect(store.get('bsr_activePathwayId')).toBe('builtin:deeper-understanding');
  });

  it('converts by the frozen table, not the current order', () => {
    // Simulate a future release that inserted a new pathway at the front of
    // the first group: position 0_2 now holds a different pathway.
    const future = JSON.parse(JSON.stringify(appAboutData));
    future.learningPathways.learningPathways[0].pathways.unshift({ pathwayId: 'brand-new', titleLevel2: 'New', studyTitles: [] });
    const { sandbox } = loadModule('0_2', future);
    expect(sandbox.getActivePathwayKey()).toBe('builtin:deeper-understanding');
  });

  it('leaves ID-based and imported keys unchanged', () => {
    for (const key of ['builtin:wisdom', 'imp:grace-ministry:new-believers']) {
      const { sandbox, store } = loadModule(key, appAboutData);
      expect(sandbox.getActivePathwayKey()).toBe(key);
      expect(store.get('bsr_activePathwayId')).toBe(key);
    }
  });

  it('keeps an unknown position as-is until it can be resolved', () => {
    const { sandbox, store } = loadModule('9_9', undefined);
    expect(sandbox.getActivePathwayKey()).toBe('builtin:9_9');
    expect(store.get('bsr_activePathwayId')).toBe('9_9');
  });
});
