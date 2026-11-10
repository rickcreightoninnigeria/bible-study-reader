// ── BACKUP AND RESTORE ────────────────────────────────────────────────────────
// A backup is a zip (".bsrbackup") holding bsr-backup.json: every record in
// the IDB answers store (answers, notes, stars, Likert ratings, completion
// flags, reading positions) plus the reader's settings, pinned and recent
// lists, learning-path choice and imported pathways. With "Include studies"
// ticked, each installed study is also packed as an ordinary .estudy file
// under studies/, so restoring installs it through the normal quiet installer.
//
// Restoring merges rather than replaces. Each answer field keeps the newer
// copy, using the per-field times in record._t (stampChangedFields, idb.js);
// a field with no time counts as oldest, and when neither copy has a time the
// copy on this device wins unless it is empty. Answers for studies that are
// not installed are kept and appear once the study is installed.
//
// Files reach restoreBackupFromZip() three ways: Settings → Restore, any file
// opened in the app (loadAnyFile spots bsr-backup.json), and, in the Android
// app, the copy kept for Google's automatic backup (offered on a device with
// no answers yet). Settings → Back up now shares the file (Android) or
// downloads it (browsers). A reminder appears when the last backup is more
// than BACKUP_REMINDER_DAYS old.

const BACKUP_FORMAT          = 'bsr-backup';
const BACKUP_FORMAT_VERSION  = 1;
const BACKUP_MANIFEST        = 'bsr-backup.json';
const BACKUP_REMINDER_DAYS   = 30;
const BACKUP_LAST_KEY        = 'bsr_backup_last_at';      // ms of the last "Back up now"
const BACKUP_REMINDED_KEY    = 'bsr_backup_reminded_at';  // ms the reminder clock last started
const AUTOBACKUP_DELAY_MS    = 5000;
const BACKUP_SCREEN_POLL_MS  = 3000;
const BACKUP_SCREEN_MAX_POLLS = 200;                      // ten minutes: the first-run slides may be up

// localStorage keys carried in a backup. Version records, install flags, the
// error log and the backup's own keys stay with the device; so does the
// interface language, which the reader has just chosen on a new phone.
const _BACKUP_LS_KEYS = [
  'appSettings', 'app_onboarding_complete', 'intermediateDefaultsApplied',
  'lib_recent_installed', 'lib_recent_opened', 'lib_pinned', 'lib_pinned_all',
  'bsr_activePathwayId', 'bsr_importedPathways',
];
const _BACKUP_LS_PREFIXES = ['onboardingComplete_', 'featureSeen_', 'bsr_infoSeen_'];
const _BACKUP_LS_LISTS    = ['lib_recent_installed', 'lib_recent_opened', 'lib_pinned', 'lib_pinned_all'];

const _BACKUP_KEY_RE = /^[A-Za-z0-9_.\-]{1,300}$/;

function _isBackedUpLocalKey(key) {
  return _BACKUP_LS_KEYS.includes(key) || _BACKUP_LS_PREFIXES.some(p => key.startsWith(p));
}

function _isChapterRecordKey(key) {
  return /_ch\d+$/.test(key) && !/_celebrated_ch\d+$/.test(key);
}

function _isPlainObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ── Merging (pure; tested in testing/tests/backup.test.js) ────────────────────

// Merges one chapter record. Returns the merged record, or null when the
// local record needs no change.
function mergeChapterRecord(local, incoming) {
  local = _isPlainObj(local) ? local : {};
  const lt = _isPlainObj(local._t) ? local._t : {};
  const it = _isPlainObj(incoming._t) ? incoming._t : {};
  const merged = { ...local };
  const times  = { ...lt };
  let changed = false;
  const fields = new Set([...Object.keys(local), ...Object.keys(incoming), ...Object.keys(lt), ...Object.keys(it)]);
  for (const k of fields) {
    if (k === '_t') continue;
    const lTime = Number(lt[k]) || 0;
    const iTime = Number(it[k]) || 0;
    const lHas  = typeof local[k] === 'string' && local[k] !== '';
    const takeIncoming = iTime > lTime || (iTime === 0 && lTime === 0 && !lHas && k in incoming);
    if (!takeIncoming) continue;
    if (k in incoming) {
      if (merged[k] !== incoming[k]) { merged[k] = incoming[k]; changed = true; }
    } else if (k in merged) {
      delete merged[k];            // removed (e.g. unstarred) more recently than the local copy changed
      changed = true;
    }
    if (iTime > lTime) { times[k] = iTime; changed = true; }
  }
  if (!changed) return null;
  if (Object.keys(times).length) merged._t = times;
  return merged;
}

// Merges a backup's answers-store records into the local ones (both plain
// objects keyed by IDB key). Returns the { key: value } writes to make.
function mergeAnswerEntries(local, incoming) {
  const writes = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (key.endsWith('_global_notes_t')) continue;            // handled with its notes
    if (_isChapterRecordKey(key)) {
      const merged = mergeChapterRecord(local[key], value);
      if (merged) writes[key] = merged;
    } else if (key.endsWith('_global_notes')) {
      const tKey  = `${key}_t`;
      const lTime = Number(local[tKey]) || 0;
      const iTime = Number(incoming[tKey]) || 0;
      const lHas  = typeof local[key] === 'string' && local[key] !== '';
      if (iTime > lTime || (iTime === 0 && lTime === 0 && !lHas)) {
        if (local[key] !== value) writes[key] = value;
        if (iTime > lTime) writes[tKey] = iTime;
      }
    } else if (!(key in local)) {
      writes[key] = value;                                      // completion flags, reading positions
    }
  }
  return writes;
}

// Merges the backup's localStorage entries. getLocal(key) returns the current
// string or null. Returns the { key: string } writes to make.
function mergeLocalStorageEntries(getLocal, incoming) {
  const writes = {};
  for (const [key, value] of Object.entries(incoming)) {
    const current = getLocal(key);
    if (key === 'appSettings') {
      let mine = {}, theirs;
      try { mine = JSON.parse(current || '{}') || {}; } catch (_) { /* keep {} */ }
      try { theirs = JSON.parse(value); } catch (_) { continue; }
      if (!_isPlainObj(theirs)) continue;
      writes[key] = JSON.stringify({ ...(_isPlainObj(mine) ? mine : {}), ...theirs });
    } else if (_BACKUP_LS_LISTS.includes(key)) {
      let mine = [], theirs;
      try { mine = JSON.parse(current || '[]'); } catch (_) { /* keep [] */ }
      try { theirs = JSON.parse(value); } catch (_) { continue; }
      if (!Array.isArray(theirs)) continue;
      const list = [...(Array.isArray(mine) ? mine : []), ...theirs].filter(x => typeof x === 'string');
      const union = [...new Set(list)];
      if (JSON.stringify(union) !== current) writes[key] = JSON.stringify(union);
    } else if (key === 'bsr_importedPathways') {
      let mine = { groups: [] }, theirs;
      try { mine = JSON.parse(current || '{"groups":[]}'); } catch (_) { /* keep empty */ }
      try { theirs = JSON.parse(value); } catch (_) { continue; }
      const groups = Array.isArray(mine && mine.groups) ? [...mine.groups] : [];
      let changed = false;
      for (const g of (Array.isArray(theirs && theirs.groups) ? theirs.groups : [])) {
        if (!_isPlainObj(g)) continue;
        const idx = groups.findIndex(x => x && x.groupId === g.groupId);
        if (idx === -1) { groups.push(g); changed = true; }
        else if (Number(g.version) > Number(groups[idx].version)) { groups[idx] = g; changed = true; }
      }
      if (changed) writes[key] = JSON.stringify({ groups });   // re-validated on read (pathways-import.js)
    } else if (current === null) {
      writes[key] = value;                                      // flags, the chosen path
    }
  }
  return writes;
}

// Checks a parsed bsr-backup.json and drops anything malformed. Throws an
// Error whose message is the text to show.
function validateBackupManifest(m) {
  if (!_isPlainObj(m) || m.format !== BACKUP_FORMAT) throw new Error(t('backup_restore_bad_file'));
  if (!(Number(m.formatVersion) >= 1)) throw new Error(t('backup_restore_bad_file'));
  if (Number(m.formatVersion) > BACKUP_FORMAT_VERSION) throw new Error(t('backup_restore_newer_format'));
  const answers = {};
  for (const [key, value] of Object.entries(_isPlainObj(m.answers) ? m.answers : {})) {
    if (!_BACKUP_KEY_RE.test(key)) continue;
    if (_isChapterRecordKey(key)) {
      if (!_isPlainObj(value)) continue;
      const rec = {};
      for (const [f, v] of Object.entries(value)) {
        if (f === '_t' && _isPlainObj(v)) {
          rec._t = Object.fromEntries(Object.entries(v).filter(([, n]) => Number.isFinite(n)));
        } else if (typeof v === 'string') {
          rec[f] = v;
        }
      }
      answers[key] = rec;
    } else if (typeof value === 'string' || Number.isFinite(value)) {
      answers[key] = value;
    }
  }
  const localStorageEntries = {};
  for (const [key, value] of Object.entries(_isPlainObj(m.localStorage) ? m.localStorage : {})) {
    if (_isBackedUpLocalKey(key) && typeof value === 'string') localStorageEntries[key] = value;
  }
  const studies = (Array.isArray(m.studies) ? m.studies : [])
    .filter(s => _isPlainObj(s) && typeof s.id === 'string' && _BACKUP_KEY_RE.test(s.id))
    .map(s => ({ id: s.id, title: typeof s.title === 'string' ? s.title : s.id, hasAnswers: !!s.hasAnswers, included: !!s.included }));
  return { createdAt: Number(m.createdAt) || 0, answers, localStorage: localStorageEntries, studies };
}

// ── Building a backup ─────────────────────────────────────────────────────────

function _backupStudyTitle(meta, id) {
  const title = meta && meta.title;
  if (typeof title === 'string' && title) return title;
  if (_isPlainObj(title)) return title[window.appLocale] || title.en || Object.values(title).find(v => typeof v === 'string') || id;
  return id;
}

function _registry() {
  try { return JSON.parse(localStorage.getItem('study_registry') || '[]'); } catch (_) { return []; }
}

// Every image an installed study keeps in IDB, as [IDB key, path in an .estudy].
// Mirrors what _installStudyFileQuietly() and storeGalleryImages() write.
function _studyImageEntries(id, data) {
  const entries = ['cover', 'publisher', 'author'].map(n => [`${id}_${n}`, `images/${n}.webp`]);
  for (const ch of (data.chapters || [])) {
    for (const el of (ch.elements || [])) {
      if (el.type === 'image' && !el.src) entries.push([`${id}_${el.elementId}`, `images/${el.elementId}.webp`]);
    }
  }
  for (const file of galleryFileNamesOf(data)) entries.push([`${id}_gallery_${file}`, `images/${file}`]);
  return entries;
}

// Re-packs an installed study as an .estudy zip.
async function _packStudy(id, data) {
  const zip = new JSZip();
  zip.file('study.json', JSON.stringify(data));
  for (const [key, path] of _studyImageEntries(id, data)) {
    const blob = await StudyIDB.getImage(key);
    if (blob) zip.file(path, blob);
  }
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

async function buildBackupManifest() {
  const answers = {};
  for (const { key, value } of await StudyIDB.getAllAnswerEntries()) answers[key] = value;
  const localStorageEntries = {};
  for (const key of Object.keys(localStorage)) {
    if (_isBackedUpLocalKey(key)) localStorageEntries[key] = localStorage.getItem(key);
  }
  const answerKeys = Object.keys(answers);
  const studies = [];
  for (const id of _registry()) {
    const data = await StudyIDB.get(`study_content_${id}`).catch(() => null);
    studies.push({
      id,
      title:      _backupStudyTitle(data && data.studyMetadata, id),
      version:    _installedStudyVersionRaw(id),
      hasAnswers: answerKeys.some(k => k.startsWith(`${id}_ch`) && _isChapterRecordKey(k)),
    });
  }
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: Date.now(),
    appVersion: window.appAboutData?.appVersion || '',
    answers,
    localStorage: localStorageEntries,
    studies,
  };
}

async function buildBackupBlob({ includeStudies = false } = {}) {
  const manifest = await buildBackupManifest();
  const zip = new JSZip();
  if (includeStudies) {
    for (const s of manifest.studies) {
      const data = await StudyIDB.get(`study_content_${s.id}`).catch(() => null);
      if (!data) continue;
      // Already compressed inside; storing avoids squeezing it twice.
      zip.file(`studies/${s.id}.estudy`, await _packStudy(s.id, data), { compression: 'STORE' });
      s.included = true;
    }
  }
  zip.file(BACKUP_MANIFEST, JSON.stringify(manifest));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/octet-stream' });
}

// Rough sizes in bytes for the "Include studies" warning: the backup without
// studies, and the studies' content and images.
async function estimateBackupSizes() {
  const manifest = await buildBackupManifest();
  const base = JSON.stringify(manifest).length;
  let studies = 0;
  for (const s of manifest.studies) {
    const data = await StudyIDB.get(`study_content_${s.id}`).catch(() => null);
    if (!data) continue;
    studies += JSON.stringify(data).length / 4;                 // study JSON compresses to about a quarter
    for (const [key] of _studyImageEntries(s.id, data)) {
      const blob = await StudyIDB.getImage(key).catch(() => null);
      if (blob) studies += blob.size;
    }
  }
  return { base: Math.max(1024, base / 4), withStudies: base / 4 + studies };
}

function formatBackupSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function _formatBackupDate(ms) {
  try { return new Date(ms).toLocaleDateString(window.appLocale || undefined, { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch (_) { return new Date(ms).toDateString(); }
}

function _blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Android: the share sheet (save to Drive, send to yourself, …).
// Browsers: an ordinary download.
async function _deliverBackupFile(blob, fileName) {
  if (window.Android && typeof window.Android.shareFile === 'function') {
    window.Android.shareFile(await _blobToBase64(blob), fileName, 'application/octet-stream');
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function backupLastText() {
  const last = Number(localStorage.getItem(BACKUP_LAST_KEY)) || 0;
  return last ? t('backup_last', { date: _formatBackupDate(last) }) : t('backup_never');
}

// Settings → Back up now.
async function backUpNow() {
  const includeStudies = !!document.getElementById('backupIncludeStudies')?.checked;
  showToast({ message: t('backup_preparing'), isManual: true });
  try {
    const blob = await buildBackupBlob({ includeStudies });
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await _deliverBackupFile(blob, `BSR backup ${stamp}.bsrbackup`);
    safeSetItem(BACKUP_LAST_KEY, String(Date.now()));
    const line = document.getElementById('backupLastLine');
    if (line) line.textContent = backupLastText();
  } catch (err) {
    console.error('[backup] failed', err);
    if (typeof recordError === 'function') recordError(err, { context: 'backup' });
    Swal.fire({ icon: 'error', title: t('backup_failed_title'), text: err.message || String(err) });
  }
}

// Settings → "Include studies": say how much bigger the file becomes.
async function onBackupIncludeStudiesChange(checkbox) {
  if (!checkbox.checked) return;
  try {
    const { base, withStudies } = await estimateBackupSizes();
    showToast({
      message: t('backup_include_studies_warning', { size: formatBackupSize(withStudies), base: formatBackupSize(base) }),
      isManual: true, duration: 8000,
    });
  } catch (err) {
    console.warn('[backup] size estimate failed', err);
  }
}

// ── Restoring ─────────────────────────────────────────────────────────────────

function isBackupZip(zip) {
  return !!(zip && zip.file(BACKUP_MANIFEST));
}

async function _readBackupManifest(zip) {
  let parsed;
  try { parsed = JSON.parse(await _readZipEntry(zip.file(BACKUP_MANIFEST), 'string')); }
  catch (_) { throw new Error(t('backup_restore_bad_file')); }
  return validateBackupManifest(parsed);
}

function _answerStudyCount(manifest) {
  return manifest.studies.filter(s => s.hasAnswers).length;
}

// Restores a backup zip. `confirm: false` skips the question (the reader has
// just said yes to the automatic-backup offer).
async function restoreBackupFromZip(zip, { confirm = true } = {}) {
  let manifest;
  try {
    manifest = await _readBackupManifest(zip);
  } catch (err) {
    await Swal.fire({ icon: 'error', title: t('backup_restore_failed_title'), text: err.message });
    return false;
  }
  const studyEntries = Object.values(zip.files).filter(f => !f.dir && /^studies\/[^/]+\.estudy$/.test(f.name));

  if (confirm) {
    const lines = [
      t('backup_restore_confirm_body', { date: _formatBackupDate(manifest.createdAt), count: _answerStudyCount(manifest) }),
      studyEntries.length ? t('backup_restore_confirm_studies', { count: studyEntries.length }) : '',
      t('backup_restore_confirm_merge'),
    ].filter(Boolean);
    const { isConfirmed } = await Swal.fire({
      title: t('backup_restore_confirm_title'),
      html: lines.map(l => `<p>${escapeHtml(l)}</p>`).join(''),
      showCancelButton: true,
      confirmButtonText: t('backup_restore_confirm_btn'),
      cancelButtonText: t('backup_cancel'),
      reverseButtons: true,
    });
    if (!isConfirmed) return false;
  }

  showToast({ message: t('backup_restoring'), isManual: true });
  try {
    for (const entry of studyEntries) {
      try {
        await _installStudyFileQuietly(await _readZipEntry(entry, 'arraybuffer'), entry.name.slice('studies/'.length));
      } catch (err) {
        console.warn('[backup] study in backup not installed:', entry.name, err);
      }
    }

    const local = {};
    for (const { key, value } of await StudyIDB.getAllAnswerEntries()) local[key] = value;
    for (const [key, value] of Object.entries(mergeAnswerEntries(local, manifest.answers))) {
      await StudyIDB.setAnswerRaw(key, value);
    }
    for (const [key, value] of Object.entries(mergeLocalStorageEntries(k => localStorage.getItem(k), manifest.localStorage))) {
      safeSetItem(key, value);
    }
  } catch (err) {
    console.error('[backup] restore failed', err);
    if (typeof recordError === 'function') recordError(err, { context: 'restore' });
    await Swal.fire({ icon: 'error', title: t('backup_restore_failed_title'), text: err.message || String(err) });
    return false;
  }

  storageCache.clear();
  initSettings();
  scheduleAutoBackup();

  const installed = new Set(_registry());
  const missing = manifest.studies.filter(s => s.hasAnswers && !installed.has(s.id)).map(s => s.title);
  await Router.navigate({ page: 'library' });
  switchLibTab('all');
  await Swal.fire({
    icon: 'success',
    title: t('backup_restore_done'),
    html: missing.length
      ? `<p>${escapeHtml(t('backup_restore_missing'))}</p><ul style="text-align:start">${missing.map(m => `<li>${escapeHtml(m)}</li>`).join('')}</ul>`
      : '',
  });
  return true;
}

// Settings → Restore: only backup files are accepted here.
async function handleRestorePick(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  let zip = null;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
    _checkZipLimits(zip);
  } catch (_) {
    zip = null;
  }
  if (!isBackupZip(zip)) {
    await Swal.fire({ icon: 'error', title: t('backup_restore_failed_title'), text: t('backup_restore_bad_file') });
    return;
  }
  await restoreBackupFromZip(zip);
}

// ── Android automatic backup ──────────────────────────────────────────────────
// The wrapper keeps one file, files/autobackup/, which is all that Google's
// automatic backup copies (res/xml backup rules), so the backup stays far
// below its 25 MB limit. It is rewritten a few seconds after each save.

let _autoBackupTimer = null;

function _hasAutoBackupBridge() {
  return !!(window.Android && typeof window.Android.saveAutoBackup === 'function');
}

function scheduleAutoBackup() {
  if (!_hasAutoBackupBridge()) return;
  clearTimeout(_autoBackupTimer);
  _autoBackupTimer = setTimeout(writeAutoBackup, AUTOBACKUP_DELAY_MS);
}

async function writeAutoBackup() {
  _autoBackupTimer = null;
  try {
    window.Android.saveAutoBackup(await _blobToBase64(await buildBackupBlob()));
  } catch (err) {
    console.warn('[backup] automatic backup copy not written', err);
  }
}

// Timers stop while the app is in the background, so write a pending copy
// straight away when the reader leaves the app.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && _autoBackupTimer) {
    clearTimeout(_autoBackupTimer);
    writeAutoBackup();
  }
});

async function _hasAnyAnswers() {
  const entries = await StudyIDB.getAllAnswerEntries();
  return entries.some(({ key, value }) =>
    (_isChapterRecordKey(key) && _isPlainObj(value) &&
      Object.entries(value).some(([f, v]) => (f.startsWith('q_') || f.startsWith('r_') || f.startsWith('notes_')) && typeof v === 'string' && v.trim())) ||
    (key.endsWith('_global_notes') && typeof value === 'string' && value.trim()));
}

// A new or reset device with an automatic backup copy (restored by Google
// with the app): offer to bring the answers back.
async function offerAutoBackupRestore() {
  if (!(window.Android && typeof window.Android.readAutoBackup === 'function')) return;
  const b64 = window.Android.readAutoBackup();
  if (!b64) return;
  let zip, manifest;
  try {
    zip = await JSZip.loadAsync(b64, { base64: true });
    manifest = await _readBackupManifest(zip);
  } catch (err) {
    console.warn('[backup] automatic backup copy unreadable', err);
    return;
  }
  const count = _answerStudyCount(manifest);
  if (!count) return;
  const { isConfirmed } = await Swal.fire({
    title: t('backup_auto_offer_title'),
    text: t('backup_auto_offer_body', { date: _formatBackupDate(manifest.createdAt), count }),
    showCancelButton: true,
    confirmButtonText: t('backup_restore_confirm_btn'),
    cancelButtonText: t('backup_not_now'),
    reverseButtons: true,
  });
  if (isConfirmed) await restoreBackupFromZip(zip, { confirm: false });
}

// ── Reminder ──────────────────────────────────────────────────────────────────

function backupReminderDue(now = Date.now()) {
  const last     = Number(localStorage.getItem(BACKUP_LAST_KEY)) || 0;
  const reminded = Number(localStorage.getItem(BACKUP_REMINDED_KEY)) || 0;
  const since = Math.max(last, reminded);
  if (!since) {
    safeSetItem(BACKUP_REMINDED_KEY, String(now));    // start the clock on first use
    return false;
  }
  return now - since >= BACKUP_REMINDER_DAYS * 24 * 60 * 60 * 1000;
}

async function showBackupReminder() {
  safeSetItem(BACKUP_REMINDED_KEY, String(Date.now()));
  const { isConfirmed } = await Swal.fire({
    title: t('backup_reminder_title'),
    text: t('backup_reminder_body', { days: BACKUP_REMINDER_DAYS }),
    showCancelButton: true,
    confirmButtonText: t('backup_btn'),
    cancelButtonText: t('backup_not_now'),
    reverseButtons: true,
  });
  if (isConfirmed) backUpNow();
}

// ── Startup ───────────────────────────────────────────────────────────────────

function _whenScreenFree(fn, polls = 0) {
  const free = localStorage.getItem('app_onboarding_complete') &&
    !document.querySelector('.onboarding-overlay') &&
    !(typeof Swal !== 'undefined' && Swal.isVisible());
  if (free) return fn();
  if (polls < BACKUP_SCREEN_MAX_POLLS) setTimeout(() => _whenScreenFree(fn, polls + 1), BACKUP_SCREEN_POLL_MS);
}

async function runBackupStartupChecks() {
  try {
    if (!(await _hasAnyAnswers())) return offerAutoBackupRestore();
    scheduleAutoBackup();                              // first copy after updating to this version
    if (backupReminderDue()) showBackupReminder();
  } catch (err) {
    console.warn('[backup] startup check failed', err);
  }
}

window.addEventListener('load', () => {
  _whenAppReady(() => setTimeout(() => _whenScreenFree(runBackupStartupChecks), BACKUP_SCREEN_POLL_MS));
});
