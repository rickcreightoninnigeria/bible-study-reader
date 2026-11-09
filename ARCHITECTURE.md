# Bible Study Reader — Architecture

Written for a planning assistant who cannot see the repo. Describes `main` as of 18 Oct 2026 (after the Go Deeper table and tab-bar commits), plus the fixes noted in section 11. Section 12 lists what was **not** verified.

**What it is.** An offline-first, mobile-first Bible study reader: vanilla JS, no build step, no framework, classic `<script>` tags sharing globals. Runs as a static web page or inside an Android WebView (a separate Kotlin wrapper, not in this repo). Content comes from user-loaded `.estudy` files (zip: `study.json` + `images/`). Answers, studies and images live in IndexedDB; settings in localStorage. Licence CC BY-SA 4.0.

## 1. Files

**`app/index.html`** is the shell: nav bar, chapter drawer, toasts, modal containers, then the scripts. The root `index.html` is a byte-identical copy, kept in sync by a unit test (section 11).

**`app/js/` (first-party)**
- `error-report.js` — loaded FIRST; global `error`/`unhandledrejection` handlers, a log of the last 20 errors (`localStorage` key `bsr_error_log`), `reportError(err, {context, dialog})`, `showErrorDialog()` (message, list of lines, Copy details), a dismissible banner, and the last failed study open (`bsr_last_open_failure`: `recordOpenFailure`/`getOpenFailure`/`clearOpenFailure`, `buildOpenFailureNotice` → the note at the top of the title page, cleared when the study next opens). Builds all DOM with `textContent`. Used by the study loader (open/install failures, per-file install summary) and by `renderChapter()` (one failing item no longer aborts the chapter).
- `diagnostics.js` — the Settings → Diagnostics tab (always the last tab, every interface mode): `collectDiagnostics()`, `formatDiagnosticsReport()` (plain-English text for "Copy report"), `renderDiagnosticsInto()`, `reportProblemByEmail()` (copies the report and opens a `mailto:` to the project address, via `Android.openUrl` when present; the report is trimmed to 6,000 characters, keeping start and end). Read-only: app/device/feature/storage details, installed studies (flags missing content and a version record that disagrees with the saved study), version records left by deleted studies, and the error log from `error-report.js`. Holds no answers or personal data.
- `format-text.js` — DOMPurify config, markdown-it instance, `renderFormatted/renderParas/renderFormattedArray`, footnote-button expansion.
- `state.js` — `window.*` state vars and IDB key helpers (`chapterAnswersIDBKey` etc.).
- `i18n.js` — `LANGUAGE_MAP`, `resolveLanguage`, `applyLanguageToDom`, `t()`, `setLanguage`.
- `idb.js` — `StudyIDB` wrapper.
- `icons.js` — `ICONS` (inline SVG strings).
- `settings.js` — `SETTINGS_DEFAULTS`, `appSettings`, save/reset, clear answers.
- `tts.js`, `voice.js` — read-aloud and voice input (Android bridge, Web Speech fallback).
- `modals.js` — verse/QA/deeper/Likert/info/footnote modals, `renderLikertScale`, `safeSetHtml`, `_safeUrl`.
- `starred.js` — starring questions, starred panels. `getStarredQuestions(ch, record)` is the one list of a chapter's starred questions (panel, Progress page, Share/Print counts); it ignores flags for questions that no longer exist. `toggleStar` clears `storageCache` so Search sees the change.
- `search.js` — search overlay, scoring, synonyms, `debounce`, `storageCache` (every chapter's answer record, including star flags). The Starred chip (`toggleSearchStarFilter`, state `searchStarOnly`, reset when the overlay opens) limits results to starred questions; with it on and fewer than two characters typed, `runSearchCore` lists every starred question in study order instead of showing the prompt. Results for starred questions carry a star in every mode.
- `onboarding.js` — app/study/upgrade onboarding slides, first-use info triggers, `updateNavButtons`.
- `router.js` — `Router`, History API, popstate, modal/overlay back-handling.
- `utils.js` — Swal dark-mode patch, last-position save/restore, toasts, `escapeHtml`, `jsArg`, long-press copy, `getPlatform`.
- `answer-match.js` — pure, DOM-free text matching for the answer check (Unicode-aware normalising, `keyTerms`, result codes). `validation.js` — the answer-check UI: gathers inputs from the question *element* (looked up by the card id, not from `data-*` attributes), maps result codes to translated messages, wires the buttons. Local (offline) answer checks only. It does **not** validate study files. (It once also held an AI tutor; that was removed and `studyAiData` in study files is ignored.)
- `gestures.js` — swipe nav, scroll/visibility saves.
- `navigation.js` — `goToChapter`, menu drawer, non-chapter page reset.
- `share-print.js` — share/export/print answers. `shareAnswers`, `exportStudyAnswers`, `printChapter` and `printAllChapters` take an optional `scope` (`'all'`, `'starred'`, or none). With none, `_resolveStarScope` shows the "All questions / Starred questions only" card (`_askStarScope`) only when something is starred, and the function stops if the reader cancels. `'starred'` keeps just the starred questions (no intro, bridge text, closing, Likert rows or notes); `'all'` in Share all and Print all opens with a starred list (`_shareStarSummary`, `_printStarSummary`). Starred questions are always included in the all-chapters outputs, answered or not. A starred question has `⭐ ` at the start of its first line in shared text and a vector star (`.q-star`) in the print reference bar. Stars are read from the chapter record with `isStarredFromCache`. Print goes through `dispatchPrint`: Android `printContent`, else Android `share` of a text fallback, else the browser print dialog (`_printInFrame`). `printContentPage` (the Print button on the Go Deeper and Leaders' Notes pages) prints the tab on screen from a copy of its rendered HTML: footnotes listed at the end, gallery images inlined as data URLs, buttons removed, and landscape when a table has 4 or more columns.
- `pathways-import.js` — imported pathways, merged pathway reader, active-pathway keys.
- `render-progress.js` — progress page, notes page, pathway progress.
- `render-library.js` — library tabs (All, Recent, Shelves, Paths, Load), pins, delete.
- `study-loader.js` — install/activate studies, `applyStudyData`, `sanitizeStudyData`, zip limits, themes.
- `migrate.js` — one-time localStorage→IDB answer migration.
- `web-app.js` — web build only (inert in the Android app): service-worker registration, durable-storage request, Add to Home Screen hint. See 9a.
- `app-init.js` — `startApp`, `loadLocale`, `initApp`.
- `gallery.js` — image gallery blocks and full-screen viewer.
- `render-pages.js` — title, How-to, Settings, Leaders' Notes, About, Go Deeper pages.
- `render-chapter-elements.js` — per-element renderers; `resolveText`, `buildLangMap`, `studyText`.
- `render-chapter-ui.js` — language bar, notes field, nav buttons, save bar, Read more button.
- `render-chapter.js` — `renderChapter` orchestrator, `_imageBlobCache`.
- `save.js` — save/blur/Likert answer saving.

**Other app files.** `css/01…08` (11 files, `07-pages.css` is ~4,300 lines). `fonts/`. `images/`. `js/locales/<lang>/` holds four JSON files per language (`appAboutData`, `libraryShelvesStructure`, `learningPathways`, `ui`) for 18 languages (am ar en es ff fr ha ig lg ms my ne pt sw tl ur yo zh-CN). `js/appAboutData_untranslated.json` is language-independent app data (`appVersion` 0.6.0, `estudyVersion` "3", `androidPackageId`, `sampleDownloadId`, dates, author/publisher); `appVersion` must be set or version-dependent features silently stop working. The Shelves tab uses `appAboutData.libraryShelvesStructure` (interface language) and `libraryShelvesStructureEn`: a study's `libraryShelves` names are English, and `localiseShelfPlacement()` (render-library.js) swaps each for the translated name at the same position, so every language's shelf list must keep the same shape as the English one (tested). Names are matched as text, ignoring the difference between straight and typographic apostrophes (the lists themselves use ’ throughout, and a test rejects straight quotes in any language's list); `validate_study.py` applies the same rule. `app/estudy-editor.html`, `study-editor.html`, `study-editor-translate.html` and `ui-translate.html` are standalone authoring/translation tools.

**Repo level.** `STUDY-FORMAT.md` (what the code does with a study file: the authoring authority), `AUTHORING-TUTORIAL.md` (short guide), `README.md` (overview, refreshed), `json templates/` (study/pathway templates, `PATHWAY_FORMAT.md` and `example_study_excerpt.json`, a worked example with placeholder text), `estudy_en (v3)/` and `estudy_XX (v3)/` (the study library as `.estudy` files plus unzipped JSON/images), `py/` (xlsx↔json translation scripts, Bible-reference populators, `validate_study.py`, `test_answers.py` (the answer-check test harness: lint, generated weak answers, blind briefing, run; protocol in `ANSWER-CHECK-TESTING.md`; tested by `testing/tests/test-answers.test.js`), `build_web.py` builds the web version), `testing/` (vitest, 16 files, about 495 tests; `testing/local-fixtures/` is git-ignored and holds studies that must not be published, whose tests skip themselves when the file is absent; CI in `.github/workflows/test.yml` runs them from `testing/`).

## 2. Script load order (`app/index.html`)

sweetalert2 → jszip → purify → markdown-it → `format-text` → `state` → `i18n` → `idb` → `icons` → `settings` → `tts` → `voice` → `modals` → `starred` → `search` → `onboarding` → `router` → `utils` → `answer-match` → `validation` → `gestures` → `navigation` → `share-print` → `pathways-import` → `render-progress` → `render-library` → `study-loader` → `migrate` → `web-app` → `app-init` → `gallery` → `render-pages` → `render-chapter-elements` → `render-chapter-ui` → `render-chapter` → `save`.

Rules that matter:
- Files may only *call* later-loaded functions at runtime; load-time dependencies are few. `format-text.js` needs `DOMPurify` and `markdownit` at load. `render-progress.js` calls `debounce` (from `search.js`) at load. `save.js` runs `debounce(updateProgress, 200)` at load, so `search.js` and `render-progress.js` must load before it.
- Top-level `const`/`let` are global lexical bindings (not on `window`).
- `testing/tests/index-html.test.js` checks that every script/stylesheet exists, every `app/js/*.js` file has exactly one tag, the load-time dependencies above are ordered correctly, and the root `index.html` equals `app/index.html`.
- `answer-match.js` has no load-time dependencies and must load before `validation.js`. The Main point modal lives in `modals.js`. The Answer check and Main point buttons are dimmed (`aria-disabled`), not disabled, while the answer is empty: a tap shows the how-to-start toast (`showEmptyAnswerHelp`). The Hint button (`openHintForCard`) shows `questionHintFirst` for an empty answer and `questionHint` otherwise (`_lvPickHint`).
- Other unit tests load source files into `vm` sandboxes in this order; changing load-time dependencies can break them.

## 3. Globals and owners

- **`state.js`** (`window.*`): `chapters`, `titlePageData`, `studyAboutData`, `howToUseData`, `leadersNotesData`, `goDeeperData`, `copyrightData`, `verseData`, `qaCallouts(ById)`, `studyMetadata`, `activeStudyId`, `lastPositionCache`, `currentChapter`, `menuOpen`, `isNonChapterPage`, `activeTabPage`, `activeTabId`, `_appReady`, `pendingStudyData`, `studyOnboardingSlides`, `_lib*`, `FONT_*`. **`applyStudyData()` (study-loader.js) writes the study ones**; `studyAiData` is first created there.
- **Other owners:** `appSettings` (settings.js, `let`); `StudyIDB` (idb.js); `Router` (router.js); `ICONS`; `LANGUAGE_MAP`/`SUPPORTED_LANGUAGES`/`RTL_LANGUAGES` (i18n.js); `appStrings`, `appLocale`, `appAboutData` (written by `loadLocale`, app-init.js); `_activeStudyLang`, `_sessionUiLangOverride` (set by lang bars, i18n-related); `storageCache` (search.js); `_imageBlobCache` (render-chapter.js); `_activeBlobUrls` (study-loader.js); `GODEEPER_TABS`/`LEADERS_TABS`/`HOWTO_TABS` (render-pages.js); `touchstartX/touchendX` (gestures.js); `_readMoreReturn` (render-chapter-ui.js).
- Inline `onclick` handlers need their functions global; several are assigned as `window.fn = …`.

## 4. Storage

**localStorage**
- `study_registry` — JSON array of installed study ids (the library's source of truth, with IDB content).
- `bsr_last_active_study`; `appSettings` (JSON); `app_language`.
- `app_onboarding_complete`, `onboardingComplete_<studyId>`, `featureSeen_*`, `bsr_infoSeen_<id>`, `intermediateDefaultsApplied`.
- `bsr_studyver_<studyId>` — installed `studyVersion`, as written (compared as a decimal number; same/older single-file opens ask the user via `_resolveUserInstall`).
- `default_studies_installed`, `bsr_idb_migration_done`.
- `lib_recent_installed`, `lib_recent_opened`, `lib_pinned`, `lib_pinned_all`.
- `bsr_activePathwayId` — `builtin:<pathwayId>` or `imp:<groupId>:<pathwayId>` (legacy positional values `1_2` / `builtin:1_2` auto-convert via a frozen table).
- `bsr_importedPathways` — `{ groups: [...] }`.
- `localStorage.clear()` = "Reset all data".

**IndexedDB** `BibleStudyReader`, version **3**, three stores with out-of-line keys:
- `studies`: `study_content_<studyId>` → parsed study JSON.
- `images`: Blobs under `<studyId>_cover|publisher|author`, `<studyId>_<elementId>` (inline images), `<studyId>_gallery_<file>` (gallery files).
- `answers`:
  - `<studyId>_ch<N>` → object with fields `q_<elementId>`, `r_<elementId>`, `notes_0`, `likert_<elementId>_<i>`, `star_<elementId>`;
  - `<studyId>_celebrated_ch<N>` → `'1'`;
  - `<studyId>_global_notes`;
  - `<studyId>_lastPosition` → JSON string `{chapterIdx, scrollY}`.
- `N` is `chapterNumber`, **not** the array index. Per-chapter read-modify-write goes through `StudyIDB.updateChapterAnswers` (serialised per key).
- `deleteStudyAnswers`/`removeImagesByPrefix` delete by `<studyId>_` prefix; callers pass `siblingPrefixes(id, registry)` as an exclusion list so a study id that prefixes another (`a` vs `a_b`) does not delete the other's data.

## 5. Routing (`router.js`)

History API only (no hash). State shape: `{ page, idx, tabId, scrollY, studyId }`.

- **Pages:** `title`, `chapter` (`idx` = array index), `library`, `progress`, `howto`, `settings`, `leaders`, `about`, `notes`, `godeeper`, `_exit_guard`. Tabbed pages use `tabId` (Go Deeper uses `ch_<n>`/`intro`).
- **API:** `Router.navigate(dest)` (push + render), `back()` (`history.back()`), `boot`, `replaceState` (tab switches), `pushWithoutRender`.
- **Back steps through the history:** Back (hardware, gesture, Escape) and the close (✕) buttons, which call `Router.back()`, return to the previous page, e.g. the chapter or title page the reader was on before opening Settings, Library, Progress or How to Use. When the history is used up Back shows an exit-confirm Swal, then calls the native exit. (`bca88b6` once made Back always go to the Library; that was undone.)
- **Scroll position:** before leaving a page, `navigate`/`pushWithoutRender` store `window.scrollY` in that page's history entry (`_rememberScroll`, only when the entry is what `_lastPage` says is on screen). On Back a chapter gets it as the `renderChapter` scroll argument; other pages except the Library are scrolled to it after rendering. A new visit starts at the top.
- Popstate first closes an open search overlay or modal (`_closeAnyOpenModal` list, including the gallery viewer), then undoes the navigation with `history.forward()` and ignores the follow-up event.
- `_navigating` makes overlapping navigations silently drop.
- Page renderers set `activeTabPage`/`isNonChapterPage`. The title page sets `isNonChapterPage` but no `activeTabPage`.
- `Router.boot` is called by `initApp`/`startApp`; the Escape key calls `history.back()`.

## 6. Loading and installing studies

**Startup** (`startApp`, on DOMContentLoaded): `initSettings` → `migrateAnswersToIDB` → `resolveLanguage` + `loadLocale` → `_appReady = true` → apply `pendingStudyData` if native delivered one early → `cleanOrphanedRegistry` → first run: Library + app onboarding; else restore `bsr_last_active_study` (`StudyIDB.get` → `applyStudyData` → `initApp`); else Library.

**Entry points** (most end in `_installStudyFileQuietly` or `loadStudyFromFile`; `loadStudyFromJson` stores directly):
- Library/picker file input → `handleFileSelect`/`handlePickerFileChange` (one file: `loadAnyFile`; several: `_installMultipleFiles`).
- Android: `loadStudyFromBase64(b64)` → `loadAnyFile`; `loadStudyFromJson(text)` (plain-JSON path, may arrive before DOMContentLoaded).
- `loadAnyFile` detects: bundle zip (contains `.estudy`/`.zip` entries and no `study.json`; optional root `pathways.json`), single zip study, `.epathway` / plain JSON pathway file (detected by `"estudyPathwayFileVersion"`), or legacy plain-JSON study.

**Per study:** `_checkZipLimits` (≤200 entries, 25 MB/entry, 150 MB total, ratio ≤100, no `..`/`\`/absolute names) → parse `study.json` → require a `[A-Za-z0-9_.-]` `studyId` → `_shouldInstallStudy` (compares `studyVersion` with `bsr_studyver_<id>`; downgrade blocked on user loads) → write images (cover/publisher/author, inline `images/<elementId>.webp`, gallery `src` files) → `StudyIDB.set(study_content_<id>)` → registry push. The quiet installer deletes images it wrote if the install fails part-way. Updates do **not** delete images the new version no longer uses.

**`applyStudyData(data)`:** `sanitizeStudyData` (deep copy; strings containing `<` through DOMPurify; ID-like keys reduced to `[A-Za-z0-9_.-]`) → build normalised `window.chapters` (adds `num`, resolved `chapterTitle`, `intro`, `closing`, `reflection[]`, `sections[]` from flat `elements[]`; this legacy shape feeds search/share/progress/starred; re-resolved by `refreshChapterTextForLang` on language change) → set study globals → resolve cover/publisher/author blob URLs → `applyTheme` → read `lastPositionCache` → `initApp` (restore position or title page, then onboarding). `_revokeAllBlobUrls` runs first, deferred two animation frames.

## 7. study.json blocks and their renderers

`studyMetadata` (id, title/subtitle/shortTitle, `language1..N`, `studyVersion`, `estudyFileVersion`, shelves) → title page, library cards, header. `imageData` → cover/publisher/author. `theme` → 22 CSS custom properties (`THEME_PROPS`), suspended on app pages (`suspendStudyTheme`). `chapters[]` `{chapterNumber, chapterTitle, elements[]}` → `renderChapter`, one renderer per element `type`: `heading`, `text` (subtypes chapterIntro/bridge/chapterClosing…), `biblePassage` (registers `verseData`, outputs no HTML), `question` (subtypes header/reflection/standard; answer textarea, star, sample answer, local validate), `image`, `callout`, `likertScale`; `repeatElement` references another element. `studyOnboardingSlides` → study onboarding overlay. `studyAiData` → deprecated, ignored. `howToUseData` → How-to "Study" tab. `leadersNotesData` → Leaders' Notes (hidden unless `showPageLeaders`). `goDeeperData` → Go Deeper page (tabs, markdown/HTML blocks, footnotes, `readMoreButtons`/`backToStudy` links, Previous/Next chapter buttons built by `_buildGoDeeperNavButtons` with one delegated click listener, `image-gallery` blocks; HTML bodies may contain tables, styled by `.go-deeper-table*` in `07-pages.css`; the active tab is scrolled into view after each render). `studyAboutData`/`copyrightData` → About page. Authoring reference: `STUDY-FORMAT.md`.

Text fields are multilingual via numbered slots (`title1`, `title2`…) mapped by `studyMetadata.language1..N`. Format per field: `HTML`, `markdown`, or `plainText` (also the default); all are sanitised.

## 8. i18n

Two independent languages:
1. **UI language** — `resolveLanguage()` (saved `app_language` → browser language → `en`). `loadLocale(lang)` XHR-fetches four JSON files from `js/locales/<lang>/` (plus `en` fallbacks), merges key-by-key into `window.appStrings` (UI) and file-level into `window.appAboutData` (about, shelves, pathways). `t(key, vars)` returns the key itself when missing. RTL (`ar`, `he`, `fa`, `ur`) via `dir` on `<html>`. `setLanguage` → `reloadLocaleAndRerender`.
2. **Study language** — `window._activeStudyLang`, chosen from a lang bar in chapters, How-to, Leaders' Notes, Go Deeper. `detectAvailableLangs()` reads `studyMetadata.language1..N`; `resolveText`/`resolveTextWithFallback`/`studyText` pick numbered slots with fallback to slot 1 then the plain field. Choosing a study language that is also a supported UI language also switches the UI locale for the session (`_sessionUiLangOverride`).

New UI strings go in `ui_en.json`; other locales fall back to English per key. The built-in pathway files carry permanent `pathwayId`s in all 19 files (a unit test checks them).

## 9. Android bridge (`window.Android`, plain WebView)

**JS → native:** `exitApp()`, `openUrl(url)`, `share(text)`, `printContent(html)`, `speak(text)`, `stopSpeaking()`, `isSpeaking()`, `startVoiceInput()`. Each is feature-detected; web fallbacks exist (`window.open`, `navigator.share`/clipboard, Web Speech; for `printContent`, `dispatchPrint` in `share-print.js` prints from a hidden iframe sandboxed with `allow-modals allow-same-origin` only, so no script in the document can run, waiting up to 3 s for fonts, and removing the frame on `afterprint` or after a minute). `getPlatform()` treats `window.Android` as "android". Router also tries Capacitor/Cordova exit.
**Native → JS globals:** `loadStudyFromBase64(b64)`, `loadStudyFromJson(text)`, `receiveVoiceTranscript(text)`.
Downloads are never fetched in-app: links go to `Android.openUrl`/`window.open`, and the user then opens the file in the app.

## 9a. Web build (GitHub Pages; installable on iPhone and Android browsers)

The web version is the `app/` folder served as static files, plus a generated service worker. Nothing about the app changes; the web-only pieces are inert in the Android app.

- **Build and deploy.** `python3 py/build_web.py --out dist/web` copies `app/` (leaving out the four author tools) and writes `sw.js` from the template `app/sw.js`. `.github/workflows/pages.yml` runs the tests, builds, and publishes to GitHub Pages on every push to `main` that touches `app/`. One-time setup: repository Settings → Pages → Source: GitHub Actions. The site lives under `https://<owner>.github.io/bible-study-reader/`, so every path in the app and the manifest is relative. The build also renders `PRIVACY_POLICY.md` as `privacy.html` (the privacy policy URL given to Google Play: `https://<owner>.github.io/bible-study-reader/privacy.html`; not precached; the workflow also runs when `PRIVACY_POLICY.md` changes). `dist/` is git-ignored. `testing/tests/web-build.test.js` covers the build.
- **Installable.** `manifest.webmanifest` (name, short name "BSR", `display: standalone`, colours from the nav bar `#1c1710`) and the head tags in `index.html` (`apple-touch-icon`, `apple-mobile-web-app-*`, `theme-color`). iPhone has no install prompt, so `web-app.js` shows a one-time Add to Home Screen hint. Icons are generated from `images/icon.png`: `apple-touch-icon.png` (180 px, opaque: iPhone fills transparency with black), `pwa-icon-192/512.png`, and a padded `pwa-icon-maskable-512.png`. `status-bar-style: black-translucent` relies on `.top-nav` padding itself by `env(safe-area-inset-top)`.
- **`web-app.js`** (loaded just before `app-init.js`, no load-time dependencies). `webAppFeaturesEnabled()` is false in the Android app (`window.Android`), on `file://`, and on localhost unless `localStorage.bsr_dev_sw === '1'` (so a dev server never serves cached scripts). It registers `sw.js`, asks for durable storage (`navigator.storage.persist()`) only when running installed, and offers the Add to Home Screen hint to iPhone and iPad browsers (not the installed app) once, after the first-run slides, waiting up to a minute while the What's New slides or a dialog are up.
- **`sw.js`** (template in `app/sw.js`; the build replaces the two `__PRECACHE__` / `__BUILD_ID__` lines). The file list carries a content hash per file, and the build id is a hash of the list, so `sw.js` changes whenever any cached file changes. *Install:* downloads the list into `bsr-code-<id>`; files unchanged since the previous build are copied from the old cache instead of downloaded (readers are often on mobile data); a failed required file aborts the install and the old version keeps running; optional files (Latin fonts, icons) may fail. `firstEstudies.zip` is not precached: the first run fetches it once to install the starter studies and never needs it again. *No `skipWaiting`:* a new build waits until every window of the app is closed, then takes over, so old and new files are never mixed in a session and there is no prompt. *Fetch:* same-origin GET only. Page loads at the scope root or `index.html` get the cached shell; code, English strings and Latin fonts come from the cache; first-use files are cached as they arrive (other languages into the versioned cache, other fonts and images into `bsr-assets`, which survives updates); anything else, and any other site (Google Drive links), goes to the network. `testing/tests/service-worker.test.js` runs it against a fake Cache Storage.
- **Starter studies.** `app/estudy/firstEstudies.zip` is tracked in git (the `.gitignore` exception) and shipped by the build. It must stay identical to the Android project's `assets/estudy/firstEstudies.zip`. Which studies go in it is listed in `py/firstEstudies.list`; `python3 py/build_first_estudies.py` rebuilds the zip from the latest `.estudy` files, validating each, and copies it to the Android assets.
- **Settings → App Updates** shows the `webapp` text ("close the app completely, then open it again") on every non-Android platform, including iPhone browsers; there is no native iPhone app, so the old "Coming soon on the App Store" button is gone.
- **Checked in** Playwright's WebKit (the iPhone 13 profile, not a device): install, offline reload, update waiting, silent takeover on reopening, the hint and the 9 starter studies. A fresh, non-persistent context cannot store Blobs in IndexedDB (study installs fail with "Error preparing Blob/File data"), as in iOS private browsing; a persistent profile works. **Not checked on a real iPhone:** printing (an iframe `print()` may print the whole page), swipe navigation against Safari's back-swipe, and how long iOS keeps a site's storage when the app is not installed.

## 10. Third-party libraries (vendored in `app/js/`)

SweetAlert2 11.26.24, JSZip 3.10.1, DOMPurify 3.4.3, markdown-it 14.1.1. Dev only: vitest 2, fake-indexeddb. All fonts are bundled in `app/fonts/` and declared in `css/01-fonts.css` (29 faces, all load locally; the app makes no font requests). Only the four editor tools still link Google Fonts; the print document declares its own bundled faces. The app itself makes no JavaScript-initiated request to an external host (the locale and library loaders use relative XHR; downloads are handed to the browser).

## 11. Fragile or surprising

- **Bundled studies:** `startApp` calls `installDefaultStudiesIfNeeded()` on first run for each `appVersion`. It reads `estudy/firstEstudies.zip` by XHR; that zip is not in the repo (it is added to the build). A missing file (404) is treated as normal: a console note, no toast, and the flag is not set, so a later build that has the zip still installs. Covered by `default-studies.test.js`.
- **App data file:** `appVersion`, `estudyVersion`, `androidPackageId` live only in `appAboutData_untranslated.json`. It was once emptied by mistake (commits `811799f`/`90dafec`), silently disabling the version footer, upgrade onboarding, the `.estudy` version check and Play Store links; now restored. The upgrade-onboarding slide for 0.6.0 ("moving to database storage") shows once to existing users who never saw it.
- **Docs and CI:** `README.md` and the `index.html` header were refreshed; the CI workflow now lives where GitHub reads it. Docs can still drift: prefer the code and `STUDY-FORMAT.md` when they disagree.
- **Chapter identity:** answers key on `chapterNumber`; the router, menu and swipe use array index. Chapter numbering can start at 0 or mid-series. Never assume `idx = chapterNumber − 1`.
- **Back always goes to the Library**, and `_navigating` drops overlapping navigations.
- **Everything is global**: new function names can collide silently; load order matters.
- **Block keys:** in multilingual studies a trailing digit on a Go Deeper/Leaders' key is a language slot; in mono-lingual studies it is part of the name.
- **Security model:** study files are untrusted. Defences are `sanitizeStudyData` at load, DOMPurify on formatted fields, escaping at attribute sites, `jsArg()`/numeric indices for inline handlers, and `data-*` + delegated listeners. New code interpolating study strings into HTML or `onclick` reintroduces injection.
- **Storage limits:** localStorage ~5 MB; study JSON can exceed 500 KB and is read whole from IDB.
- **Guarded by tests:** vitest sandboxes use `vm` and load files in a fixed order.
- **Android Back and safe-area behaviour** of the gallery viewer is untested on devices.

## 12. Not verified

- **No device or WebView testing.** Everything was run in desktop Chromium via Playwright; Android WebView, iOS, and the Kotlin wrapper (not in this repo) were not examined.
- **Not read in full:** `onboarding.js`, `validation.js` (local validation internals), `tts.js`/`voice.js` beyond the bridge calls, `render-library.js` shelves logic, the CSS files, the four editor HTML tools, the `py/` scripts, `render-pages.js` Settings/How-to/About internals, `migrate.js` internals.
- **Rendering of `howToUseData`, `studyAboutData`, `copyrightData`** was traced in `render-pages.js` for the fields `STUDY-FORMAT.md` lists; other fields are spot-checked.
- **The Android-to-JS call names** are taken from JS definitions; the native side's actual invocations were not seen.
- **Which `index.html` is deployed** (root copy or `app/`), and how the web build is hosted, is unknown; both are kept identical.
- **Library tab counts, shelves and recent lists** (`lib_*` key shapes) were read from code only.
