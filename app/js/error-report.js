// ── ERROR REPORTING ───────────────────────────────────────────────────────────
// Makes failures visible and easy to report. Before this file, an error that
// was not caught by one of the few try/catch blocks vanished: there was no
// global handler, so a student could see "it tried to load, then nothing".
//
// What it provides
//   • recordError / reportError   – keep the last few errors (in memory and in
//                                   localStorage) and optionally show them.
//   • showErrorDialog             – a dialog with plain-language text, a list
//                                   of lines (used for install summaries), and
//                                   a "Copy details" button so a student can
//                                   paste what went wrong into a message.
//   • global handlers             – window 'error' and 'unhandledrejection'
//                                   record every error and show a small,
//                                   dismissible banner with a Details button.
//   • getErrorLog / clearErrorLog – for a future Diagnostics page.
//
// Loaded FIRST in index.html, before every other script, so it can also report
// a script that fails to download or to parse. It therefore depends on nothing:
// strings come from t() only once the locale has loaded, with English defaults
// before that, and every piece of DOM is built with textContent, never
// innerHTML, so nothing from a study file or an error message can become markup.
//
// Never throws: a failure in the error reporter must not hide the real error.

const BSR_ERROR_LOG_KEY = 'bsr_error_log';
const BSR_ERROR_LOG_MAX = 20;       // entries kept
const BSR_ERROR_STACK_MAX = 800;    // characters of stack kept per entry

let _erLog = null;                  // lazily loaded copy of the stored log

// Text for the reporter itself. t() returns the KEY when a string is missing,
// and may not exist yet (early startup), so fall back to English defaults.
function _er(key, fallback, vars) {
  try {
    if (typeof t === 'function' && window.appStrings && window.appStrings[key] !== undefined) {
      return t(key, vars);
    }
  } catch (e) { /* fall through to the default */ }
  let s = fallback;
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

// ── The log ──────────────────────────────────────────────────────────────────

function getErrorLog() {
  if (_erLog) return _erLog;
  try {
    const parsed = JSON.parse(localStorage.getItem(BSR_ERROR_LOG_KEY) || '[]');
    _erLog = Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    _erLog = [];
  }
  return _erLog;
}

function _persistErrorLog() {
  try { localStorage.setItem(BSR_ERROR_LOG_KEY, JSON.stringify(getErrorLog())); } catch (e) { /* storage full or blocked */ }
}

function clearErrorLog() {
  _erLog = [];
  _persistErrorLog();
}

// Which study, version and language the reader was in when the error happened.
function _erContext() {
  const meta = window.studyMetadata || {};
  const about = window.appAboutData || {};
  return {
    appVersion:   about.appVersion || '',
    studyId:      window.activeStudyId || '',
    // window.studyMetadata still belongs to the previously loaded study while a
    // new one is being opened, so only trust it when the ids agree.
    studyVersion: meta.studyVersion !== undefined && meta.studyId === window.activeStudyId
      ? String(meta.studyVersion) : '',
    language:     window._activeStudyLang || '',
  };
}

// Turns anything that was thrown (Error, string, event, null) into an entry.
// `ctx` names where it happened: { context, chapter, elementId, file, ... }.
function recordError(err, ctx = {}) {
  let name = 'Error', message = '', stack = '';
  if (err && typeof err === 'object') {
    name    = String(err.name || 'Error');
    message = String(err.message !== undefined ? err.message : err);
    stack   = String(err.stack || '');
  } else {
    message = String(err);
  }
  const base = _erContext();
  // The loaded study's metadata describes the study that was open BEFORE the
  // one this error is about, so drop its version when ctx names another study.
  if (ctx.studyId && ctx.studyId !== base.studyId) base.studyVersion = '';
  const entry = {
    time:    new Date().toISOString(),
    name,
    message: message.slice(0, 500),
    stack:   stack.slice(0, BSR_ERROR_STACK_MAX),
    ...base,
    ...ctx,
  };
  const log = getErrorLog();
  log.push(entry);
  while (log.length > BSR_ERROR_LOG_MAX) log.shift();
  _persistErrorLog();
  return entry;
}

// The text a student copies and sends. Plain text, one fact per line.
function formatErrorDetails(entry) {
  const lines = [
    `Bible Study Reader ${entry.appVersion || '(version unknown)'}`,
    `Time: ${entry.time}`,
    `Where: ${entry.context || 'unknown'}`,
  ];
  if (entry.studyId)       lines.push(`Study: ${entry.studyId}${entry.studyVersion ? ' v' + entry.studyVersion : ''}`);
  if (entry.file)          lines.push(`File: ${entry.file}`);
  if (entry.chapter !== undefined && entry.chapter !== '') lines.push(`Chapter: ${entry.chapter}`);
  if (entry.elementId)     lines.push(`Element: ${entry.elementId}${entry.elementType ? ' (' + entry.elementType + ')' : ''}`);
  if (entry.language)      lines.push(`Study language: ${entry.language}`);
  lines.push(`Error: ${entry.name}: ${entry.message}`);
  if (entry.stack)         lines.push('', entry.stack);
  try {
    lines.push('', `Device: ${navigator.userAgent}`, `Screen: ${window.screen.width}x${window.screen.height}`);
  } catch (e) { /* ignore */ }
  return lines.join('\n');
}

// Errors that are routine and not a problem for the reader. They are still
// recorded in the log, but no banner is shown for them.
function isBenignError(err, message) {
  const name = err && err.name ? String(err.name) : '';
  const msg  = String(message || (err && err.message) || '');
  if (name === 'AbortError' || name === 'NotAllowedError') return true;   // share/clipboard/speech cancelled or refused
  if (/^ResizeObserver loop/.test(msg)) return true;                       // harmless browser notice
  if (/^(canceled|cancelled|interrupted)$/i.test(msg)) return true;        // speech synthesis stopping
  return false;
}

// ── The dialog ───────────────────────────────────────────────────────────────

function _erEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function _erRemove(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// Copies text; falls back to a hidden textarea where the clipboard API is
// missing (older WebViews) and returns whether it worked.
async function _erCopy(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* try the fallback */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

// options: { title, message, lines: [{ok, text}], details }
//   title/message  plain text; lines: a list shown under the message (each
//   with an ✓ or ⚠ marker); details: text shown under "Technical details" and
//   copied by the Copy button.
function showErrorDialog({ title, message, lines = [], details = '' } = {}) {
  try {
    _erRemove('errorReportOverlay');
    _erRemove('errorReportBanner');

    const overlay = _erEl('div', 'error-report-overlay');
    overlay.id = 'errorReportOverlay';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    const box = _erEl('div', 'error-report-box');
    overlay.appendChild(box);

    box.appendChild(_erEl('h2', 'error-report-title', title || _er('errorreport_title', 'Something went wrong')));
    if (message) box.appendChild(_erEl('p', 'error-report-message', message));

    if (lines.length) {
      const ul = _erEl('ul', 'error-report-lines');
      for (const line of lines) {
        ul.appendChild(_erEl('li', line.ok ? 'error-report-line ok' : 'error-report-line warn',
          (line.ok ? '✓ ' : '⚠ ') + line.text));
      }
      box.appendChild(ul);
    }

    if (details) {
      const wrap = _erEl('details', 'error-report-details');
      wrap.appendChild(_erEl('summary', '', _er('errorreport_details_heading', 'Technical details')));
      wrap.appendChild(_erEl('pre', 'error-report-pre', details));
      box.appendChild(wrap);
      box.appendChild(_erEl('p', 'error-report-hint',
        _er('errorreport_hint', 'If this keeps happening, tap “Copy details” and send them to the person who gave you the study.')));
    }

    const actions = _erEl('div', 'error-report-actions');
    if (details) {
      const copyBtn = _erEl('button', 'error-report-btn', _er('errorreport_copy', 'Copy details'));
      copyBtn.type = 'button';
      copyBtn.addEventListener('click', async () => {
        const ok = await _erCopy(details);
        copyBtn.textContent = ok ? _er('errorreport_copied', 'Copied ✓') : _er('errorreport_copy_failed', 'Could not copy — open Technical details and select the text');
        if (!ok) _erOpenDetails(box);
      });
      actions.appendChild(copyBtn);
    }
    const closeBtn = _erEl('button', 'error-report-btn primary', _er('errorreport_close', 'Close'));
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => overlay.remove());
    actions.appendChild(closeBtn);
    box.appendChild(actions);

    document.body.appendChild(overlay);
    closeBtn.focus();
  } catch (e) {
    console.error('[error-report] could not show the dialog', e);
  }
}

// Opens the Technical details section (used when copying fails).
function _erOpenDetails(box) {
  const d = box.querySelector('details');
  if (d) d.open = true;
}

// ── The banner (for errors nobody asked for) ─────────────────────────────────

let _erBannerCount = 0;
let _erBannerKey = '';

function showErrorBanner(entry) {
  try {
    const key = entry.name + ':' + entry.message;
    const existing = document.getElementById('errorReportBanner');
    if (existing && key === _erBannerKey) {
      _erBannerCount++;
      const badge = existing.querySelector('.error-report-count');
      if (badge) badge.textContent = '×' + (_erBannerCount);
      return;
    }
    _erRemove('errorReportBanner');
    _erBannerKey = key;
    _erBannerCount = 1;

    const banner = _erEl('div', 'error-report-banner');
    banner.id = 'errorReportBanner';
    banner.setAttribute('role', 'alert');
    banner.appendChild(_erEl('span', 'error-report-banner-text', '⚠ ' + _er('errorreport_banner', 'Something went wrong.')));
    banner.appendChild(_erEl('span', 'error-report-count', ''));
    const detailsBtn = _erEl('button', 'error-report-banner-btn', _er('errorreport_details_btn', 'Details'));
    detailsBtn.type = 'button';
    detailsBtn.addEventListener('click', () => {
      showErrorDialog({ details: formatErrorDetails(entry), message: entry.message });
    });
    const dismiss = _erEl('button', 'error-report-banner-btn', '✕');
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', _er('errorreport_close', 'Close'));
    dismiss.addEventListener('click', () => banner.remove());
    banner.appendChild(detailsBtn);
    banner.appendChild(dismiss);
    document.body.appendChild(banner);
  } catch (e) {
    console.error('[error-report] could not show the banner', e);
  }
}

// reportError(err, ctx): record the error, then tell the reader.
//   ctx.dialog  true → a dialog now (an action the reader just took failed);
//               false (default) → a small banner (something broke in the background).
//   ctx.message plain-language sentence for the dialog.
//   Benign errors are recorded but never shown.
function reportError(err, ctx = {}) {
  try {
    const { dialog = false, message = '', title = '', ...where } = ctx;
    const entry = recordError(err, where);
    console.error('[error-report]', entry.context || '', err);
    if (isBenignError(err, entry.message)) return entry;
    if (dialog) {
      showErrorDialog({ title, message: message || entry.message, details: formatErrorDetails(entry) });
    } else {
      showErrorBanner(entry);
    }
    return entry;
  } catch (e) {
    console.error('[error-report] reportError failed', e);
    return null;
  }
}

// ── Global handlers ──────────────────────────────────────────────────────────
// Capture phase, so that a <script> or <link> that fails to load (missing file,
// no network) is seen too: those errors do not bubble.
window.addEventListener('error', ev => {
  try {
    const target = ev.target;
    if (target && target !== window && target.tagName) {
      if (target.tagName === 'SCRIPT' || target.tagName === 'LINK') {
        reportError(new Error(`Could not load ${target.src || target.href || 'a file'}`), { context: 'file-load' });
      }
      return;                                    // a missing image is not worth a banner
    }
    const err = ev.error || new Error(ev.message || 'Unknown error');
    reportError(err, { context: 'uncaught-error' });
  } catch (e) { /* never let the handler throw */ }
}, true);

window.addEventListener('unhandledrejection', ev => {
  try {
    const r = ev.reason;
    const err = (r && typeof r === 'object') ? r : new Error(r === undefined ? 'Unhandled promise rejection' : String(r));
    reportError(err, { context: 'unhandled-promise' });
  } catch (e) { /* never let the handler throw */ }
});
