// ── IMPORTED PATHWAYS ─────────────────────────────────────────────────────────
// Lets organisations (ministries, publishers) distribute their own learning
// pathways alongside their studies. A pathway file is plain JSON, delivered
// either as a standalone .epathway file or as pathways.json at the root of a
// bundle zip next to the .estudy files.
//
// Everything in an imported file is treated as hostile:
//   • parsed with JSON.parse only; __proto__ / constructor / prototype keys
//     cause rejection, and only allowlisted keys are copied out (no
//     Object.assign or deep-merge of parsed data);
//   • size, count, length, ID and URL rules below are enforced, and a file
//     breaking any of them is rejected with a message rather than truncated;
//   • text is only ever displayed escaped (see render-library.js), and URLs
//     are only ever handed to the system browser after a confirmation that
//     shows the host and says the publisher is unverified.
//
// Downloads are NOT fetched in-app. As for the built-in pathways, the URL is
// handed to the device's browser (Android.openUrl / window.open); the user
// then opens the downloaded file, which goes through the normal, fully
// validated import path. In-app fetching would fail for typical hosts anyway
// (Google Drive sends no CORS headers).
//
// Storage: imported groups live in localStorage under IMPORTED_PATHWAYS_KEY
// ({ groups: [...] }). It is read synchronously by the renderers, needs no
// startup cache, and "Reset all data" wipes it with the rest of localStorage.
// Files are small (capped at PATHWAY_FILE_MAX_BYTES), so this stays well
// within the browser's localStorage quota.
//
// Active pathway keys (bsr_activePathwayId) are stable strings:
//   builtin:{l1Idx}_{l2Idx}          – built-in pathways (as before, positional)
//   imp:{groupId}:{pathwayId}        – imported pathways
// A legacy positional value "1_2" is migrated to "builtin:1_2" on first read.
//
// Dependencies (all runtime calls; nothing runs at load time):
//   t, window.appLocale              – i18n.js
//   escapeHtml, showToast            – utils.js
//   safeSetItem                      – utils.js
//   sanitizeHtml                     – format-text.js
//   Swal                             – sweetalert2
//   renderLibrary                    – render-library.js
//   Router                           – router.js
//   renderProgressOverview           – render-progress.js

// ── Limits ────────────────────────────────────────────────────────────────────
const PATHWAY_FILE_VERSIONS       = [1];          // estudyPathwayFileVersion values this app understands
const PATHWAY_FILE_MAX_BYTES      = 256 * 1024;   // per .epathway / pathways.json file
const PATHWAY_MAX_PER_GROUP       = 20;
const PATHWAY_MAX_STUDIES         = 100;          // per pathway
const PATHWAY_MAX_DOCS_PER_BUNDLE = 20;           // pathways.json may hold an array of documents
const PATHWAY_TITLE_MAX           = 200;          // characters
const PATHWAY_DESC_MAX            = 5000;         // characters
const PATHWAY_URL_MAX             = 2048;         // characters
const PATHWAY_ID_RE               = /^[A-Za-z0-9._-]{1,64}$/;
const PATHWAY_LANG_RE             = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
const IMPORTED_PATHWAYS_KEY       = 'bsr_importedPathways';
const ACTIVE_PATHWAY_KEY          = 'bsr_activePathwayId';

// ── Validation ────────────────────────────────────────────────────────────────

// Thrown by the validators below; `message` is already user-facing.
class PathwayImportError extends Error {}

function _pwFail(key, vars) {
  throw new PathwayImportError(t(key, vars));
}

// Parses pathway JSON text. Rejects (rather than strips) prototype-polluting
// keys: a file that contains them is not a well-meaning file.
function _parsePathwayJson(text) {
  if (new Blob([text]).size > PATHWAY_FILE_MAX_BYTES) {
    _pwFail('pathways_err_too_large', { max: Math.round(PATHWAY_FILE_MAX_BYTES / 1024) + ' KB' });
  }
  let poisoned = false;
  let parsed;
  try {
    parsed = JSON.parse(text, (k, v) => {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') poisoned = true;
      return v;
    });
  } catch (_) {
    _pwFail('pathways_err_json');
  }
  if (poisoned) _pwFail('pathways_err_reserved_key');
  return parsed;
}

function _isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// A displayable text field: a plain string, or { langCode: string, … }.
// Returns a clean copy (string, or a fresh object holding only valid entries).
function _validText(value, field, max, required) {
  if (value === undefined || value === null || value === '') {
    if (required) _pwFail('pathways_err_field', { field });
    return '';
  }
  const checkString = s => {
    if (typeof s !== 'string') _pwFail('pathways_err_field', { field });
    if (s.length > max) _pwFail('pathways_err_text_long', { field, max });
    return s;
  };
  if (typeof value === 'string') return checkString(value);
  if (!_isPlainObject(value)) _pwFail('pathways_err_field', { field });
  const out = {};
  const langs = Object.keys(value);
  if (langs.length === 0 && required) _pwFail('pathways_err_field', { field });
  for (const lang of langs) {
    if (!PATHWAY_LANG_RE.test(lang)) _pwFail('pathways_err_field', { field });
    out[lang] = checkString(value[lang]);
  }
  return out;
}

function _validId(value, field) {
  if (typeof value !== 'string' || !PATHWAY_ID_RE.test(value)) _pwFail('pathways_err_id', { field });
  return value;
}

// Vets a download URL. Returns the normalised href, or '' when it fails any
// rule: https only, no embedded credentials, a public DNS host name (not
// localhost, *.local, an IP literal or a single-label name), ≤ PATHWAY_URL_MAX.
function vetDownloadUrl(value) {
  if (typeof value !== 'string' || !value || value.length > PATHWAY_URL_MAX) return '';
  let url;
  try { url = new URL(value); } catch (_) { return ''; }
  if (url.protocol !== 'https:') return '';
  if (url.username || url.password) return '';
  const host = url.hostname.toLowerCase();
  if (!host.includes('.')) return '';                          // localhost, intranet names
  if (host.startsWith('[')) return '';                          // IPv6 literal
  if (/^[0-9.]+$/.test(host)) return '';                        // IPv4 literal (URL() normalises 2130706433 etc.)
  if (/\.(local|localhost|internal|lan|home\.arpa)$/.test(host)) return '';
  return url.href;
}

function _validUrl(value, field) {
  if (value === undefined || value === null || value === '') return '';
  const href = vetDownloadUrl(value);
  if (!href) _pwFail('pathways_err_url', { field });
  return href;
}

// Validates one pathway document and returns a clean copy containing only
// allowlisted keys. Throws PathwayImportError with a user-facing message.
function validatePathwayDocument(raw) {
  if (!_isPlainObject(raw)) _pwFail('pathways_err_shape');

  const fileVersion = raw.estudyPathwayFileVersion;
  if (typeof fileVersion !== 'number' || !PATHWAY_FILE_VERSIONS.includes(fileVersion)) {
    if (typeof fileVersion === 'number' && fileVersion > Math.max(...PATHWAY_FILE_VERSIONS)) {
      _pwFail('pathways_err_newer_app');
    }
    _pwFail('pathways_err_field', { field: 'estudyPathwayFileVersion' });
  }
  if (typeof raw.version !== 'number' || !Number.isFinite(raw.version) || raw.version < 0) {
    _pwFail('pathways_err_field', { field: 'version' });
  }

  const doc = {
    estudyPathwayFileVersion: fileVersion,
    groupId:     _validId(raw.groupId, 'groupId'),
    version:     raw.version,
    publisher:   { name: _validText(_isPlainObject(raw.publisher) ? raw.publisher.name : '', 'publisher.name', PATHWAY_TITLE_MAX, false) },
    title:       _validText(raw.title, 'title', PATHWAY_TITLE_MAX, true),
    description: _validText(raw.description, 'description', PATHWAY_DESC_MAX, false),
    pathways:    [],
  };

  if (!Array.isArray(raw.pathways) || raw.pathways.length === 0) _pwFail('pathways_err_field', { field: 'pathways' });
  if (raw.pathways.length > PATHWAY_MAX_PER_GROUP) _pwFail('pathways_err_too_many', { field: 'pathways', max: PATHWAY_MAX_PER_GROUP });

  const pathwayIds = new Set();
  raw.pathways.forEach((p, pi) => {
    const where = `pathways[${pi}]`;
    if (!_isPlainObject(p)) _pwFail('pathways_err_field', { field: where });
    const pathwayId = _validId(p.pathwayId, `${where}.pathwayId`);
    if (pathwayIds.has(pathwayId)) _pwFail('pathways_err_duplicate', { id: pathwayId });
    pathwayIds.add(pathwayId);

    if (!Array.isArray(p.studies)) _pwFail('pathways_err_field', { field: `${where}.studies` });
    if (p.studies.length > PATHWAY_MAX_STUDIES) _pwFail('pathways_err_too_many', { field: `${where}.studies`, max: PATHWAY_MAX_STUDIES });

    const studyIds = new Set();
    const studies = p.studies.map((s, si) => {
      const sWhere = `${where}.studies[${si}]`;
      if (!_isPlainObject(s)) _pwFail('pathways_err_field', { field: sWhere });
      const studyId = _validId(s.studyId, `${sWhere}.studyId`);
      if (studyIds.has(studyId)) _pwFail('pathways_err_duplicate', { id: studyId });
      studyIds.add(studyId);
      return {
        studyId,
        title:            _validText(s.title, `${sWhere}.title`, PATHWAY_TITLE_MAX, true),
        description:      _validText(s.description, `${sWhere}.description`, PATHWAY_DESC_MAX, false),
        downloadLocation: _validUrl(s.downloadLocation, `${sWhere}.downloadLocation`),
      };
    });

    doc.pathways.push({
      pathwayId,
      title:            _validText(p.title, `${where}.title`, PATHWAY_TITLE_MAX, true),
      description:      _validText(p.description, `${where}.description`, PATHWAY_DESC_MAX, false),
      downloadLocation: _validUrl(p.downloadLocation, `${where}.downloadLocation`),
      studies,
    });
  });

  return doc;
}

// Parses and validates the text of an .epathway file or a bundle's
// pathways.json (which may hold one document or an array of them).
// Returns an array of clean documents. Throws PathwayImportError.
function parsePathwayFileText(text) {
  const parsed = _parsePathwayJson(text);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (list.length === 0) _pwFail('pathways_err_shape');
  if (list.length > PATHWAY_MAX_DOCS_PER_BUNDLE) _pwFail('pathways_err_too_many', { field: 'pathways.json', max: PATHWAY_MAX_DOCS_PER_BUNDLE });
  const docs = list.map(validatePathwayDocument);
  const groupIds = new Set();
  docs.forEach(d => {
    if (groupIds.has(d.groupId)) _pwFail('pathways_err_duplicate', { id: d.groupId });
    groupIds.add(d.groupId);
  });
  return docs;
}

// Cheap check used by the file router: does this text look like a pathway
// file (rather than a plain-JSON .estudy)? The full validation happens later.
function looksLikePathwayFile(text) {
  return typeof text === 'string' && text.includes('"estudyPathwayFileVersion"');
}

// ── Storage ───────────────────────────────────────────────────────────────────

// Returns the stored imported groups (an array of validated documents, in
// import order). Stored data is re-validated on read, so a corrupted or
// hand-edited entry is dropped rather than rendered.
function getImportedPathwayGroups() {
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(IMPORTED_PATHWAYS_KEY) || '{"groups":[]}');
  } catch (_) {
    return [];
  }
  const groups = Array.isArray(stored && stored.groups) ? stored.groups : [];
  const valid = [];
  for (const g of groups) {
    try { valid.push(validatePathwayDocument(g)); } catch (_) { /* drop */ }
  }
  return valid;
}

function _saveImportedPathwayGroups(groups) {
  // Write directly rather than via safeSetItem so a quota failure reaches the
  // caller and the import can report it instead of silently not saving.
  localStorage.setItem(IMPORTED_PATHWAYS_KEY, JSON.stringify({ groups }));
}

// ── Merged read (built-in + imported) ─────────────────────────────────────────

// Resolves a validated text field for the current UI language:
// UI language → en → first language present. Plain strings are returned as-is.
function _resolvePathwayText(value) {
  if (typeof value === 'string') return value;
  if (!_isPlainObject(value)) return '';
  const lang = window.appLocale || 'en';
  const base = lang.split('-')[0];
  return value[lang] || value[base] || value.en || Object.values(value)[0] || '';
}

// Returns all pathway groups in the shape the Paths tab and Progress page use:
//   [{ titleLevel1, description, descriptionIsHtml, isImported, groupId,
//      publisherName,
//      pathways: [{ titleLevel2, description, downloadLocation, pathwayKey,
//                   isImported, studyTitles: [{ titleLevel3, studyId,
//                   description, downloadLocation }] }] }]
// Built-ins first, then imported groups in import order. Text is resolved for
// the current language at call time, so a language change re-renders
// correctly. Built-in descriptions may contain authored HTML (rendered via
// sanitizeHtml); imported descriptions are always plain text.
function getAllPathways() {
  const builtin = ((window.appAboutData || {}).learningPathways || {}).learningPathways || [];
  const out = builtin.map((g, l1) => ({
    titleLevel1:       g.titleLevel1 || '',
    description:       g.description || '',
    descriptionIsHtml: true,
    isImported:        false,
    pathways: (g.pathways || []).map((p, l2) => ({
      titleLevel2:       p.titleLevel2 || '',
      description:       p.description || '',
      descriptionIsHtml: true,
      downloadLocation:  p.downloadLocation || '',
      pathwayKey:        `builtin:${l1}_${l2}`,
      isImported:        false,
      studyTitles: (p.studyTitles || []).map(s => ({
        titleLevel3:      s.titleLevel3 || '',
        studyId:          s.studyId || '',
        description:      s.description || '',
        downloadLocation: s.downloadLocation || '',
      })),
    })),
  }));

  for (const g of getImportedPathwayGroups()) {
    out.push({
      titleLevel1:       _resolvePathwayText(g.title),
      description:       _resolvePathwayText(g.description),
      descriptionIsHtml: false,
      isImported:        true,
      groupId:           g.groupId,
      publisherName:     _resolvePathwayText(g.publisher.name),
      pathways: g.pathways.map(p => ({
        titleLevel2:       _resolvePathwayText(p.title),
        description:       _resolvePathwayText(p.description),
        descriptionIsHtml: false,
        downloadLocation:  p.downloadLocation,
        pathwayKey:        `imp:${g.groupId}:${p.pathwayId}`,
        isImported:        true,
        studyTitles: p.studies.map(s => ({
          titleLevel3:      _resolvePathwayText(s.title),
          studyId:          s.studyId,
          description:      _resolvePathwayText(s.description),
          downloadLocation: s.downloadLocation,
        })),
      })),
    });
  }
  return out;
}

// Finds a pathway by key. Returns { group, pathway, l1Idx, l2Idx } or null.
function findPathwayByKey(key) {
  if (!key) return null;
  const all = getAllPathways();
  for (let l1Idx = 0; l1Idx < all.length; l1Idx++) {
    const l2Idx = all[l1Idx].pathways.findIndex(p => p.pathwayKey === key);
    if (l2Idx !== -1) return { group: all[l1Idx], pathway: all[l1Idx].pathways[l2Idx], l1Idx, l2Idx };
  }
  return null;
}

// ── Active pathway key ────────────────────────────────────────────────────────

// Returns the active pathway key, migrating a legacy positional value
// ("1_2" → "builtin:1_2") in place.
function getActivePathwayKey() {
  const raw = localStorage.getItem(ACTIVE_PATHWAY_KEY);
  if (raw && /^\d+_\d+$/.test(raw)) {
    const migrated = `builtin:${raw}`;
    safeSetItem(ACTIVE_PATHWAY_KEY, migrated);
    return migrated;
  }
  return raw || null;
}

function setActivePathwayKey(key) {
  if (key) safeSetItem(ACTIVE_PATHWAY_KEY, key);
  else localStorage.removeItem(ACTIVE_PATHWAY_KEY);
}

// Clears the active pathway if its key no longer resolves (it was removed or
// replaced by a re-import), with a toast. Skipped until the built-in pathway
// data has loaded, so an early call can't clear a valid built-in key.
function clearActivePathwayIfMissing() {
  const key = getActivePathwayKey();
  if (!key || !(window.appAboutData && window.appAboutData.learningPathways)) return;
  if (findPathwayByKey(key)) return;
  setActivePathwayKey(null);
  showToast({ message: t('pathways_active_cleared'), isManual: true });
}

// ── Import ────────────────────────────────────────────────────────────────────

// Re-renders whichever pathway views are on screen after a change. After an
// import (showPaths), goes to the Library's Paths tab so the user sees the
// new group, wherever the file was opened from.
function _refreshPathwayViews({ showPaths = false } = {}) {
  if (showPaths) window._libActiveTab = 'paths';
  if (window.activeTabPage === 'library') {
    renderLibrary();
  } else if (showPaths) {
    Router.navigate({ page: 'library' });
  } else if (window.activeTabPage === 'progress') {
    renderProgressOverview();
  }
}

// Imports pathway documents from file text. `bundledStudyCount` is the number
// of studies installed from the same bundle (for the confirmation dialog), or
// null for a standalone .epathway file. Shows its own confirmation and result
// messages; never throws.
async function importPathwaysFromText(text, { bundledStudyCount = null } = {}) {
  let docs;
  try {
    docs = parsePathwayFileText(text);
  } catch (err) {
    const message = err instanceof PathwayImportError ? err.message : t('pathways_err_json');
    await Swal.fire({ icon: 'error', title: t('pathways_import_failed_title'), text: message });
    return;
  }

  let imported = 0;
  for (const doc of docs) {
    const existing = getImportedPathwayGroups().find(g => g.groupId === doc.groupId);
    const title = _resolvePathwayText(doc.title);
    if (existing && doc.version <= existing.version) {
      showToast({ message: t('pathways_import_skipped', { title, version: existing.version }), isManual: true });
      continue;
    }
    if (!(await _confirmPathwayImport(doc, existing, bundledStudyCount))) continue;

    // Replace wholesale (or append), keeping the group's position on replace.
    const groups = getImportedPathwayGroups();
    const idx = groups.findIndex(g => g.groupId === doc.groupId);
    if (idx === -1) groups.push(doc); else groups[idx] = doc;
    try {
      _saveImportedPathwayGroups(groups);
    } catch (err) {
      await Swal.fire({ icon: 'error', title: t('pathways_import_failed_title'), text: t('pathways_err_storage') });
      return;
    }
    imported++;
    showToast({ message: t('pathways_import_done', { title }), isManual: true });
  }

  if (imported > 0) {
    clearActivePathwayIfMissing();
    _refreshPathwayViews({ showPaths: true });
  }
}

// Confirmation dialog before storing a group. Every value from the file is
// escaped; the publisher name is labelled as self-declared.
async function _confirmPathwayImport(doc, existing, bundledStudyCount) {
  const esc = v => escapeHtml(_resolvePathwayText(v));
  const studyCount = doc.pathways.reduce((n, p) => n + p.studies.length, 0);
  const publisher  = _resolvePathwayText(doc.publisher.name);
  const rows = [
    publisher ? `<p><b>${escapeHtml(t('pathways_import_publisher'))}</b> ${esc(doc.publisher.name)}</p>` : '',
    `<p><b>${esc(doc.title)}</b> · ${escapeHtml(t('pathways_import_version', { version: doc.version }))}</p>`,
    `<ul style="text-align:left; margin:8px 0 8px 18px;">${doc.pathways.map(p => `<li>${esc(p.title)}</li>`).join('')}</ul>`,
    `<p>${escapeHtml(t('pathways_import_counts', { pathways: doc.pathways.length, studies: studyCount }))}</p>`,
    bundledStudyCount !== null ? `<p>${escapeHtml(t('pathways_import_bundled', { count: bundledStudyCount }))}</p>` : '',
    existing ? `<p>${escapeHtml(t('pathways_import_replaces', { version: existing.version }))}</p>` : '',
  ].join('');
  const { isConfirmed } = await Swal.fire({
    title:             t('pathways_import_title'),
    html:              rows,
    icon:              'question',
    showCancelButton:  true,
    confirmButtonText: t('pathways_import_confirm'),
    cancelButtonText:  t('pathways_cancel'),
    reverseButtons:    true,
  });
  return isConfirmed;
}

// ── Removal ───────────────────────────────────────────────────────────────────

// Removes one imported pathway (and its group, if it was the group's last).
// Never touches installed studies, answers or progress.
async function removeImportedPathway(pathwayKey) {
  const found = findPathwayByKey(pathwayKey);
  if (!found || !found.pathway.isImported) return;
  const { isConfirmed } = await Swal.fire({
    title:             t('pathways_remove_title'),
    text:              t('pathways_remove_body', { title: found.pathway.titleLevel2 }),
    icon:              'warning',
    showCancelButton:  true,
    confirmButtonText: t('pathways_remove_confirm'),
    cancelButtonText:  t('pathways_cancel'),
    reverseButtons:    true,
  });
  if (!isConfirmed) return;

  const [, groupId, pathwayId] = pathwayKey.split(':');
  const groups = getImportedPathwayGroups()
    .map(g => g.groupId !== groupId ? g : { ...g, pathways: g.pathways.filter(p => p.pathwayId !== pathwayId) })
    .filter(g => g.pathways.length > 0);
  _saveImportedPathwayGroups(groups);
  if (getActivePathwayKey() === pathwayKey) setActivePathwayKey(null);
  showToast({ message: t('pathways_removed_toast'), isManual: true });
  _refreshPathwayViews();
}

// ── Download (hand-off to the system browser) ─────────────────────────────────

// Opens a pathway's (studyIdx = -1) or study's download link in the system
// browser. The URL is looked up from the stored pathway data by key and
// index — it is never passed through markup. Imported links are re-vetted
// and need confirmation; built-in links keep their existing behaviour.
async function openPathwayDownload(pathwayKey, studyIdx) {
  const found = findPathwayByKey(pathwayKey);
  if (!found) return;
  const { pathway } = found;
  const item  = studyIdx >= 0 ? pathway.studyTitles[studyIdx] : pathway;
  if (!item) return;
  const title = studyIdx >= 0 ? item.titleLevel3 : pathway.titleLevel2;
  const raw   = item.downloadLocation || '';

  if (!raw || raw.includes('placeholder.com')) {
    showToast({ message: t('renderlib_download_coming_soon'), isManual: true, duration: 2500 });
    return;
  }
  const href = vetDownloadUrl(raw);
  if (!href) {
    showToast({ message: t('pathways_download_invalid'), isManual: true });
    return;
  }
  if (navigator.onLine === false) {
    showToast({ message: t('pathways_download_offline'), isManual: true });
    return;
  }

  if (pathway.isImported) {
    const host = new URL(href).hostname;
    const { isConfirmed } = await Swal.fire({
      title:             t('pathways_download_title'),
      html:              `<p>${escapeHtml(t('pathways_download_body', { title }))}</p>
                          <p style="font-family:monospace; word-break:break-all; margin:10px 0;"><b>${escapeHtml(host)}</b></p>
                          <p>${escapeHtml(t('pathways_download_unverified'))}</p>`,
      icon:              'warning',
      showCancelButton:  true,
      confirmButtonText: t('pathways_download_confirm'),
      cancelButtonText:  t('pathways_cancel'),
      reverseButtons:    true,
    });
    if (!isConfirmed) return;
  }

  // Google Drive share links → direct-download form (unchanged from before).
  let finalUrl = href;
  const drive = href.match(/^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/);
  if (drive) finalUrl = `https://drive.google.com/uc?export=download&id=${drive[1]}`;

  if (window.Android && typeof window.Android.openUrl === 'function') {
    window.Android.openUrl(finalUrl);
  } else {
    window.open(finalUrl, '_blank', 'noopener');
  }
}
