// ── STUDY LOADER ──────────────────────────────────────────────────────────────
// Everything needed to load, validate, normalise, and apply a .estudy file:
//   – Version checking and warning banner
//   – Study activation and library open/close
//   – QA lookup building and image data resolution
//   – .estudy format normalisation (flat elements[] → legacy shape)
//   – Theme application and reset
//   – applyStudyData() — the central function that wires it all together
//   – File loading router (loadAnyFile, loadBundleFromFile, loadStudyFromFile)
//   – Android bridge entry points (loadStudyFromJson, loadStudyFromBase64)
//   – Study picker screen (renderStudyPicker, handlePickerFileChange)
//
// Dependencies (all available as globals before this file loads):
//   StudyIDB                  – idb.js
//   ICONS                     – icons.js
//   appSettings               – settings.js
//   showToast                 – utils.js
//   recordStudyOpened,
//   recordStudyInstalled,
//   removeStudyFromHistory    – library.js
//   closeNonChapterPage,
//   _resetNonChapterPageState – navigation.js
//   renderLibrary             – library.js
//   renderTitlePage           – render-pages.js RENDER TILE PAGE section
//   initApp                   – app-init.js INITAPP section
//   studyOnboardingSlides     – onboarding.js
//   window.*                  – state.js

// ── BLOB URL LIFECYCLE ────────────────────────────────────────────────────────
// Every blob URL created in this file is registered here so it can be revoked
// when a new study is applied. Without revocation, switching studies accumulates
// blob URLs in memory for the lifetime of the page — a significant leak on
// Android WebView where RAM is limited.
//
// Usage: replace URL.createObjectURL(blob) with _createBlobUrl(blob) everywhere
// in this file. Call _revokeAllBlobUrls() at the top of applyStudyData().
const _activeBlobUrls = [];

function _createBlobUrl(blob) {
  const url = URL.createObjectURL(blob);
  _activeBlobUrls.push(url);
  return url;
}

function _revokeAllBlobUrls() {
  // Snapshot and clear the live list immediately so any blob URLs created
  // later in this same applyStudyData() call (for the *new* study) aren't
  // swept up by this revoke — only URLs from the outgoing study are targeted.
  const urlsToRevoke = _activeBlobUrls.slice();
  _activeBlobUrls.length = 0;

  // Defer the actual revocation until after the browser has painted the new
  // content. _revokeAllBlobUrls() runs at the very top of applyStudyData(),
  // before the new title page / chapter DOM (with its own fresh blob URLs)
  // has replaced the outgoing elements. Revoking synchronously here pulls
  // the rug out from under <img> tags that are still in the DOM and may
  // still be mid-decode/repaint, which surfaces as spurious
  // "GET blob:... net::ERR_FILE_NOT_FOUND" console errors even though the
  // app keeps working (the browser has already cached the decoded bitmap).
  // A double rAF waits for a full paint cycle to complete before the old
  // URLs are invalidated, which is enough time for the new render to have
  // taken over the DOM.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      urlsToRevoke.forEach(url => URL.revokeObjectURL(url));
    });
  });

  // Also clear the chapter image memo cache — its URLs are about to be revoked.
  clearImageBlobCache();
}

// ── ESTUDY VERSION CHECK ──────────────────────────────────────────────────────
// Compares the estudyFileVersion declared in a study's metadata against the
// version this app expects (window.appAboutData.estudyVersion).
// Shows a non-blocking toast-style warning if they differ, with a message that
// tells the user whether the file is older or newer than expected and which
// thing to update.  Does nothing and returns silently if both versions match
// or if version information is unavailable (so old studies still open cleanly).
function checkEstudyVersion(studyData) {
  const expected = parseInt((window.appAboutData || {}).estudyVersion, 10);
  const actual   = parseInt(
    ((studyData.studyMetadata || {}).estudyFileVersion), 10
  );

  // If either value is missing / not a number, skip the check silently.
  if (!expected || !actual || expected === actual) return;

  const isOlder = actual < expected;

  const msg = t(
    isOlder ? 'studyloader_version_older' : 'studyloader_version_newer',
    { actual, expected }
  );

  // Use a modal overlay so the message is readable on mobile without blocking
  // navigation (unlike alert()). Auto-dismisses after 8 s or on tap.
  showVersionWarning(msg);
}

// Renders a dismissible version-warning banner. Auto-dismisses after 8 seconds.
function showVersionWarning(msg) {
  // Remove any existing warning first
  const existing = document.getElementById('versionWarningOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'versionWarningOverlay';
  overlay.className = 'version-warning-overlay';

  overlay.innerHTML = `
    <div class="version-warning-row">
      <div class="version-warning-icon">⚠️</div>
      <div class="version-warning-body">
        <div class="version-warning-eyebrow">${t('studyloader_version_notice')}</div>
        <div class="version-warning-text">${msg}</div>
      </div>
      <button onclick="document.getElementById('versionWarningOverlay').remove()" class="version-warning-close">${ICONS.close}</button>
    </div>
  `;

  document.body.appendChild(overlay);

  // Auto-dismiss after 8 seconds
  setTimeout(() => {
    if (document.getElementById('versionWarningOverlay')) {
      overlay.style.transition = 'opacity 0.4s ease';
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 400);
    }
  }, 8000);
}

// 3. Switch the Engine to a specific Study
// Opens an installed study from the library. Any failure is reported in a
// dialog that names the study and offers "Copy details"; before this, an error
// here (a render crash, say) was an unhandled rejection and the reader saw
// nothing happen.
async function activateStudy(id) {
  try {
    await _activateStudyUnsafe(id);
    clearOpenFailure(id);
  } catch (err) {
    const entry = reportError(err, {
      context: 'open-study', studyId: id, dialog: true,
      title:   t('errorreport_title'),
      message: t('errorreport_open_study_failed'),
    });
    recordOpenFailure(id, entry);
  }
}

async function _activateStudyUnsafe(id) {
    let data;
    try {
      data = await StudyIDB.get(`study_content_${id}`);
    } catch (err) {
      if (err.name === 'IDBUnavailable') { showPickerError(t('error_idb_unavailable')); return; }
      throw err;
    }

    if (!data) return;

    // 1. Record the active study before applyStudyData runs
    const previousStudyId = window.activeStudyId;
    window.activeStudyId = id;
    safeSetItem('bsr_last_active_study', id);
    recordStudyOpened(id); // ← track in Recent tab

    // Position is stored per-study (lastPosition_{id}), so nothing needs
    // clearing when switching studies — each study keeps its own position.
    
    // 2. Check estudy file version compatibility
    checkEstudyVersion(data);

    // 3. applyStudyData handles everything: chapters normalisation, image data,
    //    shortTitle → headerTitle, QA lookups, onboarding slides, and initApp().
    //    isStudySwitch:true makes initApp() push a new history entry (via
    //    Router.navigate) rather than replace (Router.boot), so the library
    //    entry stays on the stack and back returns to it.
    await applyStudyData(data, { isStudySwitch: true });
    // No Router.back() — initApp() now owns the history entry for the new
    // study view, pushed on top of the existing library entry.
}

function openLibrary() {
  window.libLangFilter = 'all';
  closeMenu();
  _resetNonChapterPageState();
  isNonChapterPage = true;
  window.activeTabPage = 'library';
  suspendStudyTheme();
  document.getElementById('mainContent').innerHTML = '';
  // Intentionally not awaited: renderLibrary() uses only app-locale renderlib_*
  // keys which exist in every locale file, so it is safe to render immediately
  // while the locale reload completes in the background. Awaiting here held the
  // Router._navigating lock across multiple XHR fetches, causing any Back press
  // during that window to be silently dropped, leaving sticky bars broken.
  clearStudyUiLangOverride();
  const libBtn = document.getElementById('navLibBtn');
  if (libBtn) { libBtn.innerHTML = ICONS.close; libBtn.onclick = () => Router.back(); }
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('header-title').innerText = t('studyloader_header_library');
  renderLibrary();
}

// Opens the shared Google Drive folder where .estudy files are hosted.
// On Android WebView, window.open with _blank may be blocked; using
// _system or a direct location change as fallback ensures it opens in
// the device's default browser rather than inside the WebView.
function openDriveStudyFolder() {
  const url = 'https://drive.google.com/drive/folders/1Twi4CoBcUtq9ISEhfK6IPD8x1Mx_Uglr?usp=sharing';
  const newWin = window.open(url, '_blank');
  if (!newWin || newWin.closed || typeof newWin.closed === 'undefined') {
    // WebView blocked window.open — navigate directly
    window.location.href = url;
  }
}

async function handleFileSelect(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    // Reset the input so selecting the same file again fires onchange
    event.target.value = '';
    if (files.length === 1) {
        await loadAnyFile(files[0]);
        return;
    }
    await _installMultipleFiles(files);
}

// Installs several picked files at once: studies quietly (mirroring
// loadBundleFromFile() — no activation, single summary toast), then any
// pathway files among them, then opens Library / All tab. Shared by the
// Library picker (handleFileSelect) and the study picker
// (handlePickerFileChange).
async function _installMultipleFiles(files) {
    const results = [];
    const pathwayTexts = [];
    showToast({ message: t('studyloader_bundle_installing', { count: files.length }), isManual: true });
    for (const file of files) {
        try {
            const text = await _readPathwayFileText(file);
            if (text !== null) { pathwayTexts.push(text); continue; }
            results.push(await _installStudyFileQuietly(file));
        } catch (err) {
            console.error(`Failed to install ${file.name}:`, err);
            recordError(err, { context: 'install-file', file: file.name });
            results.push({ status: 'failed', name: file.name, reason: err.message });
        }
    }
    await Router.navigate({ page: 'library' });
    switchLibTab('all');
    for (const text of pathwayTexts) await importPathwaysFromText(text);
    const { installed, allGood } = _summariseInstall(results);
    if (allGood) {
        showToast({ message: t('studyloader_bundle_success', { count: installed }), isManual: true });
    }
}

// Returns the text of a picked file if it is a plain-JSON pathway file, or
// null otherwise (zips and studies). Only the first bytes are read for zips.
async function _readPathwayFileText(file) {
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (head[0] === 0x50 && head[1] === 0x4B) return null;          // "PK" — a zip
    if (file.size > 4 * PATHWAY_FILE_MAX_BYTES) return null;         // far too big to be a pathway file
    const text = await file.text();
    return looksLikePathwayFile(text) ? text : null;
}

async function deleteStudy(id, title) {
    const { isConfirmed } = await Swal.fire({
      // Swal renders title as HTML — escape the study-supplied title.
      title: t('studyloader_delete_title', { title: escapeHtml(title) }),
      html:  t('studyloader_delete_body'),
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: t('studyloader_delete_confirm'),
      cancelButtonText:  t('studyloader_delete_cancel'),
      reverseButtons: true,
    });
    if (!isConfirmed) return;

    // 1. Remove from registry
    let registry = JSON.parse(localStorage.getItem('study_registry') || '[]');
    registry = registry.filter(item => item !== id);
    safeSetItem('study_registry', JSON.stringify(registry));

    // 2. Remove the study content, all stored images, and all answer data
    // (chapter answers, likert responses, star flags, celebration flags,
    // global notes, last position) from IDB. removeImagesByPrefix catches
    // both the fixed metadata images (cover, publisher, author) and any
    // inline chapter images ({id}_{elementId}) that are not individually
    // tracked. Without deleteStudyAnswers(), a deleted study's answers stay
    // orphaned in IDB forever and silently reappear if the same studyId is
    // ever reinstalled.
    try {
      await StudyIDB.remove(`study_content_${id}`);
      const others = siblingPrefixes(id, registry);
      await StudyIDB.removeImagesByPrefix(`${id}_`, others);
      await StudyIDB.deleteStudyAnswers(id, others);
    } catch (err) {
      if (err.name === 'IDBUnavailable') { showPickerError(t('error_idb_unavailable')); return; }
      throw err;
    }

    // 3. Remove from all library history lists
    removeStudyFromHistory(id);

    // 4. Remove all saved answers/stars for this study
    // This targets all keys starting with "bsr_[id]_"
    const prefix = `bsr_${id}_`;
    Object.keys(localStorage)
        .filter(key => key.startsWith(prefix))
        .forEach(key => localStorage.removeItem(key));


    // 5. If this study is currently open, reset the UI and theme
    if (window.activeStudyId === id) {
      window.activeStudyId = null;
      window.chapters = [];
      window.titlePageData = null;      // prevents stale title page render
      window.goDeeperData  = null;      // prevents stale go deeper menu entry
      window.lastPositionCache = null;  // prevents stale continue button
      window.studyMetadata = {};
      localStorage.removeItem('bsr_last_active_study');
      resetTheme();
      // Don't navigate to 'title' here — the library navigate below handles it.
      // Re-render the menu now so it reflects the empty state immediately.
      renderMenu();                     // clears the stale chapter list
    }

    // 6. Refresh the list
    invalidateCoverCache(id);
    Router.navigate({ page: 'library' });
    if (typeof showToast === 'function') showToast({ message: t('studyloader_delete_success'), isManual: true });
    id = null;
}

// ── JSON DATA LOADER ──────────────────────────────────────────────────────────
// On startup, no study is loaded. renderStudyPicker() shows a file-picker screen.
// When the user selects a .estudy file, loadStudyFromFile() reads it, assigns all
// globals, and calls initApp(). Subsequent calls (e.g. switching studies) can
// call loadStudyFromFile() directly.
//
// Structural notes:
//   • copyrightData  – JSON uses .copyright.statement; engine expects .authorLine.
//   • studyMetadata  – replaces titlePageData; .headerTitle derived from .title.
//   • studyOnboardingSlides – action.fn is null in JSON; restored via ACTION_FN_MAP.
// ─────────────────────────────────────────────────────────────────────────────

// Map of locale-independent action IDs → the engine function they should invoke.
// action.id is set in the .estudy file; label is purely cosmetic and never matched.
const ACTION_FN_MAP = {
  'settings': () => Router.navigate({ page: 'settings' }),
  'howto':    () => Router.navigate({ page: 'howto' }),
};

function resolveActionFn(action) {
  if (!action || typeof action.id !== 'string') return null;
  return ACTION_FN_MAP[action.id] ?? null;
}

function buildQaLookup() {
  // Builds the legacy qaCalloutsById lookup used by v1 .estudy files.
  // v2 files embed callout data directly in elements[] so this will be empty.
  window.qaCalloutsById = {};
  if (window.qaCallouts && Array.isArray(window.qaCallouts)) {
    window.qaCalloutsById = Object.fromEntries(
      window.qaCallouts.map(q => [q.calloutId, q])
    );
  }
}

// Resolves an image entry from imageData to a URL string suitable for img.src.
// Returns the blob URL set by loadStudyFromFile, or null if not present.
function resolveImageSrc(entry) {
  if (!entry) return null;
  if (entry.src) return entry.src;
  return null;
}

function applyImageData(imageData) {

  // ── cover image ──────────────────────────────────────────────────────────
  // Used in studyMetadata.image.src (title page cover photo)
  // Only overwrite if we have a freshly-resolved src AND titlePageData doesn't
  // already have one (applyStudyData resolves the cover from IDB before calling
  // us, so we must not clobber it with an empty result here).
  const coverSrc = resolveImageSrc(imageData.cover);
  if (coverSrc && window.titlePageData?.image) {
    window.titlePageData.image.src = coverSrc;
    window.titlePageData.image.alt = imageData.cover.alt || window.titlePageData.image.alt;
  }

  // ── publisher logo ───────────────────────────────────────────────────────
  // Stored on studyAboutData.publisher; renderTitlePage reads it from there directly.
  const publisherSrc = resolveImageSrc(imageData.publisher);
  if (publisherSrc && window.studyAboutData?.publisher) {
    window.studyAboutData.publisher.image  = publisherSrc;
    window.studyAboutData.publisher.logoAlt = imageData.publisher.alt || window.studyAboutData.publisher.logoAlt || '';
  }

  // ── author photo ─────────────────────────────────────────────────────────
  // Used in studyAboutData.author.image
  const authorSrc = resolveImageSrc(imageData.author);
  if (authorSrc && window.studyAboutData?.author) {
    window.studyAboutData.author.image = authorSrc;
    window.studyAboutData.author.imageAlt = imageData.author.alt || window.studyAboutData.author.imageAlt;
  }
}

// ── STUDY CONTENT SANITISATION ────────────────────────────────────────────────
// .estudy files may be authored by third parties, and most study strings are
// inserted into the page as HTML — many without passing through
// renderFormatted(). Rather than escaping at every one of those sites,
// sanitizeStudyData() cleans the whole study once, as applyStudyData() loads
// it, so everything downstream receives safe values:
//
//   • ID-like fields (elementId, repeatElement, calloutId, id, tabId, and the
//     language / languageN codes) are reduced to [A-Za-z0-9_.-]. They are
//     interpolated into inline handlers such as onclick="toggleStar(3, 'ID')",
//     where a quote would break out of the string. The replacement is
//     deterministic, so references between elements still match, and every
//     ID in the bundled studies is already in this form (unchanged by it).
//   • Every other string containing '<' is run through DOMPurify with
//     _LOAD_PURIFY_CONFIG (format-text.js), which keeps authored formatting
//     (<b>, tables, &ldquo; …) but removes scripts and event handlers.
//     Strings without '<' cannot introduce markup and are left untouched;
//     quote-breakout in attribute values is handled by escaping at those
//     attribute sites instead.
//
// Returns a cleaned deep copy; the stored study is not modified.
const _SAFE_ID_RE = /^[A-Za-z0-9_.-]+$/;
const _ID_KEY_RE  = /^(elementId|repeatElement|calloutId|id|tabId|language\d*)$/;

// Prefixes of other installed studies whose ids extend `id` + '_' (e.g. deleting
// "john" must not touch the data of "john_2"). Pass to the IDB prefix sweeps.
function siblingPrefixes(id, ids) {
  return (ids || []).filter(o => o !== id && o.startsWith(`${id}_`)).map(o => `${o}_`);
}

function isSafeStudyId(id) {
  return typeof id === 'string' && _SAFE_ID_RE.test(id);
}

function sanitizeStudyData(value, key = '') {
  // chapterNumber is interpolated into inline handlers and element ids, so it
  // must be a plain integer. Numeric strings ("3") are accepted; anything else
  // becomes 0 (which the chapter-list renderers then skip or show harmlessly).
  if (key === 'chapterNumber') {
    const n = typeof value === 'number' ? value : (typeof value === 'string' && /^\s*\d{1,6}\s*$/.test(value) ? Number(value) : NaN);
    return Number.isInteger(n) ? n : 0;
  }
  if (typeof value === 'string') {
    if (_ID_KEY_RE.test(key)) return value.replace(/[^A-Za-z0-9_.-]/g, '_');
    return value.includes('<') ? DOMPurify.sanitize(value, _LOAD_PURIFY_CONFIG) : value;
  }
  if (Array.isArray(value)) return value.map(item => sanitizeStudyData(item, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeStudyData(v, k);
    return out;
  }
  return value;
}

// ── ESTUDY FORMAT NORMALISATION HELPERS ──────────────────────────────────────
// The new .estudy format stores chapters as a flat elements[] array rather than
// the old nested {intro, sections[], closing, reflection[]} structure.
// These helpers reconstruct the old shape so all downstream functions
// (search, share, print, progress, starring) continue to work unchanged.

// Returns a plain string for a field that may be stored unnumbered (mono-lingual
// studies: el.question) or in numbered language slots (multilingual studies:
// el.question1/2/3), using slot 1. This is the language-independent default
// resolver for the helpers below; refreshChapterTextForLang() re-runs them
// with studyText() so the normalised text follows the reader's language.
function _plainField(el, field) {
  return el[field] ?? el[`${field}1`] ?? '';
}

// Returns the text of the first element with the given subtype.
function _extractTextBySubtype(elements, subtype, resolve = _plainField) {
  // Real studies use 'intro'/'closing'; the legacy names are 'chapterIntro'/'chapterClosing'.
  const alt = { chapterIntro: 'intro', chapterClosing: 'closing' }[subtype];
  const el = (elements || []).find(e => e.type === 'text' && (e.subtype === subtype || e.subtype === alt));
  return el ? resolve(el, 'text') : '';
}

// Returns an array of reflection question strings.
function _extractReflectionQuestions(elements, resolve = _plainField) {
  return (elements || [])
    .filter(e => e.type === 'question' && e.subtype === 'reflection' && !e.repeatElement)
    .map(e => resolve(e, 'question'));
}

// Reconstructs sections[] from the flat elements[].
// A new section starts at each bridge text element (or implicitly at the first
// biblePassage when there is no leading bridge). Questions are grouped under
// the most recently seen biblePassage reference.
function _buildSectionsFromElements(elements, resolve = _plainField) {
  const els = (elements || []).filter(e => !e.repeatElement);
  const sections = [];
  let currentSection = null;
  let lastRef = null;

  els.forEach(el => {
    if (el.type === 'text' && el.subtype === 'bridge') {
      currentSection = { bridge: resolve(el, 'text'), questions: [] };
      sections.push(currentSection);
      lastRef = null;
    } else if (el.type === 'biblePassage') {
      if (!currentSection) {
        currentSection = { questions: [] };
        sections.push(currentSection);
      }
      lastRef = el.bibleRef;
    } else if (el.type === 'question' && el.subtype !== 'reflection') {
      if (!currentSection) {
        currentSection = { questions: [] };
        sections.push(currentSection);
      }
      currentSection.questions.push({
        ref:       el.linkedPassage || lastRef || '',
        text:      resolve(el, 'question'),
        elementId: el.elementId,
      });
    }
  });

  return sections;
}

// The text fields of a normalised chapter (everything search, share, print
// and the starred lists read), resolved with the given resolver.
function _normalisedChapterText(ch, resolve = _plainField) {
  const title = resolve(ch, 'chapterTitle');
  return {
    chapterTitle: title,
    title,
    intro:      _extractTextBySubtype(ch.elements, 'chapterIntro', resolve),
    closing:    _extractTextBySubtype(ch.elements, 'chapterClosing', resolve),
    reflection: _extractReflectionQuestions(ch.elements, resolve),
    sections:   _buildSectionsFromElements(ch.elements, resolve),
  };
}

// Re-resolves every loaded chapter's normalised text for the reader's
// current study language (window._activeStudyLang). Called once the study's
// metadata is known in applyStudyData(), and again wherever the study
// language changes. Mutates the chapter objects in place so references held
// elsewhere stay valid. A no-op for mono-lingual studies in effect, since
// studyText() then returns the plain unnumbered fields.
function refreshChapterTextForLang() {
  (window.chapters || []).forEach(ch => Object.assign(ch, _normalisedChapterText(ch, studyText)));
}

// Assigns all globals from a parsed JSON data object and (re-)starts the app.
// ── THEME ─────────────────────────────────────────────────────────────────────
// The 19 CSS custom properties that make up a study's colour scheme.
// Keys match the property names in the .estudy "theme" block exactly.
const THEME_PROPS = [
  'surface', 'surface-mid', 'text', 'text-secondary', 'text-faint',
  'emphasis', 'emphasis-light', 'success', 'accent', 'accent-light',
  'border', 'shadow', 'card-bg', 'validate',
  'dm-base', 'dm-surface', 'dm-raised', 'dm-sunken', 'dm-border',
  'dm-text', 'dm-text-mid', 'dm-text-faint',
];

// Applies a study's theme block to the document's CSS custom properties.
// Unknown keys (e.g. "theme-annotation") are silently ignored.
// Called by applyStudyData() whenever a study is loaded or switched.
function applyTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;
  THEME_PROPS.forEach(prop => {
    if (theme[prop] !== undefined) {
      root.style.setProperty(`--${prop}`, theme[prop]);
    }
  });
}

// Removes all per-study theme overrides, restoring the :root CSS defaults.
// Called when a study is deleted and no replacement is active.
function resetTheme() {
  const root = document.documentElement;
  THEME_PROPS.forEach(prop => root.style.removeProperty(`--${prop}`));
}

// ── THEME SUSPENSION ──────────────────────────────────────────────────────────
// suspendStudyTheme() temporarily removes study colour overrides so app pages
// (Library, Settings/App, Settings/Library, HowTo non-Study tabs, Progress/
// Pathway, etc.) always display in the default colour scheme.
// restoreStudyTheme() reapplies them when returning to study-coloured pages.
// Both are no-ops when no study theme is active.
//
// _suspendedTheme is a module-level variable (not a DOM node property) so it
// is co-located with the functions that use it and visible to anyone reading
// this file. It is reset to {} by applyStudyData() on every study load.
let _suspendedTheme = {};

function suspendStudyTheme() {
  const root = document.documentElement;

  // Guard: if a theme is already suspended, don't overwrite the stash with an
  // empty object. This handles the case where suspendStudyTheme() is called
  // twice without an intervening restoreStudyTheme() (e.g. navigating from
  // Library to Settings via the nav button while a study theme is active).
  if (Object.keys(_suspendedTheme).length > 0) return;

  const saved = {};
  THEME_PROPS.forEach(prop => {
    const val = root.style.getPropertyValue(`--${prop}`);
    if (val) {
      saved[prop] = val;
      root.style.removeProperty(`--${prop}`);
    }
  });
  _suspendedTheme = saved;
}

function restoreStudyTheme() {
  const root = document.documentElement;
  if (Object.keys(_suspendedTheme).length > 0) {
    // Re-apply the suspended theme properties and clear the stash so the
    // next suspendStudyTheme() call can save a fresh snapshot.
    THEME_PROPS.forEach(prop => {
      if (_suspendedTheme[prop]) root.style.setProperty(`--${prop}`, _suspendedTheme[prop]);
    });
    _suspendedTheme = {};
  } else {
    // Nothing was suspended — re-apply directly from the loaded study theme
    const theme = window._loadedStudyTheme;
    if (theme) applyTheme(theme);
  }
}

async function applyStudyData(data, { isStudySwitch = false, silent = false } = {}) {
  // Clean all study strings before any of them reach the DOM (see
  // sanitizeStudyData() above).
  data = sanitizeStudyData(data);

  // Revoke any blob URLs created for the previous study before overwriting
  // state. This prevents blob URLs accumulating in memory across study switches.
  _revokeAllBlobUrls();

  // Record this study as recently opened every time it is applied — this covers
  // fresh loads, startup restore, and Android intent delivery, not just
  // activateStudy() (which only runs when switching between already-installed studies).
  const _appliedId = data.studyMetadata?.studyId;
  if (_appliedId) recordStudyOpened(_appliedId);

  // v2 .estudy files embed callouts directly in elements[] and omit these keys.
  // v1 files still carry them; buildQaLookup() handles both cases gracefully.
  window.qaCallouts       = data.qaCallouts       || [];
  buildQaLookup();

  // Normalise chapters: map new .estudy field names (chapterTitle, chapterNumber,
  // flat elements[]) to the shape the engine expects (title, num, sections[], etc.)
  // Text fields are resolved for the reader's language by
  // refreshChapterTextForLang() below, once window.studyMetadata is set.
  window.chapters = (data.chapters || []).map(ch => ({
    ...ch,
    num:        ch.chapterNumber,
  }));

  // ── Expose studyMetadata globally ─────────────────────────────────────────
  // render-elements.js, modals.js, render-library.js, and render-chapter-ui.js
  // all read window.studyMetadata to build the language-slot map and to resolve
  // numbered metadata fields (title1/2/3, subtitle1/2/3, shortTitle1/2/3).
  const metadata = data.studyMetadata || {};
  window.studyMetadata = metadata;
  refreshChapterTextForLang();

  // ── Build the language-slot map once ──────────────────────────────────────
  // { ha: 1, ff: 2, en: 3 } — used for all metadata and slide field resolution
  // below. Identical logic to buildLangMap() in render-elements.js; duplicated
  // here so study-loader.js carries no dependency on render-elements.js.
  const _langMap = {};
  for (let i = 1; ; i++) {
    const code = metadata[`language${i}`];
    if (!code) break;
    _langMap[code] = i;
  }

  // ── Resolve active language for metadata fields ────────────────────────────
  // Use the session preference if it maps to a valid slot, otherwise slot 1.
  const _activeLang   = window._activeStudyLang || '';
  const _activeSlot   = _langMap[_activeLang] || 1;
  const _isMultilang  = Object.keys(_langMap).length > 0;

  // ── Helper: resolve a numbered field on any plain object ───────────────────
  // Priority (multilingual):
  //   1. obj[field + activeSlot]   — active language
  //   2. obj[field + '1']          — slot-1 fallback
  //   3. obj[field]                — unnumbered (mono-lingual)
  //   4. fallback string
  // For mono-lingual studies (no languageN keys) falls straight through to
  // the unnumbered field, preserving full backward compatibility.
  // Used below for studyMetadata fields, onboarding slide fields, and slide
  // action labels — all three previously wrote out this exact same algorithm
  // separately.
  function _resolveNumberedField(obj, field, fallback = '') {
    if (_isMultilang) {
      return obj[`${field}${_activeSlot}`]
          || obj[`${field}1`]
          || obj[field]
          || fallback;
    }
    return obj[field] || fallback;
  }

  // ── Normalise title / subtitle / shortTitle onto studyMetadata ────────────
  // Downstream code (library, chapter nav, header) reads the plain unnumbered
  // fields. We resolve once here and write them back onto window.studyMetadata
  // so nothing else needs to know about the numbered schema.
  //
  // shortTitle priority: shortTitle1 > shortTitle (unnumbered) > title slot > 'Study'
  const resolvedTitle    = _resolveNumberedField(metadata, 'title',    'Untitled Study');
  const resolvedSubtitle = _resolveNumberedField(metadata, 'subtitle', '');
  const resolvedShortTitle = (() => {
    // shortTitle1 always wins when present (multilingual canonical).
    if (_isMultilang && metadata.shortTitle1) {
      return metadata[`shortTitle${_activeSlot}`] || metadata.shortTitle1;
    }
    // Unnumbered shortTitle is present (legacy or English-only slot).
    if (metadata.shortTitle) return metadata.shortTitle;
    // Fall back to resolved title.
    return resolvedTitle || 'Study';
  })();

  // Write resolved plain fields back so all downstream readers get correct values.
  window.studyMetadata.title    = resolvedTitle;
  window.studyMetadata.subtitle = resolvedSubtitle;

  // ── Resolve onboarding slides ──────────────────────────────────────────────
  // Slides from multilingual estudies store eyebrow/heading/body/bodyAfter as
  // numbered fields (eyebrow1/2/3, heading1/2/3, body1/2/3, bodyAfter1/2/3)
  // and action.label as label1/label2/label3.
  // We resolve every field to a plain string here, at load time, so
  // showSlideOverlay() can stay format-agnostic (it always reads s.eyebrow etc).
  // Mono-lingual slides already carry plain unnumbered fields —
  // _resolveNumberedField logic is applied per-field so both shapes work
  // transparently.
  studyOnboardingSlides = (data.studyOnboardingSlides || []).map(slide => {
    const resolved = {
      ...slide,
      eyebrow:   _resolveNumberedField(slide, 'eyebrow'),
      heading:   _resolveNumberedField(slide, 'heading'),
      body:      _resolveNumberedField(slide, 'body'),
      bodyAfter: _resolveNumberedField(slide, 'bodyAfter'),
    };

    // Resolve action if present.
    if (slide.action) {
      // label is now numbered (label1/label2/label3); fall back to plain label.
      resolved.action = {
        label: _resolveNumberedField(slide.action, 'label'),
        fn:    slide.action.fn === null ? resolveActionFn(slide.action) : slide.action.fn,
      };
    }

    return resolved;
  });

  // ── Resolve cover image ────────────────────────────────────────────────────
  // 1. Prefer a blob URL already attached in-session (zip just loaded).
  // 2. Fall back to the IDB image store (survives page reloads).
  // 3. Fall back to legacy base64 embedded in data.imageData.
  // URL.createObjectURL() is used instead of FileReader.readAsDataURL() to
  // avoid the ~33% base64 inflation. The resulting blob URL is registered via
  // _createBlobUrl() so _revokeAllBlobUrls() cleans it up on the next study
  // switch (called at the top of applyStudyData()).
  let coverSrc = resolveImageSrc(data.imageData?.cover) || '';
  if (!coverSrc && _appliedId) {
    try {
      const coverBlob = await StudyIDB.getImage(`${_appliedId}_cover`);
      if (coverBlob) {
        coverSrc = _createBlobUrl(coverBlob);
      }
    } catch (e) {
      console.warn('applyStudyData: could not load cover from IDB', e);
    }
  }

  // ── Resolve publisher and author images ───────────────────────────────────
  // Same three-step priority as cover. Blob URLs attached by loadStudyFromFile
  // are used on first load; IDB is the fallback on reload.
  for (const name of ['publisher', 'author']) {
    if (data.imageData?.[name] && !resolveImageSrc(data.imageData[name]) && _appliedId) {
      try {
        const blob = await StudyIDB.getImage(`${_appliedId}_${name}`);
        if (blob) data.imageData[name].src = _createBlobUrl(blob);
      } catch (e) {
        console.warn(`applyStudyData: could not load ${name} image from IDB`, e);
      }
    }
  }

  window.titlePageData = {
    ...metadata,
    // Expose resolved plain fields so all title-page renderers work without
    // knowing about the numbered schema.
    title:       resolvedTitle,
    subtitle:    resolvedSubtitle,
    headerTitle: resolvedShortTitle,
    image: {
        src:           coverSrc,
        alt:           data.imageData?.cover?.alt || '',
        fallbackEmoji: data.imageData?.cover?.fallback || '📖',
    },
  };

  window.howToUseData     = data.howToUseData     || {};
  window.leadersNotesData = data.leadersNotesData || {};
  window.goDeeperData     = data.goDeeperData     || null;
  window.studyAboutData   = data.studyAboutData   || {};

  // ── Apply publisher and author images ─────────────────────────────────────
  // Must run after window.titlePageData and window.studyAboutData are set,
  // since applyImageData writes into both. Cover is already resolved above
  // and set directly into titlePageData.image.src, so applyImageData's cover
  // guard (only overwrites if src is present) will not clobber it.
  if (data.imageData) applyImageData(data.imageData);
  
  window.copyrightData = {
    ...(data.copyrightData || {}),
    authorLine: (data.copyrightData && data.copyrightData.copyright)
      ? data.copyrightData.copyright.statement
      : '',
  };
  
  // Apply study theme (colour scheme) to CSS custom properties
  applyTheme(data.theme);
  window._loadedStudyTheme = data.theme || null;
  _suspendedTheme = {};  // clear any stale suspension state from the previous study

  window.verseData = {}; // populated by renderChapter() from biblePassage elements

  // Populate the synchronous last-position cache so renderTitlePage() can read
  // it without awaiting. Must run before initApp() which calls renderTitlePage().
  window.lastPositionCache = null;
  if (appSettings.rememberPosition && window.activeStudyId) {
    try {
      const raw = await StudyIDB.getAnswerRaw(lastPositionIDBKey(window.activeStudyId));
      window.lastPositionCache = raw ? JSON.parse(raw) : null;
    } catch (e) {
      window.lastPositionCache = null;
    }
  }

  if (!silent) await initApp({ isStudySwitch });
} // end applyStudyData

// Activates a study that has just been installed/verified-current if the app
// has finished starting up, or defers it via window.pendingStudyData for
// startApp() to pick up otherwise — the same pattern loadStudyFromJson() uses
// (see below). Needed because loadStudyFromFile() — and transitively
// loadStudyFromBase64()/loadAnyFile(), the Android bridge's file-open entry
// point — can be invoked before DOMContentLoaded has fired. Without this
// guard, applying the study immediately would render before locale/settings
// have loaded (showing raw i18n keys), and startApp() would later re-apply
// the same pendingStudyData-less study a second time via its own routing,
// causing a redundant re-render. checkEstudyVersion() only runs on the
// immediate-activation path — like loadStudyFromJson(), it's skipped on the
// deferred path since it depends on window.appAboutData, which isn't loaded
// yet either.
async function _activateOrDeferStudy(studyId, data, { checkVersion = false } = {}) {
  if (studyId) window.activeStudyId = studyId;
  if (window._appReady) {
    if (checkVersion) checkEstudyVersion(data);
    await Router.navigate({ page: 'library' });
    await applyStudyData(data, { isStudySwitch: true });
  } else {
    window.pendingStudyData = data;
  }
}

// wrapper to parse string handed over from Android
// Called by the Android WebView bridge when the user opens a .estudy file.
// This may be called BEFORE or AFTER DOMContentLoaded fires, so we handle both:
//   • Before: store on window.pendingStudyData; startApp() will pick it up.
//   • After:  apply immediately and save to IDB so it survives restarts.
async function loadStudyFromJson(jsonString) {
    try {
        const data = JSON.parse(jsonString);

        // Always persist to IDB so the study is available on next launch
        // and so startApp() can find it even if it runs after this call.
        const studyId = data.studyMetadata && data.studyMetadata.studyId;
        // studyId is used in IDB keys and in inline handlers
        // (activateStudy('ID')), so only plain [A-Za-z0-9_.-] IDs are accepted.
        if (!isSafeStudyId(studyId)) {
            // alert() is blocked or unstyled on Android WebView — use the
            // same safe fallback chain as showPickerError().
            showPickerError(t('studyloader_error_no_study_id', { filename: 'JSON' }));
            return;
        }

        // Version check (user-initiated path — Android intent delivery is always
        // user-initiated: the user tapped "Open with" or shared a file).
        const _decision = await _resolveUserInstall(data, studyId);
        if (_decision.action === 'stop') return;
        if (_decision.action === 'open-existing') {
            window.activeStudyId = studyId;
            if (window._appReady) { await Router.navigate({ page: 'library' }); await applyStudyData(_decision.existing, { isStudySwitch: true }); }
            return;
        }
        _announceUpdate(data, studyId, _decision);

        try {
          await StudyIDB.set(`study_content_${studyId}`, data);
        } catch (err) {
          if (err.name === 'IDBUnavailable') {
            showPickerError(t('error_idb_unavailable'));
            return;
          }
          throw err;
        }

        let registry = JSON.parse(localStorage.getItem('study_registry') || '[]');
        if (!registry.includes(studyId)) {
            registry.push(studyId);
            safeSetItem('study_registry', JSON.stringify(registry));
        }
        safeSetItem('bsr_last_active_study', studyId);
        recordStudyInstalled(studyId); // ← track in Recently Installed
        // Record the installed studyVersion so future loads can compare against it.
        _setInstalledStudyVersion(studyId, data.studyMetadata?.studyVersion);

        // If the app is already initialised (DOMContentLoaded has fired),
        // apply immediately. Otherwise stash for startApp() to pick up.
        if (window._appReady) {
            window.activeStudyId = studyId;
            checkEstudyVersion(data);
            await Router.navigate({ page: 'library' });
            await applyStudyData(data, { isStudySwitch: true });
        } else {
            window.pendingStudyData = data;
            window.activeStudyId   = studyId;
        }
    } catch(e) {
        // alert() is blocked or unstyled on Android WebView — this function is
        // called directly from Kotlin via the JS bridge, so showPickerError()'s
        // safe fallback chain (Swal → toast → static HTML) is used instead.
        _reportLoadError(e, 'JSON', 'load-json');
    }
}

// Called by Kotlin when a file is opened externally on Android (via intent).
// Receives the file as a base64 string (safe across the JS bridge for both
// plain-JSON .estudy, ZIP-format .estudy, and bundle .zip files).
// Routes through loadAnyFile() — the single entry point that correctly
// distinguishes bundle zips (containing .estudy files), single-study zips,
// and plain-JSON .estudy files. Previously this called loadStudyFromFile()
// directly, which skipped bundle-zip detection and caused silent failures
// when a bundle .zip was opened via "Open with app" from Google Drive.
async function loadStudyFromBase64(base64String) {
    try {
        // Decode base64 to a Uint8Array
        const binaryStr = atob(base64String);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }
        // Wrap in a File object so loadAnyFile() can call .arrayBuffer()
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const file = new File([blob], 'incoming.estudy', { type: 'application/octet-stream' });
        // Use loadAnyFile (not loadStudyFromFile) so bundle zips are handled
        await loadAnyFile(file);
    } catch (e) {
        _reportLoadError(e, 'incoming.estudy', 'load-base64');
    }
}

// ── ZIP LIMITS ────────────────────────────────────────────────────────────────
// Every zip the user opens (.estudy, bundle, nested .estudy inside a bundle)
// is checked before any entry is read, so a hostile archive can't exhaust
// memory or storage ("zip bomb") or smuggle in path-traversal names.
// Sizes are the ones declared in the zip's central directory (JSZip's
// _data.uncompressedSize / compressedSize); a lying archive then fails JSZip's
// own read, and every read result is also checked against ZIP_MAX_ENTRY_BYTES.
const ZIP_MAX_ENTRIES       = 200;
const ZIP_MAX_ENTRY_BYTES   = 25  * 1024 * 1024;
const ZIP_MAX_TOTAL_BYTES   = 150 * 1024 * 1024;
const ZIP_MAX_RATIO         = 100;               // uncompressed : compressed
const ZIP_RATIO_MIN_BYTES   = 1024 * 1024;       // ignore the ratio for tiny entries

function _checkZipLimits(zip) {
  const entries = Object.values(zip.files);
  if (entries.length > ZIP_MAX_ENTRIES) throw new Error(t('studyloader_zip_too_many', { max: ZIP_MAX_ENTRIES }));
  let total = 0;
  for (const entry of entries) {
    const name = entry.name;
    if (name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) {
      throw new Error(t('studyloader_zip_bad_entry'));
    }
    if (entry.dir) continue;
    const size       = (entry._data && entry._data.uncompressedSize) || 0;
    const compressed = (entry._data && entry._data.compressedSize) || 0;
    total += size;
    if (size > ZIP_MAX_ENTRY_BYTES || total > ZIP_MAX_TOTAL_BYTES ||
        (size > ZIP_RATIO_MIN_BYTES && size > compressed * ZIP_MAX_RATIO)) {
      throw new Error(t('studyloader_zip_too_large'));
    }
  }
}

// Reads a zip entry and enforces ZIP_MAX_ENTRY_BYTES on the actual result,
// in case the declared size in the archive was false.
async function _readZipEntry(entry, type) {
  const data = await entry.async(type);
  const size = typeof data === 'string' ? data.length : (data.size ?? data.byteLength ?? 0);
  if (size > ZIP_MAX_ENTRY_BYTES) throw new Error(t('studyloader_zip_too_large'));
  return data;
}

// ── FILE LOADING ROUTER ───────────────────────────────────────────────────────
// loadAnyFile() is the single entry point for all file imports. It detects
// whether the file is a bundle zip (containing .estudy files), a single zip
// .estudy, or a plain-JSON .estudy, and routes accordingly.

async function loadAnyFile(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    let zip;
    try {
      zip = await JSZip.loadAsync(arrayBuffer);
    } catch (_) {
      zip = null; // not a zip at all — must be a plain-JSON .estudy
    }

    if (zip) {
      _checkZipLimits(zip);
      // A bundle zip contains multiple study files — either .estudy or .zip entries.
      // A single-study zip contains study.json directly (no inner study files).
      // Either kind of bundle may also carry pathways.json at its root (see
      // pathways-import.js).
      const innerStudyFiles = Object.values(zip.files)
        .filter(f => !f.dir && (f.name.endsWith('.estudy') || f.name.endsWith('.zip')));

      const hasSingleStudyJson = Object.keys(zip.files)
        .some(name => name.endsWith('study.json'));
      const pathwaysEntry = zip.file('pathways.json');

      if (innerStudyFiles.length > 0 && !hasSingleStudyJson) {
        // ── Bundle: zip containing multiple .estudy or .zip study files ──────
        await loadBundleFromFile(zip, innerStudyFiles, pathwaysEntry);
      } else if (pathwaysEntry && !hasSingleStudyJson) {
        // ── Zip holding only pathways.json ───────────────────────────────────
        await importPathwaysFromText(await _readZipEntry(pathwaysEntry, 'string'));
      } else {
        // ── Single zip-format .estudy (contains study.json directly) ─────────
        await loadStudyFromFile(file);
      }
    } else {
      // ── Plain JSON: a .epathway pathway file or a legacy .estudy ─────────────
      // Pathway files are detected first so they aren't misrouted to the study
      // loader (which would report a missing studyId).
      const text = new TextDecoder().decode(arrayBuffer);
      if (looksLikePathwayFile(text)) {
        await importPathwaysFromText(text);
      } else {
        await loadStudyFromFile(file);
      }
    }
  } catch (err) {
    _reportLoadError(err, file.name, 'load-file');
  }
}

// Distinguishes "the bundled-studies asset simply isn't present in this
// build" from a genuine fetch failure — see installDefaultStudiesIfNeeded()
// below, which is the only place this is used.
class _DefaultStudiesAssetMissing extends Error {}

// ── DEFAULT STUDIES INSTALLER ─────────────────────────────────────────────────
// Fetches estudy/firstEstudies.zip on the very first run (flag:
// 'default_studies_installed') and installs all .estudy files found inside it.
// Runs silently — no progress toasts — so startup feels clean.
// On any failure, shows a single toast and continues without throwing.
//
// Called from app-init.js before the startup routing decision, so studies are
// present in the registry by the time the library is first rendered.
//
// estudy/firstEstudies.zip is not tracked in this app's own source files —
// it's expected to be dropped into the build/release output separately (see
// the "DEFAULT STUDIES INSTALLER" discussion elsewhere). That means a missing
// file (404) is a normal, expected state in some environments (e.g. a local
// dev server, or a build the asset hasn't been added to yet) — not a bug —
// so it's handled quietly below: a soft console note, no toast, no red
// console error, and no flag set (so a later launch against a build that does
// have the file will still pick it up). Any other failure — a network error,
// or the file existing but being corrupt/unreadable — is a genuine problem
// and still surfaces the toast + console.error as before.
async function installDefaultStudiesIfNeeded() {
  const currentVersion = window.appAboutData?.appVersion || '0';
  if (localStorage.getItem('default_studies_installed') === currentVersion) return;

  let arrayBuffer;
  try {
    // Use XHR instead of fetch — fetch('file://...') is blocked in Android WebView.
    // XHR with responseType='arraybuffer' works correctly under both file:// and
    // custom-scheme WebView origins.
    arrayBuffer = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'estudy/firstEstudies.zip', true);
      xhr.responseType = 'arraybuffer';
      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 0) {
          // status 0 is normal for successful file:// XHR requests
          resolve(xhr.response);
        } else if (xhr.status === 404) {
          reject(new _DefaultStudiesAssetMissing());
        } else {
          reject(new Error(`XHR status ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('XHR network error'));
      xhr.send();
    });
  } catch (err) {
    if (err instanceof _DefaultStudiesAssetMissing) {
      console.info('[defaultStudies] estudy/firstEstudies.zip not found in this build — skipping bundled studies install.');
    } else {
      console.error('[defaultStudies] installDefaultStudiesIfNeeded failed to fetch bundle:', err);
      showToast({ message: t('studyloader_default_studies_error'), isManual: true });
    }
    // Either way, do NOT set the flag — allow a retry on next launch, since
    // both a transient network error and "this build doesn't have the file
    // yet" can resolve themselves by the next launch.
    return;
  }

  try {
    const outerZip = await JSZip.loadAsync(arrayBuffer);

    // Collect all .estudy entries inside the bundle zip
    const innerEstudyFiles = Object.values(outerZip.files)
      .filter(f => !f.dir && f.name.endsWith('.estudy'));

    if (innerEstudyFiles.length === 0) {
      console.warn('[defaultStudies] firstEstudies.zip contains no .estudy files');
      return;
    }

    // Install each .estudy silently. Extract as ArrayBuffer directly from the
    // outer zip and pass it straight to _installStudyFileQuietly — bypassing
    // the File/Blob constructor round-trip that corrupts binary data in some
    // Android WebViews.
    for (const entry of innerEstudyFiles) {
        try {
            const arrayBuf = await entry.async('arraybuffer');
            await _installStudyFileQuietly(arrayBuf, entry.name);
        } catch (entryErr) {
            console.error('[defaultStudies] Failed to install', entry.name, entryErr);
        }
    }

    safeSetItem('default_studies_installed', currentVersion);

  } catch (err) {
    console.error('[defaultStudies] installDefaultStudiesIfNeeded failed:', err);
    showToast({ message: t('studyloader_default_studies_error'), isManual: true });
    // Do NOT set the flag — allow a retry on next launch in case it was transient.
  }
}

// ── STUDY VERSION HELPERS ─────────────────────────────────────────────────────
// Per-study version tracking used to guard manual-load paths against accidental
// downgrades. Keys live in localStorage under 'bsr_studyver_{studyId}'.
//
// Only the manual-load paths (loadStudyFromFile, loadStudyFromJson) need this —
// the bundled install path (installDefaultStudiesIfNeeded) is already gated by
// the app-version flag 'default_studies_installed', which changes on every app
// update, so the bundle is always re-evaluated and newer studies always win.
//
// studyVersion is compared as a DECIMAL NUMBER: 1.1 and 1.10 are the same
// version, and both come after 1.09. Authors keep to two decimal places
// (1.01, 1.02 ... 1.09, 1.10), so the order is always the obvious one. A version
// that does not start with a number counts as 0, and so does a study with no
// studyVersion at all, so any file that has one is newer.

function _versionString(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function _versionNumber(v) {
  const n = parseFloat(_versionString(v));
  return Number.isNaN(n) ? 0 : n;
}

// -1 if a is older than b, 0 if equal, 1 if newer.
function compareStudyVersions(a, b) {
  const x = _versionNumber(a), y = _versionNumber(b);
  return x === y ? 0 : (x < y ? -1 : 1);
}

// The version recorded when a study was installed, exactly as written ('' if none).
// Older app versions recorded a number, which reads back the same way.
function _installedStudyVersionRaw(studyId) {
  const stored = localStorage.getItem(`bsr_studyver_${studyId}`);
  return stored === null ? '' : stored.trim();
}

// Numeric form, kept for callers that only need "is there a record".
function _getInstalledStudyVersion(studyId) {
  return parseFloat(_installedStudyVersionRaw(studyId)) || 0;
}

// Records the version as written. An empty version removes the record, so a
// study that no longer carries one is not held to an old number.
function _setInstalledStudyVersion(studyId, version) {
  const raw = _versionString(version);
  if (raw) safeSetItem(`bsr_studyver_${studyId}`, raw);
  else localStorage.removeItem(`bsr_studyver_${studyId}`);
}

// Decides, for the SILENT installers (bundled studies), whether an incoming
// file should be installed. Returns:
//   'install'          — incoming is newer, or nothing is recorded for this study.
//   'skip'             — same version or older (silent paths show nothing).
//   'downgrade-blocked'— older, and isUserInitiated (kept for callers that ask).
// User-opened files go through _resolveUserInstall() instead, which asks.
function _shouldInstallStudy(incomingData, { isUserInitiated = false } = {}) {
  const studyId   = incomingData.studyMetadata?.studyId;
  const incoming  = _versionString(incomingData.studyMetadata?.studyVersion);
  const installed = studyId ? _installedStudyVersionRaw(studyId) : '';
  if (!installed) return 'install';
  const c = compareStudyVersions(incoming, installed);
  if (c > 0) return 'install';
  if (c < 0) return isUserInitiated ? 'downgrade-blocked' : 'skip';
  return 'skip';
}

// ── USER-OPENED FILES: ASK, DO NOT GUESS ─────────────────────────────────────
// A file the reader opened themselves is compared with the copy they already
// have. Newer installs. Same or older used to be handled silently (the old copy
// opened, or a three-second toast said "older"), which looked like a failure.
// Now a dialog that stays until answered gives both version numbers and the
// choice. A study that is not installed (never was, or was deleted) simply
// installs, whatever its version.
//
// The version of the copy they have is read from the saved study itself, which
// is the truth; the recorded number is only a fallback.

const _VERSION_DEFAULTS = {
  same_title:  'You already have this version',
  older_title: 'This file is older than the one you have',
  same_body:   '{title}: you have v{installed}, and this file is also v{incoming}. If you were expecting changes, ask whoever gave you the file for a newer version.',
  older_body:  '{title}: you have v{installed}, but this file is v{incoming}, which is older. Keeping the version you have is usually right.',
  keep:        'Keep what I have',
  install:     'Install this file anyway',
};

// Resolves 'keep' or 'install'. Never left hanging: if something replaces the
// dialog, the answer is 'keep', the safe choice.
function _askVersionConflict({ kind, title, installed, incoming }) {
  return new Promise(resolve => {
    const vars = { title, installed, incoming };
    showErrorDialog({
      title:   _er(`versioncheck_${kind}_title`, _VERSION_DEFAULTS[`${kind}_title`]),
      message: _er(`versioncheck_${kind}_body`, _VERSION_DEFAULTS[`${kind}_body`], vars),
      actions: [
        { label: _er('versioncheck_install_anyway', _VERSION_DEFAULTS.install), onClick: () => resolve('install') },
        { label: _er('versioncheck_keep', _VERSION_DEFAULTS.keep), primary: true, onClick: () => resolve('keep') },
      ],
      onCancel: () => resolve('keep'),
    });
  });
}

// Returns { action, existing?, installed? }:
//   'install'       go ahead (installed = the version being replaced, if any)
//   'open-existing' the reader chose to keep their copy: open it instead
//   'stop'          storage is unavailable; the error has been shown
async function _resolveUserInstall(data, studyId) {
  let existing;
  try {
    existing = await StudyIDB.get(`study_content_${studyId}`);
  } catch (err) {
    if (err.name === 'IDBUnavailable') { showPickerError(t('error_idb_unavailable')); return { action: 'stop' }; }
    throw err;
  }
  if (!existing) return { action: 'install' };

  const meta      = data.studyMetadata || {};
  const incoming  = _versionString(meta.studyVersion);
  const installed = _versionString(existing.studyMetadata?.studyVersion) || _installedStudyVersionRaw(studyId);
  if (!incoming && !installed) return { action: 'install' };       // neither is versioned: the new file replaces

  const c = compareStudyVersions(incoming, installed);
  if (c > 0) return { action: 'install', installed };

  const title  = meta.title || meta.title1 || studyId;
  const choice = await _askVersionConflict({ kind: c === 0 ? 'same' : 'older', title, installed: installed || '0', incoming: incoming || '0' });
  return choice === 'install' ? { action: 'install', installed } : { action: 'open-existing', existing };
}

// "Updating X to vN…" when a file replaces an installed copy.
function _announceUpdate(data, studyId, decision) {
  if (!decision.installed) return;
  const meta = data.studyMetadata || {};
  showToast({
    message:  t('studyloader_version_updating', { title: meta.title || studyId, version: _versionString(meta.studyVersion) }),
    isManual: true,
  });
}

// Describes what _installStudyFileQuietly() did, so callers that tell the
// reader (multi-file picks, bundles) can say more than "failed: 1".
//   status: 'installed' | 'updated' | 'unchanged' (same version already there)
//         | 'older' (file is older than the installed version) | 'failed'
function _quietInstallResult(status, data, studyId, name, extra = {}) {
  const meta = (data && data.studyMetadata) || {};
  return {
    status, name, studyId,
    title:   meta.title || studyId || name,
    version: _versionString(meta.studyVersion),
    ...extra,
  };
}

// Result for a file that was skipped because an equal-or-newer version is already installed.
function _quietSkipResult(data, studyId, name) {
  const installed = _installedStudyVersionRaw(studyId);
  const incoming  = _versionString(data.studyMetadata?.studyVersion);
  return _quietInstallResult(compareStudyVersions(incoming, installed) < 0 ? 'older' : 'unchanged', data, studyId, name, { installed });
}

// Installs a single .estudy File object into IDB and the registry without
// activating it or touching the UI. Returns a result object (see
// _quietInstallResult); the bundled-studies installer ignores it.  Used by installDefaultStudiesIfNeeded()
// so the default studies land silently in the background.
//
// Supports both zip-format .estudy (study.json + images/) and legacy plain-JSON.
async function _installStudyFileQuietly(file, fileName) {
  // Accept either a File object or a raw ArrayBuffer (from bundle extraction).
  const name = fileName || file.name || 'unknown';
  let zip;
  try {
    const arrayBuffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
    zip = await JSZip.loadAsync(arrayBuffer);
  } catch (_) {
    zip = null;
  }
  if (zip) _checkZipLimits(zip);

  if (zip) {
    // ── Zip-format .estudy ──────────────────────────────────────────────────
    // Look for study.json first (canonical name), then fall back to any root-level
    // JSON file — older .estudy files use custom names like 'truth_unlocked_en_study.json'.
    const jsonFile = zip.file('study.json') ||
      Object.values(zip.files).find(f => !f.dir && f.name.endsWith('.json') && !f.name.includes('/'));
    if (!jsonFile) {
      console.warn('[defaultStudies] Skipping', name, '— no JSON file found inside');
      return _quietInstallResult('failed', null, '', name, { reason: 'no_study_json' });
    }

    const jsonString = await _readZipEntry(jsonFile, 'string');
    const data       = JSON.parse(jsonString);
    const studyId    = data.studyMetadata?.studyId;
    if (!isSafeStudyId(studyId)) {
      console.warn('[defaultStudies] Skipping', name, '— missing or invalid studyMetadata.studyId');
      return _quietInstallResult('failed', data, '', name, { reason: 'no_study_id' });
    }

    // Version check: skip silently if an equal-or-newer version is already installed —
    // *provided the content is actually still there*. deleteStudy() intentionally
    // leaves the bsr_studyver_{id} version record in place, so a deleted-then-
    // reprocessed bundled study would otherwise be skipped forever even though its
    // IDB content is gone (mirrors the same check in loadStudyFromJson()).
    // isUserInitiated is false here — this path is only reached from the bundled
    // installer, which uses the app-version flag as its primary gate.
    const priorVersion = _installedStudyVersionRaw(studyId);
    if (_shouldInstallStudy(data, { isUserInitiated: false }) === 'skip') {
      const existing = await StudyIDB.get(`study_content_${studyId}`);
      if (existing) {
        console.log('[defaultStudies] Skipping', studyId, '— installed version is current or newer');
        return _quietSkipResult(data, studyId, name);
      }
      console.log('[defaultStudies] Version record says skip but content is missing for', studyId, '— reinstalling.');
    }

    // Store images in IDB.
    // IDBUnavailable is re-thrown here rather than calling showPickerError —
    // _installStudyFileQuietly runs during installDefaultStudiesIfNeeded() at
    // startup, before renderStudyPicker() has ever run, so #studyPickerError
    // is never in the DOM at this point. Any IDBUnavailable error propagates
    // to the caller's catch block (installDefaultStudiesIfNeeded), which shows
    // a toast and logs to console — the appropriate surface for a startup failure.
    // Images and content are written before the registry entry, so a failure
    // part-way (bad entry, storage quota, …) would leave orphaned images. For a
    // study that wasn't already installed, remove whatever was written; an
    // existing install keeps its (possibly partly refreshed) data.
    const wasInstalled = !!(await StudyIDB.get(`study_content_${studyId}`));
    // Exact keys written, so cleanup can't touch another study whose ID
    // merely starts with this one (a prefix delete would).
    const writtenImageKeys = [];
    try {
      const imageNames = ['cover', 'publisher', 'author'];
      for (const name of imageNames) {
        const entry = zip.file(`images/${name}.webp`);
        if (entry) {
          const blob = await _readZipEntry(entry, 'blob');
          writtenImageKeys.push(`${studyId}_${name}`);
          await StudyIDB.setImage(`${studyId}_${name}`, blob);
        }
      }

      // Store chapter images
      for (const ch of (data.chapters || [])) {
        for (const el of (ch.elements || [])) {
          if (el.type === 'image' && !el.src) {
            const entry = zip.file(`images/${el.elementId}.webp`);
            if (entry) {
              const blob = await _readZipEntry(entry, 'blob');
              writtenImageKeys.push(`${studyId}_${el.elementId}`);
              await StudyIDB.setImage(`${studyId}_${el.elementId}`, blob);
            }
          }
        }
      }

      // Gallery images referenced by src in goDeeperData / leadersNotesData
      await storeGalleryImages(zip, data, studyId, key => writtenImageKeys.push(key));

      // Persist study data and register
      await StudyIDB.set(`study_content_${studyId}`, data);
    } catch (err) {
      if (!wasInstalled) {
        for (const key of writtenImageKeys) await StudyIDB.removeImage(key).catch(() => {});
        await StudyIDB.remove(`study_content_${studyId}`).catch(() => {});
      }
      throw err;
    }
    const registry = JSON.parse(localStorage.getItem('study_registry') || '[]');
    if (!registry.includes(studyId)) {
      registry.push(studyId);
      safeSetItem('study_registry', JSON.stringify(registry));
    }
    // Record the installed studyVersion so future installs can compare against it.
    const installedVer = _versionString(data.studyMetadata?.studyVersion);
    _setInstalledStudyVersion(studyId, installedVer);
    // recordStudyInstalled is intentionally omitted — these are pre-installed,
    // not user-installed, and shouldn't pollute the Recently Installed list.
    return _quietInstallResult(priorVersion && compareStudyVersions(installedVer, priorVersion) > 0 ? 'updated' : 'installed', data, studyId, name);

  } else {
    // ── Legacy plain-JSON .estudy ───────────────────────────────────────────
    // `file` is a raw ArrayBuffer when called from the bundled installer
    // (installDefaultStudiesIfNeeded) — ArrayBuffer has no .text() method.
    const text    = file instanceof ArrayBuffer
      ? new TextDecoder().decode(file)
      : await file.text();
    const data    = JSON.parse(text);
    const studyId = data.studyMetadata?.studyId;
    if (!isSafeStudyId(studyId)) {
      console.warn('[defaultStudies] Skipping plain-JSON', name, '— missing or invalid studyId');
      return _quietInstallResult('failed', data, '', name, { reason: 'no_study_id' });
    }

    // Version check: skip silently if an equal-or-newer version is already installed —
    // *provided the content is actually still there* (see the zip-format branch above
    // for why).
    const priorVersion = _installedStudyVersionRaw(studyId);
    if (_shouldInstallStudy(data, { isUserInitiated: false }) === 'skip') {
      const existing = await StudyIDB.get(`study_content_${studyId}`);
      if (existing) {
        console.log('[defaultStudies] Skipping plain-JSON', studyId, '— installed version is current or newer');
        return _quietSkipResult(data, studyId, name);
      }
      console.log('[defaultStudies] Version record says skip but content is missing for', studyId, '(plain-JSON) — reinstalling.');
    }

    // IDBUnavailable re-thrown to caller — see note above.
    await StudyIDB.set(`study_content_${studyId}`, data);

    const registry = JSON.parse(localStorage.getItem('study_registry') || '[]');
    if (!registry.includes(studyId)) {
      registry.push(studyId);
      safeSetItem('study_registry', JSON.stringify(registry));
    }
    // Record the installed studyVersion so future installs can compare against it.
    const installedVer = _versionString(data.studyMetadata?.studyVersion);
    _setInstalledStudyVersion(studyId, installedVer);
    return _quietInstallResult(priorVersion && compareStudyVersions(installedVer, priorVersion) > 0 ? 'updated' : 'installed', data, studyId, name);
  }
}

// ── INSTALL SUMMARY ──────────────────────────────────────────────────────────
// Multi-file picks and bundles install quietly, one file after another. Each
// file's result is collected here and, unless every file went in as new or as
// an update, shown in a dialog that says what happened to each one. Before
// this, a file that was skipped (same or older version) or could not be read
// was counted as "installed" or hidden in a console message.

// One line of the summary: { ok, text } for a result object.
function _installResultLine(r) {
  const v = { title: r.title, version: r.version, installed: r.installed, incoming: r.version, name: r.name };
  switch (r.status) {
    case 'installed': return { ok: true,  text: t('errorreport_install_installed', v) };
    case 'updated':   return { ok: true,  text: t('errorreport_install_updated', v) };
    case 'unchanged': return { ok: false, text: t('errorreport_install_unchanged', v) };
    case 'older':     return { ok: false, text: t('errorreport_install_older', v) };
    default: {
      const reason = r.reason === 'no_study_json' ? t('errorreport_reason_no_study_json')
                   : r.reason === 'no_study_id'   ? t('errorreport_reason_no_study_id')
                   : (r.reason || '');
      return { ok: false, text: t('errorreport_install_failed', { name: r.name, reason }) };
    }
  }
}

// Plain-text version for "Copy details".
function _installResultDetails(results) {
  const head = `Bible Study Reader ${window.appAboutData?.appVersion || ''}`.trim();
  return [head, ...results.map(r =>
    `${r.status}: ${r.name}` +
    (r.studyId ? ` | ${r.studyId}` : '') +
    (r.version ? ` | file v${r.version}` : '') +
    (r.installed ? ` | installed v${r.installed}` : '') +
    (r.reason ? ` | ${r.reason}` : ''))].join('\n');
}

// Counts the results that went in, and shows the dialog when any did not.
// Returns { installed, allGood } so the caller can show its usual toast when
// everything went in.
function _summariseInstall(results) {
  const installed = results.filter(r => r.status === 'installed' || r.status === 'updated').length;
  const allGood   = installed === results.length;
  if (!allGood) {
    showErrorDialog({
      title:   t('errorreport_install_title'),
      message: t('errorreport_install_intro'),
      lines:   results.map(_installResultLine),
      details: _installResultDetails(results),
    });
  }
  return { installed, allGood };
}

// Processes a bundle zip that contains multiple .estudy or .zip study files.
// Installs each one quietly (no UI thrashing between studies), then opens the
// library so the user sees everything that was installed.
// pathwaysEntry: the bundle's root pathways.json entry, if any. Its pathways
// are imported after the studies (so the confirmation can count them). A
// pathways.json inside a nested .estudy/.zip is never read — pathways only
// come from files the user opened directly.
async function loadBundleFromFile(outerZip, innerStudyFiles, pathwaysEntry = null) {
  const total = innerStudyFiles.length;
  const results = [];

  showToast({ message: t('studyloader_bundle_installing', { count: total }), isManual: true });

  for (const entry of innerStudyFiles) {
    try {
      const blob = await _readZipEntry(entry, 'blob');
      const innerFile = new File([blob], entry.name, { type: 'application/octet-stream' });
      results.push(await _installStudyFileQuietly(innerFile));
    } catch (err) {
      console.error(`Failed to install ${entry.name}:`, err);
      recordError(err, { context: 'install-bundle-entry', file: entry.name });
      results.push({ status: 'failed', name: entry.name, reason: err.message });
    }
  }
  const installed = results.filter(r => r.status === 'installed' || r.status === 'updated').length;

  // Open the library once so the user sees all newly installed studies together.
  // recordStudyInstalled is called here (not inside _installStudyFileQuietly)
  // so only user-initiated bundle imports appear in the Recently Installed list.
  await Router.navigate({ page: 'library' });

  // Studies first, then the bundle's pathways, then one summary toast.
  if (pathwaysEntry) {
    let pathwaysText = null;
    try {
      pathwaysText = await _readZipEntry(pathwaysEntry, 'string');
    } catch (err) {
      console.error('Failed to read pathways.json:', err);
    }
    if (pathwaysText !== null) await importPathwaysFromText(pathwaysText, { bundledStudyCount: installed });
  }

  const summary = _summariseInstall(results);
  if (summary.allGood) {
    showToast({ message: t('studyloader_bundle_success', { count: installed }), isManual: true });
  }
}

// Reads a File object. Tries to open it as a zip (new .estudy format) first;
// falls back to plain JSON parsing (old .estudy format) if it is not a zip.
// Zip format: study.json  +  optional cover.webp / publisher.webp / author.webp
async function loadStudyFromFile(file) {
  try {
    // ── Try zip format first ──────────────────────────────────────────────────
    let zip;
    try {
      const arrayBuffer = await file.arrayBuffer();
      zip = await JSZip.loadAsync(arrayBuffer);
    } catch (_) {
      zip = null; // not a zip — will fall through to plain JSON below
    }
    if (zip) _checkZipLimits(zip);

    if (zip) {
      // ── New zip-based .estudy ───────────────────────────────────────────────

      // 1. Extract and parse study.json (filename may carry a prefix)
      const jsonEntry = Object.keys(zip.files).find(name => name.endsWith('study.json'));
      const jsonFile = jsonEntry ? zip.file(jsonEntry) : null;
      if (!jsonFile) {
        showPickerError(t('studyloader_error_no_study_json', { filename: file.name }));
        return;
      }
      const jsonString = await _readZipEntry(jsonFile, 'string');
      const data = JSON.parse(jsonString);
      const studyId = data.studyMetadata?.studyId;
      if (!isSafeStudyId(studyId)) {
        showPickerError(t('studyloader_error_no_study_id', { filename: file.name }));
        return;
      }

      // Version check (user-initiated path).
      const _decision = await _resolveUserInstall(data, studyId);
      if (_decision.action === 'stop') return;
      if (_decision.action === 'open-existing') {
        await _activateOrDeferStudy(studyId, _decision.existing);
        return;
      }
      _announceUpdate(data, studyId, _decision);

      // 2. Extract any image assets and store them as Blobs in IDB
      const imageNames = ['cover', 'publisher', 'author'];
      for (const name of imageNames) {
        const entry = zip.file(`images/${name}.webp`);
        if (entry) {
          const blob = await _readZipEntry(entry, 'blob');
          try {
            await StudyIDB.setImage(`${studyId}_${name}`, blob);
          } catch (err) {
              if (err.name === 'IDBUnavailable') { showPickerError(t('error_idb_unavailable')); return; }
              throw err;
          }
        }
      }

      // 2b. Extract chapter image assets (named by elementId)
      for (const ch of (data.chapters || [])) {
        for (const el of (ch.elements || [])) {
          if (el.type === 'image' && !el.src) {
            const entry = zip.file(`images/${el.elementId}.webp`);
            if (entry) {
              const blob = await _readZipEntry(entry, 'blob');
              try {
                await StudyIDB.setImage(`${studyId}_${el.elementId}`, blob);
              } catch (err) {
                if (err.name === 'IDBUnavailable') { showPickerError(t('error_idb_unavailable')); return; }
                throw err;
              }
            }
          }
        }
      }

      // 2c. Extract gallery images referenced by src in goDeeperData /
      //     leadersNotesData (stored as {studyId}_gallery_<file>; see gallery.js)
      try {
        await storeGalleryImages(zip, data, studyId);
      } catch (err) {
        if (err.name === 'IDBUnavailable') { showPickerError(t('error_idb_unavailable')); return; }
        throw err;
      }

      // 3. Store the parsed study object in IDB and update the registry
      try {
        await StudyIDB.set(`study_content_${studyId}`, data);
      } catch (err) {
        if (err.name === 'IDBUnavailable') {
          showPickerError(t('error_idb_unavailable'));
          return;
        }
        throw err;
      }
      let registry = JSON.parse(localStorage.getItem('study_registry') || '[]');
      if (!registry.includes(studyId)) {
        registry.push(studyId);
        safeSetItem('study_registry', JSON.stringify(registry));
      }
      safeSetItem('bsr_last_active_study', studyId);
      recordStudyInstalled(studyId); // ← track in Recently Installed
      // Record the installed studyVersion so future loads can compare against it.
      _setInstalledStudyVersion(studyId, data.studyMetadata?.studyVersion);

      // 4. Apply to the running app.
      // Images were already written to IDB in step 2a/2b above; applyStudyData()
      // resolves cover/publisher/author blob URLs itself (reading straight from
      // IDB, after its own revoke of the *previous* study's URLs has run — see
      // the note at the top of applyStudyData). Pre-attaching blob URLs to
      // data.imageData here, before calling applyStudyData(), used to create
      // this study's own image URLs and then have applyStudyData's revoke step
      // immediately invalidate them — producing "blob:... net::ERR_FILE_NOT_FOUND"
      // on every single file load, deterministically.
      await _activateOrDeferStudy(studyId, data, { checkVersion: true });

    } else {
      // ── Legacy plain-JSON .estudy ─────────────────────────────────────────
      const text = await file.text();
      const data = JSON.parse(text);
      const _plainStudyId = data.studyMetadata?.studyId;

      // A study without a studyId can't be stored or keyed. Activating it
      // anyway would leave window.activeStudyId pointing at the *previous*
      // study, so every answer typed into it would be saved over that other
      // study's records. Reject it, as the zip path above does.
      if (!isSafeStudyId(_plainStudyId)) {
        showPickerError(t('studyloader_error_no_study_id', { filename: file.name }));
        return;
      }

      // Version check (user-initiated path).
      const _decision = await _resolveUserInstall(data, _plainStudyId);
      if (_decision.action === 'stop') return;
      if (_decision.action === 'open-existing') {
        await _activateOrDeferStudy(_plainStudyId, _decision.existing);
        return;
      }
      _announceUpdate(data, _plainStudyId, _decision);

      // Persist and register, same as the zip path — without this the study
      // only lived in memory: it never appeared in the Library and was gone
      // after a restart, even though its version record had been written.
      try {
        await StudyIDB.set(`study_content_${_plainStudyId}`, data);
      } catch (err) {
        if (err.name === 'IDBUnavailable') { showPickerError(t('error_idb_unavailable')); return; }
        throw err;
      }
      const registry = JSON.parse(localStorage.getItem('study_registry') || '[]');
      if (!registry.includes(_plainStudyId)) {
        registry.push(_plainStudyId);
        safeSetItem('study_registry', JSON.stringify(registry));
      }
      safeSetItem('bsr_last_active_study', _plainStudyId);
      recordStudyInstalled(_plainStudyId);
      _setInstalledStudyVersion(_plainStudyId, data.studyMetadata?.studyVersion);

      await _activateOrDeferStudy(_plainStudyId, data, { checkVersion: true });
    }

  } catch (err) {
    _reportLoadError(err, file.name, 'install-study');
  }
}

// Reports an exception thrown while loading a file. Unlike showPickerError()
// (one line of text), this records the error, names the file, and offers Copy
// details so a reader can tell the author what happened.
function _reportLoadError(err, filename, context) {
  reportError(err, {
    context, file: filename, dialog: true,
    title:   t('errorreport_title'),
    message: t('errorreport_load_file_failed', { filename }) + ' ' + ((err && err.message) || ''),
  });
}

function showPickerError(msg) {
  const el = document.getElementById('studyPickerError');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
    return;
  }

  // studyPickerError only exists when renderStudyPicker() has run.
  // When a file arrives via an Android intent while a study is already loaded,
  // or during early startup before the picker renders, that element won't be
  // in the DOM. Try UI libraries in preference order, falling back to a static
  // HTML injection that requires no library dependencies — matching the pattern
  // used by _showIdbUnavailableError() in app-init.js.
  if (typeof Swal !== 'undefined') {
    Swal.fire({ icon: 'error', title: t('studyloader_error_title'), text: msg });
    return;
  }
  if (typeof showToast === 'function') {
    showToast({ message: '⚠️ ' + msg, isManual: true });
    return;
  }
  // Last resort: inject a visible error directly into #mainContent.
  // alert() is unreliable on Android WebView and must not be used here.
  const content = document.getElementById('mainContent');
  if (content) {
    content.innerHTML = `
      <div style="padding:40px 20px; text-align:center; font-family:sans-serif;">
        <div style="font-size:3rem; margin-bottom:16px;">⚠️</div>
        <h2 style="margin-bottom:12px;">Unable to load study</h2>
        <p style="color:#888; max-width:320px; margin:0 auto; font-size:14px; line-height:1.5;">
          ${msg.replace(/</g, '&lt;')}
        </p>
      </div>`;
  }
}

// Renders the study picker screen into #mainContent.
// Called on startup (no study loaded) and can be re-called to switch studies.
function renderStudyPicker() {
  const content = document.getElementById('mainContent');
  if (!content) return;

  // Hide save button if present
  // WIP: intended for a future sticky/persistent save bar (id="saveBtn").
  // buildSaveBar() currently renders inline only. Keep until feature decision made.
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.parentElement.style.display = 'none';

  // Reset progress bar
  const progressBar = document.getElementById('progressBar');
  if (progressBar) progressBar.style.width = '0%';

  // Update header
  const headerTitle = document.getElementById('header-title');
  if (headerTitle) headerTitle.innerText = t('studyloader_header_load_study');

  content.innerHTML = `
    <div style="
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 70vh;
      padding: 40px 24px;
      text-align: center;
      box-sizing: border-box;
    ">
      <div style="
        font-size: 48px;
        margin-bottom: 20px;
        line-height: 1;
      ">📖</div>

      <div style="
        font-size: 11px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--accent);
        margin-bottom: 10px;
        font-family: var(--font-stack-mono, monospace);
      ">${t('studyloader_picker_eyebrow')}</div>

      <div style="
        font-size: 22px;
        font-weight: 700;
        color: var(--text);
        margin-bottom: 12px;
        line-height: 1.25;
      ">${t('studyloader_picker_heading')}</div>

      <div style="
        font-size: 15px;
        color: var(--text-secondary);
        margin-bottom: 36px;
        max-width: 300px;
        line-height: 1.55;
      ">${t('studyloader_picker_body')}</div>

      <label style="
        display: inline-block;
        background: var(--accent);
        color: var(--surface);
        font-size: 15px;
        font-weight: 600;
        padding: 14px 28px;
        border-radius: 8px;
        cursor: pointer;
        width: 100%;
        max-width: 280px;
        box-sizing: border-box;
        transition: background 0.15s;
      ">
        <span>${t('studyloader_picker_choose_file')}</span>
        <input
          type="file"
          accept=".estudy,.epathway,.zip,application/zip,application/json,application/octet-stream,*/*"
          multiple
          style="display:none;"
          onchange="handlePickerFileChange(event)"
        />
      </label>

      <div
        id="studyPickerError"
        style="
          display: none;
          margin-top: 20px;
          color: var(--emphasis);
          font-size: 14px;
          max-width: 300px;
          line-height: 1.5;
        "
      ></div>

    </div>
  `;
}

// Called by the file input's onchange event.
async function handlePickerFileChange(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  event.target.value = '';
  if (files.length === 1) {
    await loadAnyFile(files[0]);
    return;
  }
  await _installMultipleFiles(files);
}
