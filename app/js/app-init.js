// ── APP-LEVEL STARTUP ─────────────────────────────────────────────────────────
// DOMContentLoaded startup sequence. Decides which screen to show on launch
// based on library state, saved position, and first-run status.
//
// All onboarding and slide overlay logic has moved to onboarding.js:
//   showAppOnboardingIfNeeded() – guard wrapper, returns bool
//   showAppOnboarding()         – unconditional, also called from HowTo page
//   showOnboardingIfNeeded()    – study-level guard wrapper
//
// Dependencies (all available as globals before this file loads):
//   StudyIDB                   – idb.js
//   migrateAnswersToIDB        – migrate.js
//   appSettings, initSettings  – settings.js
//   initLongPressCopy          – utils.js
//   openLibrary                – study-loader.js
//   applyStudyData             – study-loader.js
//   showAppOnboardingIfNeeded,
//   showAppOnboarding,
//   showOnboardingIfNeeded     – onboarding.js
//   resolveLanguage,
//   applyLanguageToDom,
//   reloadLocaleAndRerender    – i18n.js
//   window._appReady,
//   window.appAboutData,
//   window.appStrings,
//   window.appLocale,
//   window.pendingStudyData    – state.js

// ── STARTUP ───────────────────────────────────────────────────────────────────
// Startup sequence follows this decision tree:
//   0. Android delivered a .estudy before DOMContentLoaded → apply it directly
//   1. Last study is in the registry and loads OK → restore position or title page
//   2. Library is non-empty but no active study → show the library
//   3. Very first run (app onboarding not yet complete) → library + app onboarding
//   4. Otherwise → show the Load Study picker (library)

// ── JSON FETCH HELPER ─────────────────────────────────────────────────────────
// Defined at module scope so it is available to both startApp() and
// reloadLocaleAndRerender() without duplication.
function _fetchJson(path) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', path, true);
    xhr.onload = () => {
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch (err) {
        console.warn(`Failed to parse ${path}:`, err);
        resolve(null);
      }
    };
    xhr.onerror = (err) => {
      console.warn(`Failed to load ${path}:`, err);
      resolve(null);
    };
    xhr.send();
  });
}

// ── LOCALE LOADER ─────────────────────────────────────────────────────────────
// Fetches all locale-specific JSON files for the given language code and
// merges them into window.appAboutData and window.appStrings.
// Uses file-level fallback for data files (appAboutData, shelvesStructure,
// learningPathways) and key-level fallback for ui strings.
// Called once on startup and again whenever the user changes language.

// Shared assembly step used by both branches of loadLocale().
// Accepts the locale fetch results plus optional English fallbacks (null when
// the resolved language is already English) and writes to window globals.
//
//   untranslated  – appAboutData_untranslated.json (language-independent)
//   aboutLocale / aboutFallback     – file-level fallback: locale wins or en
//   shelvesLocale / shelvesFallback – file-level fallback: locale wins or en
//   pathwaysLocale / pathwaysFallback – file-level fallback: locale wins or en
//   uiLocale / uiFallback           – key-level fallback: en base + locale overlay
//   langCode      – stored on window.appLocale
function _applyLocaleData({
  langCode,
  untranslated,
  aboutLocale,    aboutFallback,
  shelvesLocale,  shelvesFallback,
  pathwaysLocale, pathwaysFallback,
  uiLocale,       uiFallback,
}) {
  // File-level fallback: use the locale version if it loaded, otherwise English.
  const aboutData    = aboutLocale    || aboutFallback    || {};
  const shelvesData  = shelvesLocale  || shelvesFallback  || [];
  const pathwaysData = pathwaysLocale || pathwaysFallback || {};

  // Key-level fallback: start with English strings, overlay locale on top.
  // Any key present in both gets the locale value.
  // Any key missing from the locale keeps the English value.
  const uiStrings = { ...(uiFallback || {}), ...(uiLocale || {}) };

  window.appAboutData = {
    ...(untranslated || {}),
    ...(aboutData),
    libraryShelvesStructure: shelvesData,
    learningPathways:        pathwaysData,
  };
  window.appStrings = uiStrings;
  window.appLocale  = langCode;
}

async function loadLocale(langCode) {
  const localePath   = `js/locales/${langCode}`;
  const fallbackPath = `js/locales/en`;
  const isEnglish    = langCode === 'en';

  if (isEnglish) {
    // English: locale and fallback paths are identical, so fetch each file
    // only once and pass the result as both locale and fallback. _applyLocaleData
    // will prefer the locale value (left-hand side of ||), so the outcome is
    // identical to the non-English path with no wasted requests.
    const [untranslated, aboutLocale, shelvesLocale, pathwaysLocale, uiLocale] =
      await Promise.all([
        _fetchJson('js/appAboutData_untranslated.json'),
        _fetchJson(`${localePath}/appAboutData_en.json`),
        _fetchJson(`${localePath}/libraryShelvesStructure_en.json`),
        _fetchJson(`${localePath}/learningPathways_en.json`),
        _fetchJson(`${localePath}/ui_en.json`),
      ]);
    _applyLocaleData({
      langCode,
      untranslated,
      aboutLocale,    aboutFallback:    null,
      shelvesLocale,  shelvesFallback:  null,
      pathwaysLocale, pathwaysFallback: null,
      uiLocale,       uiFallback:       null,
    });
    return;
  }

  // Non-English: fetch locale files and English fallbacks in parallel.
  const [
    untranslated,
    aboutLocale,    aboutFallback,
    shelvesLocale,  shelvesFallback,
    pathwaysLocale, pathwaysFallback,
    uiLocale,       uiFallback,
  ] = await Promise.all([
    _fetchJson('js/appAboutData_untranslated.json'),
    _fetchJson(`${localePath}/appAboutData_${langCode}.json`),
    _fetchJson(`${fallbackPath}/appAboutData_en.json`),
    _fetchJson(`${localePath}/libraryShelvesStructure_${langCode}.json`),
    _fetchJson(`${fallbackPath}/libraryShelvesStructure_en.json`),
    _fetchJson(`${localePath}/learningPathways_${langCode}.json`),
    _fetchJson(`${fallbackPath}/learningPathways_en.json`),
    _fetchJson(`${localePath}/ui_${langCode}.json`),
    _fetchJson(`${fallbackPath}/ui_en.json`),
  ]);
  _applyLocaleData({
    langCode,
    untranslated,
    aboutLocale,    aboutFallback,
    shelvesLocale,  shelvesFallback,
    pathwaysLocale, pathwaysFallback,
    uiLocale,       uiFallback,
  });
}

// ── LOCALE RELOAD + RE-RENDER ─────────────────────────────────────────────────
// Called by setLanguage() in i18n.js when the user changes language in Settings.
// Reloads all locale files for the new language and re-renders the current view.
// Does NOT repeat one-time startup tasks (install default studies, onboarding…).

async function reloadLocaleAndRerender(langCode) {
  applyLanguageToDom(langCode);
  await loadLocale(langCode);

  // Sync the in-chapter language to the new UI language if the study
  // supports it. If not, leave _activeStudyLang on its current value
  // so the language bar stays on whichever language was already active.
  const availableLangs = detectAvailableLangs();
  if (availableLangs.includes(langCode)) {
    window._activeStudyLang = langCode;
  }

  // Patch the footer with the new locale's app title.
  const footerEl = document.getElementById('libraryVersionFooter');
  if (footerEl && window.appAboutData?.appTitle) {
    footerEl.textContent = `${window.appAboutData.appTitle} · v${window.appAboutData.appVersion}`;
  }

  // Re-render whatever is currently on screen.
  rerenderCurrentView();
}

function rerenderCurrentView() {
  // NOTE: This function intentionally bypasses Router.navigate() and
  // Router.replaceState(). It is called after a locale reload to re-render
  // the current view in the new language — the history stack is already
  // correct, so we call render functions directly without pushing or
  // replacing any history entries.

  if (!isNonChapterPage) {
    // User is on the title page or a chapter
    if (typeof currentChapter === 'number' && currentChapter >= 0) {
      renderChapter(currentChapter);
    } else {
      renderTitlePage();
    }
    return;
  }

  // User is on a non-chapter page — dispatch by activeTabPage
  switch (window.activeTabPage) {
    case 'library':  openLibrary();                           break;
    case 'settings': renderSettings(window.activeTabId);     break;
    case 'howto':    renderHowToUse(window.activeTabId);     break;
    case 'about':    renderAbout(window.activeTabId);        break;
    case 'leaders':  renderLeadersNotes();                   break;
    case 'progress': renderProgressOverview();               break;
    case 'notes':    renderNotesPage();                      break;
    default:
      // Fallback — shouldn't happen, but safe
      openLibrary();
  }
}

// ── ORPHAN REGISTRY CLEANER ───────────────────────────────────────────────────
// Validates every ID in study_registry against IDB and removes any that have
// no corresponding data (e.g. from a partially-failed delete or stale state).
async function cleanOrphanedRegistry() {
  const registry = JSON.parse(localStorage.getItem('study_registry') || '[]');
  const valid = [];
  for (const id of registry) {
    let exists;
    try {
      exists = await StudyIDB.get(`study_content_${id}`);
    } catch (err) {
      if (err.name === 'IDBUnavailable') { _showIdbUnavailableError(); return; }
      throw err;
    }
    if (exists) valid.push(id);
  }
  if (valid.length !== registry.length) {
    console.warn('cleanOrphanedRegistry: removed', registry.length - valid.length, 'orphaned ID(s)');
    const removed = registry.length - valid.length;
    Swal.fire({
      toast: true,
      position: 'bottom',
      icon: 'warning',
      title: t('appinit_orphan_warning', { count: removed }),
      showConfirmButton: false,
      timer: 4000,
      timerProgressBar: true,
    });
    safeSetItem('study_registry', JSON.stringify(valid));
  }
}

// ── IDB UNAVAILABLE ───────────────────────────────────────────────────────────
function _showIdbUnavailableError() {
  // Render a static error screen — Swal and t() may not be available yet
  // if IDB failed before locale data loaded.
  const content = document.getElementById('mainContent');
  if (content) {
    content.innerHTML = `
      <div style="padding:40px 20px; text-align:center; font-family:sans-serif;">
        <div style="font-size:3rem; margin-bottom:16px;">⚠️</div>
        <h2 style="margin-bottom:12px;">Storage unavailable</h2>
        <p style="color:#888; max-width:320px; margin:0 auto;">
          This app needs browser storage to work. If you’re in a private or
          incognito window, please reopen it in a normal window and try again.
        </p>
      </div>`;
  }
}

// ── INITAPP ───────────────────────────────────────────────────────────────────
  // Called after study data is loaded into the engine.
  // Decides whether to restore a saved position or show the title page,
  // then shows study-specific onboarding on first open of this study.

async function initApp({ isStudySwitch = false } = {}) {
  // Safety guard: if no study has been loaded yet, do nothing.
  if (!window.chapters || !window.chapters.length) return;

  initSettings();

  const _savedPos = appSettings.rememberPosition && getLastPosition();
  // Guard: discard the saved position if its chapter index is out of range
  // for the current study (e.g. switching from a longer study to a shorter one).
  const _launchPos = _savedPos && _savedPos.chapterIdx < window.chapters.length
    ? _savedPos : null;
  if (!_launchPos) clearLastPosition();

  if (_launchPos) {
    await goToChapter(_launchPos.chapterIdx);
    setTimeout(() => window.scrollTo(0, _launchPos.scrollY), 100);
    if (isStudySwitch) {
      // Push a history entry for the new study view WITHOUT re-rendering.
      // goToChapter() above has already rendered it. Using Router.navigate()
      // would call _applyNavigation() → goToChapter() a second time, breaking
      // sticky bars. Using bare history.pushState() bypasses the router's
      // _lastPage tracking and can trigger a spurious popstate in some WebViews.
      // pushWithoutRender() is the correct primitive: it pushes state, updates
      // _lastPage, and never touches _navigating.
      Router.pushWithoutRender({ page: 'chapter', idx: _launchPos.chapterIdx, scrollY: _launchPos.scrollY });
    } else {
      Router.boot({ page: 'chapter', idx: _launchPos.chapterIdx, scrollY: _launchPos.scrollY });
    }
  } else {
    renderTitlePage();
    if (isStudySwitch) {
      // Same reasoning: renderTitlePage() already rendered — just push state.
      Router.pushWithoutRender({ page: 'title' });
    } else {
      Router.boot({ page: 'title' });
    }
  }

  renderMenu();
  // Show app onboarding first; only show study onboarding if app onboarding
  // did not fire (otherwise both overlays stack simultaneously in the DOM,
  // with study onboarding on top, producing the wrong sequence).
  const appOnboardingShown = showAppOnboardingIfNeeded();
  if (!appOnboardingShown) {
    showOnboardingIfNeeded();
  }
}

// ── STARTUP ───────────────────────────────────────────────────────────────────
// Named so that i18n.js / setLanguage() can reference it, but only the
// DOMContentLoaded handler below actually calls it on first load.
// setLanguage() calls reloadLocaleAndRerender() instead — which skips the
// one-time tasks (install default studies, onboarding, registry clean).
async function startApp() {
  initSettings();
  initLongPressCopy();

  // ── ONE-TIME MIGRATION: localStorage → IndexedDB ───────────────────────────
  // Moves all per-study answer data (questions, reflections, notes, Likert
  // responses, starred flags, celebrated flags, and last position) from
  // localStorage into the IDB 'answers' store introduced in DB version 3.
  //
  // Must run before any page is rendered so renderChapter() and
  // renderProgressOverview() always find answer data in IDB, never localStorage.
  //
  // The migration is guarded by a 'bsr_idb_migration_done' flag and is safe
  // to re-run: IDB writes are additive and localStorage keys are only removed
  // after all IDB writes for a study succeed.
  //
  // WHEN TO REMOVE THIS CALL:
  //   Once you are confident that no users remain on a pre-migration version
  //   of the app (i.e. everyone has launched at least once after this update
  //   was shipped), this call and migrate.js can be deleted. A reasonable
  //   horizon is 2-3 app updates after the migration ships, or when analytics
  //   show the 'bsr_idb_migration_done' flag is set for ~100% of active users.
  //   Until then, the guard flag makes this a no-op for already-migrated users,
  //   so there is no performance cost to leaving it in place.
  await migrateAnswersToIDB();
  // ── END MIGRATION ──────────────────────────────────────────────────────────

  // ── RESOLVE LANGUAGE AND LOAD LOCALE DATA ──────────────────────────────────
  const resolvedLang = resolveLanguage();
  applyLanguageToDom(resolvedLang);
  await loadLocale(resolvedLang);

  // Patch the footer if the library was already rendered before data loaded.
  const footerEl = document.getElementById('libraryVersionFooter');
  if (footerEl && window.appAboutData?.appTitle) {
    footerEl.textContent = `${window.appAboutData.appTitle} · v${window.appAboutData.appVersion}`;
  }
  // ── END LOAD APP DATA ───────────────────────────────────────────────────────

  // Signal to loadStudyFromJson that the app is now initialised.
  // Any call that arrived before this point will have set window.pendingStudyData.
  window._appReady = true;

  // Install bundled default studies on first run (silent — no navigation side-effects).
  // Must run before the routing block below so studies are in the registry when
  // openLibrary() renders for the first time.
  await installDefaultStudiesIfNeeded();

  // Case 0: Android delivered a .estudy file before DOMContentLoaded fired.
  // pendingStudyData is already persisted to IDB by loadStudyFromJson,
  // so we just need to apply it. Show app onboarding first if it hasn't been
  // seen (so the user gets the intro before landing in the study).
  if (window.pendingStudyData) {
    showAppOnboardingIfNeeded();
    applyStudyData(window.pendingStudyData);
    window.pendingStudyData = null;
    return;
  }

  await cleanOrphanedRegistry(); // remove stale IDs before any routing decision
  const registry    = JSON.parse(localStorage.getItem('study_registry') || '[]');
  const lastStudyId = localStorage.getItem('bsr_last_active_study');
  const hasLibrary  = registry.length > 0;
  const isFirstRun  = !localStorage.getItem('app_onboarding_complete');

  // Case 3: very first run — show the library (now pre-populated with default
  // studies) behind the app onboarding overlay. Checked before Case 1 and 2
  // so the onboarding is never skipped just because the registry is non-empty.
  if (isFirstRun) {
    openLibrary();
    Router.boot({ page: 'library' });
    showAppOnboarding();
    return;
  }

  // Upgrade onboarding: shown once per version for existing users.
  // Suppressed on first run (isFirstRun already returned above) and on
  // versions where getUpgradeOnboardingSlides() returns [].
  // Does not block the routing cases below — it layers over the library.
  const _appVersion = window.appAboutData?.appVersion;
  if (_appVersion) showUpgradeOnboardingIfNeeded(_appVersion);

  // Case 1: restore or activate the last active study.
  if (lastStudyId && registry.includes(lastStudyId)) {
    try {
      const data = await StudyIDB.get(`study_content_${lastStudyId}`);
      if (data) {
        window.activeStudyId = lastStudyId;
        applyStudyData(data);
        // applyStudyData → initApp() handles position restore internally.
        return;
      }
    } catch (e) {
      if (e.name === 'IDBUnavailable') { _showIdbUnavailableError(); return; }
      console.warn('Failed to restore last study:', e);
      Swal.fire({
        toast: true,
        position: 'bottom',
        icon: 'error',
        title: t('appinit_restore_study_error'),
        showConfirmButton: false,
        timer: 4000,
        timerProgressBar: true,
      });
    }
  }

  // Case 2: library exists but no current study — show the library.
  if (hasLibrary) {
    openLibrary();
    Router.boot({ page: 'library' });
    return;
  }

  // Case 4: no library, not first run — show the Load Study picker.
  openLibrary();
  Router.boot({ page: 'library' });
}

document.addEventListener('DOMContentLoaded', startApp);
