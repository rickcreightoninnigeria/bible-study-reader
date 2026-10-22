# Bible Study Reader — Architecture

Written for a planning assistant who cannot see the repo. Describes `main` as of 18 Oct 2026 (after the Go Deeper table and tab-bar commits), plus the fixes noted in section 11. Section 12 lists what was **not** verified.

**What it is.** An offline-first, mobile-first Bible study reader: vanilla JS, no build step, no framework, classic `<script>` tags sharing globals. Runs as a static web page or inside an Android WebView (a separate Kotlin wrapper, not in this repo). Content comes from user-loaded `.estudy` files (zip: `study.json` + `images/`). Answers, studies and images live in IndexedDB; settings in localStorage. Licence CC BY-SA 4.0.

## 1. Files

**`app/index.html`** is the shell: nav bar, chapter drawer, toasts, modal containers, then the scripts. The root `index.html` is a byte-identical copy, kept in sync by a unit test (section 11).

**`app/js/` (first-party)**
- `error-report.js` — loaded FIRST; global `error`/`unhandledrejection` handlers, a log of the last 20 errors (`localStorage` key `bsr_error_log`), `reportError(err, {context, dialog})`, `showErrorDialog()` (message, list of lines, Copy details), a dismissible banner. Builds all DOM with `textContent`. Used by the study loader (open/install failures, per-file install summary) and by `renderChapter()` (one failing item no longer aborts the chapter).
- `format-text.js` — DOMPurify config, markdown-it instance, `renderFormatted/renderParas/renderFormattedArray`, footnote-button expansion.
- `state.js` — `window.*` state vars and IDB key helpers (`chapterAnswersIDBKey` etc.).
- `i18n.js` — `LANGUAGE_MAP`, `resolveLanguage`, `applyLanguageToDom`, `t()`, `setLanguage`.
- `idb.js` — `StudyIDB` wrapper.
- `icons.js` — `ICONS` (inline SVG strings).
- `settings.js` — `SETTINGS_DEFAULTS`, `appSettings`, save/reset, clear answers.
- `tts.js`, `voice.js` — read-aloud and voice input (Android bridge, Web Speech fallback).
- `modals.js` — verse/QA/deeper/Likert/info/footnote modals, `renderLikertScale`, `safeSetHtml`, `_safeUrl`.
- `starred.js` — starring questions, starred panels.
- `search.js` — search overlay, scoring, synonyms, `debounce`, `storageCache`.
- `onboarding.js` — app/study/upgrade onboarding slides, first-use info triggers, `updateNavButtons`.
- `router.js` — `Router`, History API, popstate, modal/overlay back-handling.
- `utils.js` — Swal dark-mode patch, last-position save/restore, toasts, `escapeHtml`, `jsArg`, long-press copy, `getPlatform`.
- `answer-match.js` — pure, DOM-free text matching for the answer check (Unicode-aware normalising, `keyTerms`, result codes). `validation.js` — the answer-check UI: gathers inputs from the question *element* (looked up by the card id, not from `data-*` attributes), maps result codes to translated messages, wires the buttons. Local (offline) answer checks only. It does **not** validate study files. (It once also held an AI tutor; that was removed and `studyAiData` in study files is ignored.)
- `gestures.js` — swipe nav, scroll/visibility saves.
- `navigation.js` — `goToChapter`, menu drawer, non-chapter page reset.
- `share-print.js` — share/export/print answers.
- `pathways-import.js` — imported pathways, merged pathway reader, active-pathway keys.
- `render-progress.js` — progress page, notes page, pathway progress.
- `render-library.js` — library tabs (All, Recent, Shelves, Paths, Load), pins, delete.
- `study-loader.js` — install/activate studies, `applyStudyData`, `sanitizeStudyData`, zip limits, themes.
- `migrate.js` — one-time localStorage→IDB answer migration.
- `app-init.js` — `startApp`, `loadLocale`, `initApp`.
- `gallery.js` — image gallery blocks and full-screen viewer.
- `render-pages.js` — title, How-to, Settings, Leaders' Notes, About, Go Deeper pages.
- `render-chapter-elements.js` — per-element renderers; `resolveText`, `buildLangMap`, `studyText`.
- `render-chapter-ui.js` — language bar, notes field, nav buttons, save bar, Read more button.
- `render-chapter.js` — `renderChapter` orchestrator, `_imageBlobCache`.
- `save.js` — save/blur/Likert answer saving.

**Other app files.** `css/01…08` (11 files, `07-pages.css` is ~4,300 lines). `fonts/`. `images/`. `js/locales/<lang>/` holds four JSON files per language (`appAboutData`, `libraryShelvesStructure`, `learningPathways`, `ui`) for 18 languages (am ar en es ff fr ha ig lg ms my ne pt sw tl ur yo zh-CN). `js/appAboutData_untranslated.json` is language-independent app data (`appVersion` 0.6.0, `estudyVersion` "3", `androidPackageId`, `sampleDownloadId`, dates, author/publisher); `appVersion` must be set or version-dependent features silently stop working. `app/estudy-editor.html`, `study-editor.html`, `study-editor-translate.html` and `ui-translate.html` are standalone authoring/translation tools.

**Repo level.** `STUDY-FORMAT.md` (what the code does with a study file: the authoring authority), `AUTHORING-TUTORIAL.md` (short guide), `README.md` (overview, refreshed), `json templates/` (study/pathway templates, `PATHWAY_FORMAT.md` and `example_study_excerpt.json`, a worked example with placeholder text), `estudy_en (v3)/` and `estudy_XX (v3)/` (the study library as `.estudy` files plus unzipped JSON/images), `py/` (xlsx↔json translation scripts, Bible-reference populators, `validate_study.py`), `testing/` (vitest, 16 files, about 495 tests; `testing/local-fixtures/` is git-ignored and holds studies that must not be published, whose tests skip themselves when the file is absent; CI in `.github/workflows/test.yml` runs them from `testing/`).

## 2. Script load order (`app/index.html`)

sweetalert2 → jszip → purify → markdown-it → `format-text` → `state` → `i18n` → `idb` → `icons` → `settings` → `tts` → `voice` → `modals` → `starred` → `search` → `onboarding` → `router` → `utils` → `answer-match` → `validation` → `gestures` → `navigation` → `share-print` → `pathways-import` → `render-progress` → `render-library` → `study-loader` → `migrate` → `app-init` → `gallery` → `render-pages` → `render-chapter-elements` → `render-chapter-ui` → `render-chapter` → `save`.

Rules that matter:
- Files may only *call* later-loaded functions at runtime; load-time dependencies are few. `format-text.js` needs `DOMPurify` and `markdownit` at load. `render-progress.js` calls `debounce` (from `search.js`) at load. `save.js` runs `debounce(updateProgress, 200)` at load, so `search.js` and `render-progress.js` must load before it.
- Top-level `const`/`let` are global lexical bindings (not on `window`).
- `testing/tests/index-html.test.js` checks that every script/stylesheet exists, every `app/js/*.js` file has exactly one tag, the load-time dependencies above are ordered correctly, and the root `index.html` equals `app/index.html`.
- `answer-match.js` has no load-time dependencies and must load before `validation.js`. The Main point modal lives in `modals.js`.
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
- `bsr_studyver_<studyId>` — installed `studyVersion` (version gate for loads).
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
- **Back is deliberately flattened:** from any page Back renders the Library; from the Library it shows an exit-confirm Swal then calls the native exit. Close (✕) buttons use `Router.back()`, so they also go to the Library.
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

**JS → native:** `exitApp()`, `openUrl(url)`, `share(text)`, `printContent(html)`, `speak(text)`, `stopSpeaking()`, `isSpeaking()`, `startVoiceInput()`. Each is feature-detected; web fallbacks exist (`window.open`, `navigator.share`/clipboard, `window.print`, Web Speech). `getPlatform()` treats `window.Android` as "android". Router also tries Capacitor/Cordova exit.
**Native → JS globals:** `loadStudyFromBase64(b64)`, `loadStudyFromJson(text)`, `receiveVoiceTranscript(text)`.
Downloads are never fetched in-app: links go to `Android.openUrl`/`window.open`, and the user then opens the file in the app.

## 10. Third-party libraries (vendored in `app/js/`)

SweetAlert2 11.26.24, JSZip 3.10.1, DOMPurify 3.4.3, markdown-it 14.1.1. Dev only: vitest 2, fake-indexeddb. All fonts are bundled in `app/fonts/` and declared in `css/01-fonts.css` (29 faces, all load locally; the app makes no font requests). Only the print window (`share-print.js`) and the four editor tools still link Google Fonts. The app itself makes no JavaScript-initiated request to an external host (the locale and library loaders use relative XHR; downloads are handed to the browser).

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
- **Not read in full:** `onboarding.js`, `validation.js` (local validation internals), `tts.js`/`voice.js` beyond the bridge calls, `render-library.js` shelves logic, `share-print.js` print HTML, the CSS files, the four editor HTML tools, the `py/` scripts, `render-pages.js` Settings/How-to/About internals, `migrate.js` internals.
- **Rendering of `howToUseData`, `studyAboutData`, `copyrightData`** was traced in `render-pages.js` for the fields `STUDY-FORMAT.md` lists; other fields are spot-checked.
- **The Android-to-JS call names** are taken from JS definitions; the native side's actual invocations were not seen.
- **Which `index.html` is deployed** (root copy or `app/`), and how the web build is hosted, is unknown; both are kept identical.
- **Library tab counts, shelves and recent lists** (`lib_*` key shapes) were read from code only.
