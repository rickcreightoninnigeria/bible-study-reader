// ── DIAGNOSTICS ───────────────────────────────────────────────────────────────
// The Diagnostics tab of Settings: what this app, device and storage look like,
// what is installed, and the recent errors. Meant for the moment a student says
// "it doesn't work": they open the tab, tap "Copy report", and paste it into a
// message, so the author can see versions, device, storage, installed studies
// and the last errors without having the phone in hand.
//
//   collectDiagnostics()        gather everything into one object; never throws
//                               (each section reports its own error instead)
//   formatDiagnosticsReport()   that object as plain English text, for copying
//   renderDiagnosticsHtml()     that object as the page body (all text escaped)
//   renderDiagnosticsInto(id)   gather, render and wire the buttons
//
// The report holds no answers, notes or other personal data: study ids and
// versions, device and browser details, storage sizes and error messages only.
//
// Read-only on purpose. It never changes or deletes anything (a repair action is
// a separate decision).
//
// Depends at run time on: StudyIDB (idb.js), getErrorLog/formatErrorDetails/_erCopy
// (error-report.js), escapeHtml (utils.js), t() and appSettings.

const DIAG_VERSION_KEY_PREFIX = 'bsr_studyver_';   // same key study-loader.js writes

// ── Gathering ────────────────────────────────────────────────────────────────

// A section that failed to gather says why instead of breaking the whole page.
async function _diagSafe(fn) {
  try { return await fn(); } catch (e) { return { error: String((e && e.message) || e) }; }
}

function _diagParse(re, text) {
  const m = re.exec(text || '');
  return m ? m[1] : '';
}

function _diagApp() {
  const about = window.appAboutData || {};
  return {
    version:       about.appVersion || '',
    fileFormat:    about.estudyVersion || '',
    uiLanguage:    window.appLocale || '',
    interfaceMode: (typeof getInterfaceMode === 'function') ? getInterfaceMode() : '',
    activeStudy:   window.activeStudyId || '',
  };
}

function _diagDevice() {
  const ua = navigator.userAgent || '';
  let dark = false, online = true;
  try { dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) { /* ignore */ }
  try { online = navigator.onLine !== false; } catch (e) { /* ignore */ }
  return {
    userAgent:  ua,
    chrome:     _diagParse(/Chrome\/([\d.]+)/, ua),
    android:    _diagParse(/Android ([\d.]+)/, ua),
    platform:   navigator.platform || '',
    languages:  (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']).join(', '),
    screen:     `${screen.width}x${screen.height}`,
    viewport:   `${innerWidth}x${innerHeight}`,
    pixelRatio: window.devicePixelRatio || 1,
    darkScheme: dark,
    online,
  };
}

// What this device can do. A feature that is missing here is a likely reason
// for something that works on other phones but not this one. `optional`
// features have a fallback or only enable an extra (a desktop browser has no
// share sheet), so a "No" is shown plainly and does not count as a problem.
async function _diagFeatures() {
  const test = fn => { try { return !!fn(); } catch (e) { return false; } };
  const f = [];
  f.push({ key: 'idb',       ok: test(() => typeof indexedDB !== 'undefined' && indexedDB) });
  // A real read, not just "the object exists": catches a blocked or broken database.
  let probe = false;
  try { await StudyIDB.get('__diagnostics_probe__'); probe = true; } catch (e) { probe = false; }
  f.push({ key: 'idbProbe',  ok: probe });
  f.push({ key: 'ls',        ok: test(() => { localStorage.setItem('__diag__', '1'); localStorage.removeItem('__diag__'); return true; }) });
  f.push({ key: 'unicode',   optional: true, ok: test(() => new RegExp('\\p{L}', 'u')) });
  f.push({ key: 'segmenter', optional: true, ok: test(() => typeof Intl.Segmenter === 'function') });
  f.push({ key: 'clipboard', optional: true, ok: test(() => navigator.clipboard && navigator.clipboard.writeText) });
  f.push({ key: 'speech',    optional: true, ok: test(() => 'speechSynthesis' in window) });
  f.push({ key: 'share',     optional: true, ok: test(() => typeof navigator.share === 'function') });
  f.push({ key: 'libs',      ok: test(() => typeof JSZip !== 'undefined' && typeof DOMPurify !== 'undefined'
                                       && typeof markdownit !== 'undefined' && typeof Swal !== 'undefined') });
  return f;
}

async function _diagStorage() {
  const out = { usage: null, quota: null, persisted: null };
  if (navigator.storage && navigator.storage.estimate) {
    const est = await navigator.storage.estimate();
    out.usage = est.usage ?? null;
    out.quota = est.quota ?? null;
  }
  if (navigator.storage && navigator.storage.persisted) {
    out.persisted = await navigator.storage.persisted();
  }
  return out;
}

// Installed studies, read from the registry and the saved content, with the
// problems that can make an update misbehave:
//   no_content        registered, but the saved study is missing
//   version_mismatch  the version record differs from the saved study's own version
//   no_record         saved, but no version record (harmless)
// Also the version records left behind by deleted studies, which make the
// app refuse an older file of the same study.
async function _diagStudies() {
  let registry = [];
  try { registry = JSON.parse(localStorage.getItem('study_registry') || '[]'); } catch (e) { registry = []; }
  if (!Array.isArray(registry)) registry = [];

  const recordFor = id => parseFloat(localStorage.getItem(DIAG_VERSION_KEY_PREFIX + id)) || 0;
  const studies = [];
  for (const id of registry) {
    const row = { id, title: '', recorded: recordFor(id), contentVersion: 0, fileFormat: '', chapters: 0, issues: [] };
    try {
      const data = await StudyIDB.get(`study_content_${id}`);
      if (!data) {
        row.issues.push('no_content');
      } else {
        const m = data.studyMetadata || {};
        row.title          = m.title || m.title1 || '';
        row.contentVersion = parseFloat(m.studyVersion) || 0;
        row.fileFormat     = m.estudyFileVersion !== undefined ? String(m.estudyFileVersion) : '';
        row.chapters       = Array.isArray(data.chapters) ? data.chapters.length : 0;
        if (!row.recorded)                              row.issues.push('no_record');
        else if (row.recorded !== row.contentVersion)   row.issues.push('version_mismatch');
      }
    } catch (e) {
      row.issues.push('unreadable');
      row.error = String((e && e.message) || e);
    }
    studies.push(row);
  }

  const orphans = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i) || '';
    if (!key.startsWith(DIAG_VERSION_KEY_PREFIX)) continue;
    const id = key.slice(DIAG_VERSION_KEY_PREFIX.length);
    if (!registry.includes(id)) orphans.push({ id, recorded: recordFor(id) });
  }
  return { studies, orphans };
}

async function collectDiagnostics() {
  return {
    generatedAt: new Date().toISOString(),
    app:      await _diagSafe(_diagApp),
    device:   await _diagSafe(_diagDevice),
    features: await _diagSafe(_diagFeatures),
    storage:  await _diagSafe(_diagStorage),
    studies:  await _diagSafe(_diagStudies),
    errors:   await _diagSafe(() => getErrorLog().slice().reverse()),
  };
}

// How many things deserve a look: unsupported features, study problems, errors.
function diagnosticsProblemCount(info) {
  let n = 0;
  if (Array.isArray(info.features)) n += info.features.filter(f => !f.ok && !f.optional).length;
  if (info.studies && Array.isArray(info.studies.studies)) {
    n += info.studies.studies.filter(s => s.issues.some(i => i !== 'no_record')).length;
  }
  if (Array.isArray(info.errors)) n += info.errors.length ? 1 : 0;
  return n;
}

// ── Formatting ───────────────────────────────────────────────────────────────

function _diagMb(bytes) {
  return bytes === null || bytes === undefined ? '' : `${(bytes / 1048576).toFixed(1)} MB`;
}

const _DIAG_FEATURE_NAMES = {
  idb: 'IndexedDB', idbProbe: 'IndexedDB working', ls: 'Local storage', unicode: 'Unicode text matching',
  segmenter: 'Intl.Segmenter', clipboard: 'Clipboard', speech: 'Speech synthesis', share: 'Share sheet', libs: 'Built-in libraries',
};

// Plain-text report, always in English so the author can read any student's.
function formatDiagnosticsReport(info) {
  const L = [];
  const section = (title, rows) => { L.push('', `== ${title} ==`, ...rows); };
  const err = x => (x && x.error ? [`(could not gather: ${x.error})`] : null);

  L.push('Bible Study Reader diagnostics', `Generated: ${info.generatedAt}`);

  const a = info.app;
  section('App', err(a) || [
    `Version: ${a.version || 'unknown'}`, `Study file format: ${a.fileFormat || 'unknown'}`,
    `App language: ${a.uiLanguage || 'unknown'}`, `Interface mode: ${a.interfaceMode || 'unknown'}`,
    `Open study: ${a.activeStudy || 'none'}`,
  ]);

  const d = info.device;
  section('Device', err(d) || [
    `Browser: ${d.userAgent}`, `Chrome/WebView: ${d.chrome || 'unknown'}`, `Android: ${d.android || 'n/a'}`,
    `Platform: ${d.platform}`, `Languages: ${d.languages}`, `Screen: ${d.screen}  Viewport: ${d.viewport}  Pixel ratio: ${d.pixelRatio}`,
    `Dark mode: ${d.darkScheme ? 'yes' : 'no'}  Online: ${d.online ? 'yes' : 'no'}`,
  ]);

  section('Supported features', err(info.features) || info.features.map(f => `${f.ok ? 'yes' : (f.optional ? 'no ' : 'NO ')}  ${_DIAG_FEATURE_NAMES[f.key] || f.key}${f.optional ? ' (optional)' : ''}`));

  const s = info.storage;
  section('Storage', err(s) || [
    `Used: ${_diagMb(s.usage) || 'unknown'}`, `Available to the app: ${_diagMb(s.quota) || 'unknown'}`,
    `Protected from clean-up: ${s.persisted === null ? 'unknown' : (s.persisted ? 'yes' : 'no')}`,
  ]);

  const st = info.studies;
  if (st && st.error) {
    section('Installed studies', [`(could not gather: ${st.error})`]);
  } else {
    section('Installed studies', st.studies.length ? st.studies.map(r =>
      `${r.id}${r.title ? ` "${r.title}"` : ''} | saved v${r.contentVersion || '?'} | record v${r.recorded || 'none'} | ` +
      `format ${r.fileFormat || '?'} | ${r.chapters} chapters` + (r.issues.length ? ` | ISSUES: ${r.issues.join(', ')}` : '')) : ['none']);
    if (st.orphans.length) {
      section('Deleted studies that still remember a version', st.orphans.map(o => `${o.id} | v${o.recorded}`));
    }
  }

  const e = info.errors;
  section('Recent errors (newest first)', e && e.error ? [`(could not gather: ${e.error})`]
    : (e.length ? e.slice(0, 5).map(x => formatErrorDetails(x)).join('\n\n--\n\n').split('\n') : ['none recorded']));
  if (Array.isArray(e) && e.length > 5) {
    L.push('', `Older errors: ${e.slice(5).map(x => `${x.time} ${x.context || ''} ${x.message}`).join(' || ')}`);
  }
  return L.join('\n');
}

// ── Rendering ────────────────────────────────────────────────────────────────

function _dRow(label, value, cls = '') {
  return `<div class="diag-row"><div class="diag-label">${escapeHtml(label)}</div>` +
         `<div class="diag-value ${cls}">${escapeHtml(value)}</div></div>`;
}

function _dSection(titleKey, inner) {
  return `<div class="settings-block diag-block"><div class="settings-row-label">${escapeHtml(t(titleKey))}</div>${inner}</div>`;
}

function _dFailed(x) {
  return x && x.error ? `<div class="diag-bad">${escapeHtml(x.error)}</div>` : null;
}

function renderDiagnosticsHtml(info) {
  const yes = t('diag_yes'), no = t('diag_no'), unknown = t('diag_unknown');
  const parts = [];

  const problems = diagnosticsProblemCount(info);
  parts.push(`<div class="diag-summary ${problems ? 'warn' : 'ok'}">${escapeHtml(
    problems ? t('diag_summary_problems', { count: problems }) : t('diag_summary_ok'))}</div>`);

  const a = info.app;
  parts.push(_dSection('diag_h_app', _dFailed(a) || [
    _dRow(t('diag_app_version'), a.version || unknown),
    _dRow(t('diag_file_format'), a.fileFormat || unknown),
    _dRow(t('diag_ui_language'), a.uiLanguage || unknown),
    _dRow(t('diag_interface_mode'), a.interfaceMode || unknown),
    _dRow(t('diag_active_study'), a.activeStudy || t('diag_none')),
  ].join('')));

  const d = info.device;
  parts.push(_dSection('diag_h_device', _dFailed(d) || [
    _dRow(t('diag_chrome'), d.chrome || unknown),
    _dRow(t('diag_android'), d.android || t('diag_na')),
    _dRow(t('diag_screen'), `${d.screen} (${d.viewport})`),
    _dRow(t('diag_dark'), d.darkScheme ? yes : no),
    _dRow(t('diag_online'), d.online ? yes : no),
    _dRow(t('diag_ua'), d.userAgent),
  ].join('')));

  parts.push(_dSection('diag_h_features', _dFailed(info.features) || info.features.map(f =>
    _dRow(t('diag_f_' + f.key), f.ok ? yes : no, f.ok ? 'diag-ok' : (f.optional ? '' : 'diag-bad'))).join('')));

  const s = info.storage;
  parts.push(_dSection('diag_h_storage', _dFailed(s) || [
    _dRow(t('diag_storage_used'), _diagMb(s.usage) || unknown),
    _dRow(t('diag_storage_quota'), _diagMb(s.quota) || unknown),
    _dRow(t('diag_storage_persist'), s.persisted === null ? unknown : (s.persisted ? yes : no)),
  ].join('')));

  const st = info.studies;
  if (st && st.error) {
    parts.push(_dSection('diag_h_studies', _dFailed(st)));
  } else {
    const rows = st.studies.length ? st.studies.map(r => {
      const issues = r.issues.filter(i => i !== 'no_record').map(i =>
        `<div class="diag-bad">${escapeHtml(t('diag_issue_' + i, { recorded: r.recorded, content: r.contentVersion }))}</div>`).join('');
      return `<div class="diag-study"><div class="diag-study-title">${escapeHtml(r.title || r.id)}</div>` +
        _dRow(t('diag_study_id'), r.id) +
        _dRow(t('diag_study_saved'), r.contentVersion ? `v${r.contentVersion}` : unknown) +
        _dRow(t('diag_study_record'), r.recorded ? `v${r.recorded}` : t('diag_none')) +
        _dRow(t('diag_study_chapters'), String(r.chapters)) + issues + '</div>';
    }).join('') : `<div class="settings-row-desc">${escapeHtml(t('diag_no_studies'))}</div>`;
    parts.push(_dSection('diag_h_studies', rows));
    if (st.orphans.length) {
      parts.push(_dSection('diag_h_orphans',
        `<div class="settings-row-desc">${escapeHtml(t('diag_orphans_intro'))}</div>` +
        st.orphans.map(o => _dRow(o.id, `v${o.recorded}`)).join('')));
    }
  }

  const e = info.errors;
  if (e && e.error) {
    parts.push(_dSection('diag_h_errors', _dFailed(e)));
  } else {
    const list = e.length ? e.map(x => `<details class="diag-error"><summary>${escapeHtml(
        `${(x.time || '').replace('T', ' ').slice(0, 19)} · ${x.context || ''} · ${x.message}`)}</summary>` +
        `<pre class="diag-pre">${escapeHtml(formatErrorDetails(x))}</pre></details>`).join('')
      : `<div class="settings-row-desc">${escapeHtml(t('diag_no_errors'))}</div>`;
    parts.push(_dSection('diag_h_errors', list));
  }

  parts.push(`<div class="diag-actions">
    <button class="error-report-btn primary" id="diagCopyBtn" type="button" onclick="copyDiagnosticsReport(this)">${escapeHtml(t('diag_copy'))}</button>
    <button class="error-report-btn" type="button" onclick="renderDiagnosticsInto('diagnosticsBody')">${escapeHtml(t('diag_refresh'))}</button>
    ${Array.isArray(e) && e.length ? `<button class="error-report-btn" type="button" onclick="clearDiagnosticsErrors()">${escapeHtml(t('diag_clear_errors'))}</button>` : ''}
  </div>`);
  return parts.join('');
}

// ── Page wiring ──────────────────────────────────────────────────────────────

let _diagLastReport = '';

async function renderDiagnosticsInto(elementId) {
  const host = document.getElementById(elementId);
  if (!host) return;
  host.textContent = t('diag_loading');
  const info = await collectDiagnostics();
  _diagLastReport = formatDiagnosticsReport(info);
  // Page may have been left while gathering.
  const still = document.getElementById(elementId);
  if (still) still.innerHTML = renderDiagnosticsHtml(info);
}

async function copyDiagnosticsReport(btn) {
  const ok = await _erCopy(_diagLastReport);
  if (btn) btn.textContent = ok ? t('diag_copied') : t('errorreport_copy_failed');
}

function clearDiagnosticsErrors() {
  clearErrorLog();
  renderDiagnosticsInto('diagnosticsBody');
}
