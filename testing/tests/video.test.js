/**
 * app/js/video.js (the video card: watch online, link and play a copy on the
 * phone, download on Wi-Fi) and the `video` checks in validate_study.py.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../app/js/video.js'), 'utf8');

function load({ android = null, store = {} } = {}) {
  const storage = { ...store };
  const calls = { toasts: [], opened: [], picks: [], fires: [] };
  const sb = {
    console, JSON, Number, String, Math, Date, Map, Object, Array, URL,
    localStorage: { getItem: k => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
    safeSetItem: (k, v) => { storage[k] = String(v); },
    t: (k, vars) => (vars ? `${k}:${Object.values(vars).join(',')}` : k),
    escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    showToast: o => calls.toasts.push(o.message),
    Swal: { fire: async o => { calls.fires.push(o); return { isConfirmed: true }; } },
    navigator: { onLine: true },
    document: { querySelectorAll: () => [] },
    window: { open: url => calls.opened.push(url) },
  };
  if (android) sb.window.Android = android;
  vm.createContext(sb);
  vm.runInContext(SRC, sb, { filename: 'video.js' });
  return { sb, storage, calls };
}

const V = { title: 'Overview: Genesis', url: 'https://www.youtube.com/watch?v=abc', minutes: 7, source: 'BibleProject', fileName: 'Genesis.mp4', downloadUrl: 'https://bibleproject.com/g.mp4' };
const buttons = html => [...html.matchAll(/onclick="(\w+)\(this\)"/g)].map(m => m[1]);

describe('the video card', () => {
  it('estimates the data from the length unless the author gives a size', () => {
    const { sb } = load();
    expect(sb.videoEstimateMB({ minutes: 7 })).toBe(56);
    expect(sb.videoEstimateMB({ minutes: 7, sizeMB: 40 })).toBe(40);
    expect(sb.videoEstimateMB({})).toBe(0);
  });

  it('in a browser: watch online, play a copy from the device, download', () => {
    const { sb } = load();
    const html = sb.buildVideoCardHtml(V);
    expect(buttons(html)).toEqual(['videoWatchOnline', 'videoPlayFromDevice', 'videoDownload']);
    expect(html).toContain('video_size_stream:56');
    expect(html).toContain('video_look_for:Genesis.mp4');
  });

  it('on Android before linking: watch online, link a copy, download', () => {
    const { sb } = load({ android: { pickVideoFile() {}, playVideoFile() { return true; } } });
    expect(buttons(sb.buildVideoCardHtml(V))).toEqual(['videoWatchOnline', 'videoLinkFile', 'videoDownload']);
  });

  it('on Android once linked: play from the phone first, and the link works in any study with that url', () => {
    const store = { bsr_video_files: JSON.stringify({ [V.url]: { uri: 'content://x/1', name: 'Genesis.mp4' } }) };
    const { sb } = load({ android: { pickVideoFile() {}, playVideoFile() { return true; } }, store });
    const html = sb.buildVideoCardHtml(V);
    expect(buttons(html)).toEqual(['videoPlayLinked', 'videoWatchOnline', 'videoLinkFile', 'videoDownload']);
    expect(html).toContain('video_change_file_btn');
    expect(html).toContain('video_linked:Genesis.mp4');
  });

  it('ignores addresses that are not https, and draws nothing with nothing to play', () => {
    const { sb } = load();
    const html = sb.buildVideoCardHtml({ title: 'x', url: 'javascript:alert(1)', minutes: 3 });
    expect(html).toBe('');
    expect(sb.buildVideoCardHtml({ title: 'x', url: 'http://example.com/v' })).toBe('');
  });

  it('remembers a picked file for that video url', () => {
    const android = { pickVideoFile: id => calls.picks.push(id), playVideoFile() { return true; } };
    const { sb, storage, calls } = load({ android });
    const card = { dataset: { url: V.url, title: V.title }, closest: () => card };
    sb.videoLinkFile(card);
    expect(calls.picks).toHaveLength(1);
    sb.onVideoFilePicked(calls.picks[0], 'content://x/2', 'Gen.mp4');
    expect(JSON.parse(storage.bsr_video_files)[V.url]).toMatchObject({ uri: 'content://x/2', name: 'Gen.mp4' });
    sb.onVideoFilePicked('unknown-request', 'content://x/3', 'other.mp4');   // ignored
    expect(Object.keys(JSON.parse(storage.bsr_video_files))).toEqual([V.url]);
  });

  it('forgets a link whose file has gone, and offers to link it again', async () => {
    const store = { bsr_video_files: JSON.stringify({ [V.url]: { uri: 'content://gone', name: 'x' } }) };
    const { sb, storage, calls } = load({ android: { pickVideoFile() {}, playVideoFile: () => false }, store });
    const card = { dataset: { url: V.url, title: V.title }, closest: () => card, replaceWith() {} };
    sb.document = { querySelectorAll: () => [], createElement: () => ({ set innerHTML(_) {}, firstElementChild: null }) };
    await sb.videoPlayLinked(card);
    expect(calls.fires[0].title).toBe('video_missing_title');
    expect(JSON.parse(storage.bsr_video_files)[V.url]).toBeUndefined();
  });

  it('explains the data cost before the first online viewing, then just opens the video', async () => {
    const { sb, calls } = load();
    const card = { dataset: { url: V.url, mb: '56' }, closest: () => card };
    await sb.videoWatchOnline(card);
    await sb.videoWatchOnline(card);
    expect(calls.fires.map(f => f.title)).toEqual(['video_data_title']);
    expect(calls.opened).toEqual([V.url, V.url]);
  });

  it('does not try to open a video when offline', async () => {
    const { sb, calls } = load();
    sb.navigator.onLine = false;
    const card = { dataset: { url: V.url }, closest: () => card };
    await sb.videoWatchOnline(card);
    expect(calls.toasts).toEqual(['video_offline']);
    expect(calls.opened).toEqual([]);
  });
});

const PY = ['python3', 'python'].find(p => spawnSync(p, ['--version']).status === 0);

describe.skipIf(!PY)('validate_study.py video checks', () => {
  function validate(study) {
    const dir = mkdtempSync(join(tmpdir(), 'bsr-video-'));
    const f = join(dir, 'study.json');
    writeFileSync(f, JSON.stringify(study));
    const r = spawnSync(PY, [join(__dirname, '../../py/validate_study.py'), f], { encoding: 'utf8' });
    return r.stdout + r.stderr;
  }
  const base = (els, gd) => ({
    studyMetadata: { studyId: 'v_test', studyVersion: '1.00', title: 'T' },
    chapters: [{ chapterNumber: 1, chapterTitle: 'One', elements: els }],
    ...(gd ? { goDeeperData: { chapters: [{ chapterNumber: 1, ...gd }] } } : {}),
  });

  it('accepts a complete video', () => {
    const out = validate(base([{ type: 'video', elementId: 'v1', title: 'T', url: 'https://youtu.be/abc', minutes: 6, fileName: 'T.mp4', downloadUrl: 'https://bibleproject.com/t.mp4' }]));
    expect(out).not.toMatch(/v1:/);
  });

  it('reports a bad address, a missing length and a missing title', () => {
    const out = validate(base([
      { type: 'video', elementId: 'v1', url: 'http://youtube.com/x', minutes: 6 },
      { type: 'video', elementId: 'v2', title: 'T', url: 'https://youtu.be/x' },
      { type: 'video', elementId: 'v3', title: 'T' },
    ]));
    expect(out).toContain('v1: url must be an https:// address');
    expect(out).toContain('v1: video has no title');
    expect(out).toContain('v2: video has no minutes');
    expect(out).toContain('v3: video needs a url');
  });

  it('checks video blocks in Go Deeper, and warns about unusual sites', () => {
    const out = validate(base([], { watch: { subtype: 'video', title: 'T', url: 'https://example.org/v', minutes: 4 } }));
    expect(out).toContain('Go Deeper chapter 1, watch: url is on example.org');
  });
});
