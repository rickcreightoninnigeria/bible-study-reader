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
//   StudyIDB           – idb.js
//   ICONS              – icons.js
//   appSettings        – settings.js
//   showToast          – utils.js
//   recordStudyOpened,
//   recordStudyInstalled,
//   removeStudyFromHistory – library.js
//   closeNonChapterPage,
//   _resetNonChapterPageState – navigation.js
//   renderLibrary      – library.js
//   renderTitlePage    – main.js RENDER section
//   initApp            – main.js PROGRESS section
//   studyOnboardingSlides – main.js STATE section
//   window.*           – state.js

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
async function activateStudy(id) {
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
    localStorage.setItem('bsr_last_active_study', id);
    recordStudyOpened(id); // ← track in Recent tab

    // Position is stored per-study (lastPosition_{id}), so nothing needs
    // clearing when switching studies — each study keeps its own position.
    
    // 2. Check estudy file version compatibility
    checkEstudyVersion(data);

    // 3. applyStudyData handles everything: chapters normalisation, image data,
    //    shortTitle → headerTitle, QA lookups, onboarding slides, and initApp().
    applyStudyData(data);

    // 4. Close the library after the study is loaded
    closeNonChapterPage();
}

function openLibrary() {
  window.libLangFilter = 'all';
  closeMenu();
  _resetNonChapterPageState();
  isNonChapterPage = true;
  window.activeTabPage = 'library';
  suspendStudyTheme();
  const libBtn = document.getElementById('navLibBtn');
  if (libBtn) { libBtn.innerHTML = ICONS.close; libBtn.onclick = () => closeNonChapterPage(); }
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.parentElement.style.display = 'none';
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
    const file = event.target.files[0];
    if (!file) return;
    // Reset the input so selecting the same file again fires onchange
    event.target.value = '';
    await loadAnyFile(file);
}

async function deleteStudy(id, title) {
    const { isConfirmed } = await Swal.fire({
      title: t('studyloader_delete_title', { title }),
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
    localStorage.setItem('study_registry', JSON.stringify(registry));

    // 2. Remove the study content and any stored images from IDB
    try {
    	await StudyIDB.remove(`study_content_${id}`);
  	   await StudyIDB.removeImage(`${id}_cover`);
  	   await StudyIDB.removeImage(`${id}_publisher`);
  	   await StudyIDB.removeImage(`${id}_author`);
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
        window.studyMetadata = {};
        localStorage.removeItem('bsr_last_active_study');
        resetTheme();
        renderTitlePage();
    }

    // 5. Refresh the list
    openLibrary();
    if (typeof showToast === 'function') showToast({ message: t('studyloader_delete_success') });
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

// Map of action label keywords → the engine function they should invoke.
const ACTION_FN_MAP = {
  'Settings':     () => renderSettings(),
  'How to use':   () => renderHowToUse(),
};

function resolveActionFn(label) {
  if (!label) return null;
  for (const [key, fn] of Object.entries(ACTION_FN_MAP)) {
    if (label.includes(key)) return fn;
  }
  return null;
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

// ── ESTUDY FORMAT NORMALISATION HELPERS ──────────────────────────────────────
// The new .estudy format stores chapters as a flat elements[] array rather than
// the old nested {intro, sections[], closing, reflection[]} structure.
// These helpers reconstruct the old shape so all downstream functions
// (search, share, print, progress, starring) continue to work unchanged.

// Returns the text of the first element with the given subtype.
function _extractTextBySubtype(elements, subtype) {
  const el = (elements || []).find(e => e.type === 'text' && e.subtype === subtype);
  return el ? el.text : '';
}

// Returns an array of reflection question strings.
function _extractReflectionQuestions(elements) {
  return (elements || [])
    .filter(e => e.type === 'question' && e.subtype === 'reflection' && !e.repeatElement)
    .map(e => e.question);
}

// Reconstructs sections[] from the flat elements[].
// A new section starts at each bridge text element (or implicitly at the first
// biblePassage when there is no leading bridge). Questions are grouped under
// the most recently seen biblePassage reference.
function _buildSectionsFromElements(elements) {
  const els = (elements || []).filter(e => !e.repeatElement);
  const sections = [];
  let currentSection = null;
  let lastRef = null;

  els.forEach(el => {
    if (el.type === 'text' && el.subtype === 'bridge') {
      currentSection = { bridge: el.text, questions: [] };
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
        text:      el.question,
        elementId: el.elementId,
      });
    }
  });

  return sections;
}

// Assigns all globals from a parsed JSON data object and (re-)starts the app.
// ── THEME ─────────────────────────────────────────────────────────────────────
// The 19 CSS custom properties that make up a study's colour scheme.
// Keys match the property names in the .estudy "theme" block exactly.
const THEME_PROPS = [
  'surface', 'surface-mid', 'text', 'text-secondary', 'text-faint',
  'emphasis', 'emphasis-light', 'success', 'accent', 'accent-light',
  'border', 'shadow', 'card-bg',
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

function suspendStudyTheme() {
  const root = document.documentElement;
  const saved = {};
  THEME_PROPS.forEach(prop => {
    const val = root.style.getPropertyValue(`--${prop}`);
    if (val) {
      saved[prop] = val;
      root.style.removeProperty(`--${prop}`);
    }
  });
  // Stash so restoreStudyTheme() can put them back
  root._suspendedTheme = saved;
}

function restoreStudyTheme() {
  const root = document.documentElement;
  const saved = root._suspendedTheme || {};
  if (Object.keys(saved).length > 0) {
    // Re-apply the suspended theme properties
    THEME_PROPS.forEach(prop => {
      if (saved[prop]) root.style.setProperty(`--${prop}`, saved[prop]);
    });
  } else {
    // Nothing was suspended — re-apply directly from the loaded study theme
    const theme = window._loadedStudyTheme;
    if (theme) applyTheme(theme);
  }
}

async function applyStudyData(data) {
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
  window.chapters = (data.chapters || []).map(ch => ({
    ...ch,
    num:        ch.chapterNumber,
    title:      ch.chapterTitle,
    intro:      _extractTextBySubtype(ch.elements, 'chapterIntro'),
    closing:    _extractTextBySubtype(ch.elements, 'chapterClosing'),
    reflection: _extractReflectionQuestions(ch.elements),
    sections:   _buildSectionsFromElements(ch.elements),
  }));

  studyOnboardingSlides = (data.studyOnboardingSlides || []).map(slide => {
    if (slide.action && slide.action.fn === null) {
      slide.action.fn = resolveActionFn(slide.action.label);
    }
    return slide;
  });

  // Load shortTitle title
  const metadata = data.studyMetadata || {};
  const shortTitle = metadata.shortTitle || metadata.title || "Study";

  // Resolve cover image — mirrors the library's own logic:
  // 1. Prefer a blob URL already attached in-session (zip just loaded).
  // 2. Fall back to the IDB image store (survives page reloads).
  // 3. Fall back to legacy base64 embedded in data.imageData.
  let coverSrc = resolveImageSrc(data.imageData?.cover) || '';
  if (!coverSrc && _appliedId) {
    try {
      const coverBlob = await StudyIDB.getImage(`${_appliedId}_cover`);
      if (coverBlob) {
        coverSrc = await new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target.result);
          reader.readAsDataURL(coverBlob);
        });
      }
    } catch (e) {
      console.warn('applyStudyData: could not load cover from IDB', e);
    }
  }

  window.titlePageData = {
    ...(data.studyMetadata || {}),
    headerTitle: shortTitle,
    image: {
        src:           coverSrc,
        alt:           data.imageData?.cover?.alt || '',
        fallbackEmoji: data.imageData?.cover?.fallback || '📖',
    },
  };

  window.howToUseData     = data.howToUseData     || {};
  window.leadersNotesData = data.leadersNotesData || {};
  window.studyAboutData   = data.studyAboutData   || {};
  window.studyAiData      = data.studyAiData      || {};
  
  window.copyrightData = {
    ...(data.copyrightData || {}),
    authorLine: (data.copyrightData && data.copyrightData.copyright)
      ? data.copyrightData.copyright.statement
      : '',
  };
  
  // Apply study theme (colour scheme) to CSS custom properties
  applyTheme(data.theme);
  window._loadedStudyTheme = data.theme || null;
  document.documentElement._suspendedTheme = {};  // clear any stale suspension theme data

  window.verseData = {}; // populated by renderChapter() from biblePassage elements
  
  initApp();
} // end applyStudyData

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
        if (!studyId) {
            alert(t('studyloader_error_no_study_id', { filename: 'JSON' }));
            return;
        }

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
            localStorage.setItem('study_registry', JSON.stringify(registry));
        }
        localStorage.setItem('bsr_last_active_study', studyId);
        recordStudyInstalled(studyId); // ← track in Recently Installed

        // If the app is already initialised (DOMContentLoaded has fired),
        // apply immediately. Otherwise stash for startApp() to pick up.
        if (window._appReady) {
            window.activeStudyId = studyId;
            checkEstudyVersion(data);
            closeNonChapterPage();
            applyStudyData(data);
        } else {
            window.pendingStudyData = data;
            window.activeStudyId   = studyId;
        }
    } catch(e) {
        alert(t('studyloader_error_load_json', { error: e.message }));
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
        showPickerError(t('studyloader_error_load_file_base64', { error: e.message }));
    }
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
      // A bundle zip contains multiple study files — either .estudy or .zip entries.
      // A single-study zip contains study.json directly (no inner study files).
      const innerStudyFiles = Object.values(zip.files)
        .filter(f => !f.dir && (f.name.endsWith('.estudy') || f.name.endsWith('.zip')));

      const hasSingleStudyJson = Object.keys(zip.files)
        .some(name => name.endsWith('study.json'));

      if (innerStudyFiles.length > 0 && !hasSingleStudyJson) {
        // ── Bundle: zip containing multiple .estudy or .zip study files ──────
        await loadBundleFromFile(zip, innerStudyFiles);
      } else {
        // ── Single zip-format .estudy (contains study.json directly) ─────────
        await loadStudyFromFile(file);
      }
    } else {
      // ── Plain-JSON .estudy (legacy format) ───────────────────────────────────
      await loadStudyFromFile(file);
    }
  } catch (err) {
    showPickerError(t('studyloader_error_load_file', { filename: file.name, error: err.message }));
    console.error(err);
  }
}

// ── DEFAULT STUDIES INSTALLER ─────────────────────────────────────────────────
// Fetches estudy/firstEstudies.zip on the very first run (flag:
// 'default_studies_installed') and installs all .estudy files found inside it.
// Runs silently — no progress toasts — so startup feels clean.
// On any failure, shows a single toast and continues without throwing.
//
// Called from app-init.js before the startup routing decision, so studies are
// present in the registry by the time the library is first rendered.
async function installDefaultStudiesIfNeeded() {
  if (localStorage.getItem('default_studies_installed')) return;

  try {
    // Use XHR instead of fetch — fetch('file://...') is blocked in Android WebView.
    // XHR with responseType='arraybuffer' works correctly under both file:// and
    // custom-scheme WebView origins.
    const arrayBuffer = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'estudy/firstEstudies.zip', true);
      xhr.responseType = 'arraybuffer';
      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 0) {
          // status 0 is normal for successful file:// XHR requests
          resolve(xhr.response);
        } else {
          reject(new Error(`XHR status ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('XHR network error'));
      xhr.send();
    });
    
    const outerZip = await JSZip.loadAsync(arrayBuffer);

    // Collect all .estudy entries inside the bundle zip
    const innerEstudyFiles = Object.values(outerZip.files)
      .filter(f => !f.dir && f.name.endsWith('.estudy'));

    if (innerEstudyFiles.length === 0) {
      console.warn('[defaultStudies] firstEstudies.zip contains no .estudy files');
      return;
    }

    // Install each .estudy silently using the existing per-file loader.
    // loadStudyFromFile() normally calls applyStudyData() and navigates — we
    // do NOT want that here.  We use _installStudyFromZipEntry() instead, which
    // only persists to IDB and the registry without touching the UI.
    for (const entry of innerEstudyFiles) {
        try {
            const blob = await entry.async('blob');
            const innerFile = new File([blob], entry.name, { type: 'application/octet-stream' });
            await _installStudyFileQuietly(innerFile);
        } catch (entryErr) {
            console.error('[defaultStudies] Failed to install', entry.name, entryErr);
        }
    }

    localStorage.setItem('default_studies_installed', 'true');

  } catch (err) {
    console.error('[defaultStudies] installDefaultStudiesIfNeeded failed:', err);
    showToast({ message: t('studyloader_default_studies_error') });
    // Do NOT set the flag — allow a retry on next launch in case it was transient.
    // If the zip simply doesn't exist in a dev build, this will toast every launch;
    // set the flag manually in the console to suppress: 
    //   localStorage.setItem('default_studies_installed', 'true')
  }
}

// Installs a single .estudy File object into IDB and the registry without
// activating it or touching the UI.  Used by installDefaultStudiesIfNeeded()
// so the default studies land silently in the background.
//
// Supports both zip-format .estudy (study.json + images/) and legacy plain-JSON.
async function _installStudyFileQuietly(file) {
  let zip;
  try {
    const arrayBuffer = await file.arrayBuffer();
    zip = await JSZip.loadAsync(arrayBuffer);
  } catch (_) {
    zip = null;
  }

  if (zip) {
    // ── Zip-format .estudy ──────────────────────────────────────────────────
    const jsonFile = zip.file('study.json');
    if (!jsonFile) {
      console.warn('[defaultStudies] Skipping', file.name, '— no study.json inside');
      return;
    }

    const jsonString = await jsonFile.async('string');
    const data       = JSON.parse(jsonString);
    const studyId    = data.studyMetadata?.studyId;
    if (!studyId) {
      console.warn('[defaultStudies] Skipping', file.name, '— missing studyMetadata.studyId');
      return;
    }

    // Store images in IDB
    const imageNames = ['cover', 'publisher', 'author'];
    for (const name of imageNames) {
      const entry = zip.file(`images/${name}.webp`);
      if (entry) {
        const blob = await entry.async('blob');
        try {
          await StudyIDB.setImage(`${studyId}_${name}`, blob);
        } catch (err) {
            if (err.name === 'IDBUnavailable') { showPickerError(t('error_idb_unavailable')); return; }
            throw err;
        }
      }
    }

    // Store chapter images
    for (const ch of (data.chapters || [])) {
      for (const el of (ch.elements || [])) {
        if (el.type === 'image' && !el.src) {
          const entry = zip.file(`images/${el.elementId}.webp`);
          if (entry) {
            const blob = await entry.async('blob');
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

    // Persist study data and register
    try {
      await StudyIDB.set(`study_content_${studyId}`, data);
    } catch (err) {
      if (err.name === 'IDBUnavailable') {
        showPickerError(t('error_idb_unavailable'));
        return;
      }
      throw err;
    }
    const registry = JSON.parse(localStorage.getItem('study_registry') || '[]');
    if (!registry.includes(studyId)) {
      registry.push(studyId);
      localStorage.setItem('study_registry', JSON.stringify(registry));
    }
    // recordStudyInstalled is intentionally omitted — these are pre-installed,
    // not user-installed, and shouldn't pollute the Recently Installed list.

  } else {
    // ── Legacy plain-JSON .estudy ───────────────────────────────────────────
    const text    = await file.text();
    const data    = JSON.parse(text);
    const studyId = data.studyMetadata?.studyId;
    if (!studyId) {
      console.warn('[defaultStudies] Skipping plain-JSON', file.name, '— missing studyId');
      return;
    }

    try {
      await StudyIDB.set(`study_content_${studyId}`, data);
    } catch (err) {
      if (err.name === 'IDBUnavailable') {
        showPickerError(t('error_idb_unavailable'));
        return;
      }
      throw err;
    }

    const registry = JSON.parse(localStorage.getItem('study_registry') || '[]');
    if (!registry.includes(studyId)) {
      registry.push(studyId);
      localStorage.setItem('study_registry', JSON.stringify(registry));
    }
  }
}

// Processes a bundle zip that contains multiple .estudy or .zip study files.
// Installs each one quietly (no UI thrashing between studies), then opens the
// library so the user sees everything that was installed.
async function loadBundleFromFile(outerZip, innerStudyFiles) {
  const total = innerStudyFiles.length;
  let installed = 0;
  let failed = 0;

  showToast({ message: t('studyloader_bundle_installing', { count: total }) });

  for (const entry of innerStudyFiles) {
    try {
      const blob = await entry.async('blob');
      const innerFile = new File([blob], entry.name, { type: 'application/octet-stream' });
      await _installStudyFileQuietly(innerFile);
      installed++;
    } catch (err) {
      console.error(`Failed to install ${entry.name}:`, err);
      failed++;
    }
  }

  // Open the library once so the user sees all newly installed studies together.
  // recordStudyInstalled is called here (not inside _installStudyFileQuietly)
  // so only user-initiated bundle imports appear in the Recently Installed list.
  openLibrary();

  if (failed === 0) {
    showToast({ message: t('studyloader_bundle_success', { count: installed }) });
  } else {
    showToast({ message: t('studyloader_bundle_partial', { installed, failed }) });
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

    if (zip) {
      // ── New zip-based .estudy ───────────────────────────────────────────────

      // 1. Extract and parse study.json (filename may carry a prefix)
      const jsonEntry = Object.keys(zip.files).find(name => name.endsWith('study.json'));
      const jsonFile = jsonEntry ? zip.file(jsonEntry) : null;
      if (!jsonFile) {
        showPickerError(t('studyloader_error_no_study_json', { filename: file.name }));
        return;
      }
      const jsonString = await jsonFile.async('string');
      const data = JSON.parse(jsonString);
      const studyId = data.studyMetadata?.studyId;
      if (!studyId) {
        showPickerError(t('studyloader_error_no_study_id', { filename: file.name }));
        return;
      }

      // 2. Extract any image assets and store them as Blobs in IDB
      const imageNames = ['cover', 'publisher', 'author'];
      for (const name of imageNames) {
        const entry = zip.file(`images/${name}.webp`);
        if (entry) {
          const blob = await entry.async('blob');
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
              const blob = await entry.async('blob');
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
        localStorage.setItem('study_registry', JSON.stringify(registry));
      }
      localStorage.setItem('bsr_last_active_study', studyId);
      recordStudyInstalled(studyId); // ← track in Recently Installed

      // Attach blob URLs to imageData so applyImageData can find them
      if (data.imageData) {
        for (const name of imageNames) {
          const entry = zip.file(`images/${name}.webp`);
          if (entry && data.imageData[name]) {
            const blob = await entry.async('blob');
            data.imageData[name].src = URL.createObjectURL(blob);
          }
        }
      }

      // 4. Apply to the running app
      checkEstudyVersion(data);
      closeNonChapterPage();
      window.activeStudyId = studyId;
      applyStudyData(data);

    } else {
      // ── Legacy plain-JSON .estudy ─────────────────────────────────────────
      const text = await file.text();
      const data = JSON.parse(text);
      checkEstudyVersion(data);
      closeNonChapterPage();
      applyStudyData(data);
    }

  } catch (err) {
    showPickerError(t('studyloader_error_load_file', { filename: file.name, error: err.message }));
  }
}

function showPickerError(msg) {
  const el = document.getElementById('studyPickerError');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  } else {
    // studyPickerError only exists when renderStudyPicker() has run.
    // When a file arrives via an Android intent while a study is already
    // loaded, that element won't be in the DOM — fall back to a toast so
    // the error is never swallowed silently.
    if (typeof showToast === 'function') {
      showToast({ message: '⚠️ ' + msg });
    } else {
      alert(msg);
    }
  }
}

// Renders the study picker screen into #mainContent.
// Called on startup (no study loaded) and can be re-called to switch studies.
function renderStudyPicker() {
  const content = document.getElementById('mainContent');
  if (!content) return;

  // Hide save button if present
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
          accept=".estudy,.zip,application/zip,application/octet-stream,*/*"
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
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  event.target.value = '';
  await loadAnyFile(file);
}

