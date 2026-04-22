# Bible Study Reader

A mobile-first, offline-capable web app for structured Bible study. It loads
content from `.estudy` files, lets users write and save answers, and can be
deployed as a static web page or wrapped in a WebView for Android and iOS.

Licensed **CC BY-SA 4.0** — Rick Creighton, 2026.

---

## Contents

1. [Key features](#key-features)
2. [Repository structure](#repository-structure)
3. [Script loading order](#script-loading-order)
4. [CSS architecture](#css-architecture)
5. [The `.estudy` file format](#the-estudy-file-format)
6. [Storage model](#storage-model)
7. [Internationalisation (i18n)](#internationalisation-i18n)
8. [Settings system](#settings-system)
9. [Android / WebView integration](#android--webview-integration)
10. [Third-party dependencies](#third-party-dependencies)
11. [Running locally](#running-locally)
12. [Contributing](#contributing)
13. [Licence](#licence)

---

## Key features

- **Study library** — install, organise, pin, and delete multiple `.estudy`
  files; shelves and curated learning pathways are built in.
- **Chapter-by-chapter content** — question cards, answer textareas, Likert
  scales, verse pop-ups, QA callout modals, "go deeper" prompts, opening
  quotes, and reflection questions.
- **Answer persistence** — all answers auto-save to `localStorage` on blur;
  manual Save button also available.
- **Progress tracking** — per-chapter completion rings and a full Progress
  Overview page; starred/bookmarked questions panel.
- **Full-text search** — searches questions, bridge text, and the user's own
  saved answers, with debouncing, synonym expansion, and fuzzy matching.
- **Text-to-speech** — Web Speech API with chunked long-text queuing; Android
  native TTS bridge also supported.
- **Voice input** — Web Speech API microphone or Android native voice input.
- **Export & share** — copy formatted answers to clipboard, share via the
  Web Share API, or print to PDF.
- **Onboarding & feature tutorials** — slide-based overlay engine for
  first-run guidance and optional per-feature tutorials.
- **Dark mode** — toggle in Settings; CSS custom properties throughout.
- **Multilingual UI** — 13 languages built in (see [i18n](#internationalisation-i18n)),
  with full RTL layout support for Arabic.
- **Swipe navigation** — horizontal swipe moves between chapters; also
  navigates between tabs on Settings and How To pages.
- **Offline-first** — all fonts, scripts, and styles are local; no CDN
  calls at runtime (font files must be placed in `fonts/` — see below).

---

## Repository structure

```
index.html                  Main app shell (HTML skeleton only — no inline JS or CSS)

css/
  01-fonts.css              @font-face declarations; per-script :lang() overrides
  02-variables.css          CSS custom properties (design tokens, colour palette)
  03-base.css               Reset, body, content wrapper, RTL base
  04-chrome.css             Persistent app shell: top nav, chapter menu, save bar
  05a-components.cards.display.css   Read-only content cards (intro, bridge, quotes)
  05b-components.cards.responses.css Question cards, answer fields, Likert scale
  05c-components.nav.css    Toasts, version warning, chapter nav buttons
  05d-components.starred.css Starred-questions summary panel
  06-overlays.css           Bottom-sheets, verse modal, QA modal, search overlay, onboarding
  07-pages.css              Full-screen pages: library, settings, progress, notes, about
  08-themes.css             Print / PDF export styles (@media print)

js/
  state.js                  All mutable globals (chapters, settings, nav state, storage-key helpers)
  i18n.js                   Language resolution, DOM direction, t() translation function
  idb.js                    IndexedDB wrapper (StudyIDB) for large study blobs and cover images
  icons.js                  SVG icon sets (Rounded / Bold / Solid); applyIconTheme()
  settings.js               SETTINGS_DEFAULTS, appSettings object, initSettings(), renderSettings()
  tts.js                    Text-to-speech: Web Speech API + Android bridge, chunked long text
  voice.js                  Voice input: Web Speech API + Android bridge
  modals.js                 Verse modal, QA modal, Go Deeper modal, info trigger system, Likert popup
  starred.js                Star/bookmark toggle, starred summary panel builder
  search.js                 Full-text search: open/close overlay, scoring, debounce, cache
  onboarding.js             Slide overlay engine: app onboarding, study onboarding, feature tutorials
  utils.js                  Last-position save/restore, showToast(), autoResize, long-press copy
  save.js                   saveAnswers() — writes answer fields to localStorage
  validation.js             AI Tutor (Socratic feedback) and local offline answer validation
  share-print.js            Swipe gesture handler, scroll/visibility listeners
  navigation.js             goToChapter(), goToTitlePage(), menu open/close, tab reset
  render-progress.js        Progress Overview page, Notes page, pathway helpers
  render-library.js         Library page: tabs (Load / All / Recent / Shelves / Paths), reorder mode
  study-loader.js           .estudy version check, applyStudyData(), file loading router, Android entry points
  app-init.js               DOMContentLoaded startup sequence; locale loader; reloadLocaleAndRerender()
  render-pages.js           Non-chapter pages: How To, Settings, Leaders Notes, About, Copyright
  render-chapter.js         Main renderChapter() — builds full chapter HTML from chapters[] data
  main.js                   renderMenu(), renderTitlePage(), progress bar update, initApp()

  locales/
    appAboutData_untranslated.json     Non-string App Data that doesn't need translated: version strings, estudyVersion
    en/
      ui_en.json                       All English UI strings (keyed by feature/file prefix)
      learningPathways_en.json         Curated study pathway definitions
      libraryShelvesStructure_en.json  OT/NT shelf taxonomy for the library
      appAboutData_en.json             App "about" copy text

  sweetalert2.all.min.js    Bundled SweetAlert2 v11.26.24 (MIT)
  jszip.min.js              Bundled JSZip v3.10.1 (MIT)

fonts/                      
images/
  favicon.svg
```

---

## Script loading order

The app uses **no bundler or module system**. Every script file declares its
exports as plain `window`/`var` globals. The `<script>` tags in `index.html`
must appear in exactly this order because each file depends on globals that
earlier files have already declared.

| # | File | Key globals it declares | Depends on |
|---|------|------------------------|------------|
| 1 | `sweetalert2.all.min.js` | `Swal` / `Sweetalert2` | — |
| 2 | `jszip.min.js` | `JSZip` | — |
| 3 | `state.js` | `chapters`, `currentChapter`, `appSettings` shape, `storageKey()`, `likertKey()`, all `window.*` state | — |
| 4 | `i18n.js` | `t()`, `resolveLanguage()`, `setLanguage()` | `state.js` |
| 5 | `idb.js` | `StudyIDB` | — |
| 6 | `icons.js` | `ICONS`, `applyIconTheme()` | `state.js` |
| 7 | `settings.js` | `appSettings`, `initSettings()`, `saveSetting()`, `renderSettings()`, `autoResize()` | `state.js`, `icons.js` |
| 8 | `tts.js` | `ttsAvailable()`, `ttsSpeak()`, `ttsStop()` | `settings.js` |
| 9 | `voice.js` | `voiceInputAvailable()`, `startVoiceInput()` | `settings.js` |
| 10 | `modals.js` | `openVerseModal()`, `openQaModal()`, `openDeeperModal()`, `renderLikertScale()`, info trigger system | `icons.js`, `settings.js`, `tts.js` |
| 11 | `starred.js` | `isStarred()`, `toggleStar()`, `getStarredQuestions()`, `buildStarredSummaryHtml()` | `state.js` |
| 12 | `search.js` | `openSearch()`, `closeSearch()`, `debouncedRunSearch()`, `storageCache` | `icons.js`, `state.js` |
| 13 | `onboarding.js` | `showAppOnboarding()`, `showOnboardingIfNeeded()`, `showFeatureTutorial()`, `showSlideOverlay()` | `settings.js`, `icons.js` |
| 14 | `utils.js` | `saveLastPosition()`, `getLastPosition()`, `showToast()`, `initLongPressCopy()` | `state.js` |
| 15 | `save.js` | `saveAnswers()` | `state.js`, `search.js`, `utils.js` |
| 16 | `validation.js` | `openAiTutorForCard()`, `openLocalValidateForCard()` | `state.js`, `icons.js`, `save.js` |
| 17 | `share-print.js` | `touchstartX`, `touchendX`, `handleGesture()` | `settings.js`, `state.js` |
| 18 | `navigation.js` | `goToChapter()`, `goToTitlePage()`, `closeMenu()`, `closeNonChapterPage()`, `_resetNonChapterPageState()` | `icons.js`, `settings.js`, `state.js` |
| 19 | `render-progress.js` | `renderProgressOverview()`, `renderNotesPage()`, `getActivePathway()` | `icons.js`, `settings.js`, `state.js`, `starred.js`, `navigation.js` |
| 20 | `render-library.js` | `renderLibrary()`, `recordStudyOpened()`, `recordStudyInstalled()`, library history helpers | `idb.js`, `icons.js`, `settings.js`, `utils.js` |
| 21 | `study-loader.js` | `applyStudyData()`, `loadAnyFile()`, `loadStudyFromJson()`, `loadStudyFromBase64()`, `activateStudy()`, `deleteStudy()`, `openLibrary()` | Most of the above |
| 22 | `app-init.js` | `startApp()`, `reloadLocaleAndRerender()` | Everything above |
| 23 | `render-pages.js` | `renderHowToUse()`, `renderSettings()` (augments settings.js), `renderLeadersNotes()`, `renderAbout()`, `navigateTab()` | `icons.js`, `settings.js`, `onboarding.js`, `navigation.js` |
| 24 | `render-chapter.js` | `renderChapter()` | Almost everything |
| 25 | `main.js` | `renderMenu()`, `renderTitlePage()`, `updateProgress()`, `initApp()` | Everything |

---

## CSS architecture

CSS files are numbered to enforce load order and reflect the layer hierarchy.
Each file is self-contained and includes its own dark-mode overrides at the
bottom (co-located rather than collected in `08-themes.css`, which is reserved
for print styles only).

| File | Responsibility |
|------|---------------|
| `01-fonts.css` | `@font-face` rules for all Latin and non-Latin fonts; per-script `:lang()` font overrides for Arabic, Hebrew, Devanagari, Myanmar, CJK, Hangul, Cyrillic, Greek |
| `02-variables.css` | All CSS custom properties: colour palette (light + dark tokens), shadow, and typography stacks. **Change colours here only.** |
| `03-base.css` | Box-sizing reset, `body`, `.content` wrapper, blockquote, RTL base rules |
| `04-chrome.css` | Sticky top nav, chapter menu drawer, save bar, chapter nav buttons, close-button animations |
| `05a-components.cards.display.css` | Read-only cards: chapter header, section header, intro, bridge text, opening quotes, chapter images, speak button |
| `05b-components.cards.responses.css` | Interactive cards: question card wrapper, answer textarea, mic button, Likert scale + popup, AI Tutor / local-validate buttons |
| `05c-components.nav.css` | Toasts (save, celebration, version warning), GPU compositing hints |
| `05d-components.starred.css` | Starred-questions collapsible summary panel |
| `06-overlays.css` | Fixed-position layers: verse modal, QA modal, go-deeper modal, onboarding slides, search overlay, info-trigger popups |
| `07-pages.css` | Full-screen page views: title page, How To, Settings, Progress, Notes, Library, About, Copyright |
| `08-themes.css` | `@media print` styles only — hides chrome, renders answer fields as static text for PDF export |

Every file that touches layout also includes **RTL overrides** (for `dir="rtl"`,
set automatically when the user selects Arabic) and **script overrides**
(`:lang()` rules for letter-spacing, line-height, and font-family).

---

## The `.estudy` file format

A `.estudy` file is a **JSON file** (optionally bundled as a ZIP) that
contains all the content for one Bible study series. The app validates the
file's `estudyFileVersion` against the version declared in
`locales/en/appAboutData_en.json` and shows a non-blocking warning if they
differ.

For full details on authoring `.estudy` files — including the complete JSON
schema, element types, verse data format, and how to include cover images —
see **[ESTUDY_FORMAT.md](ESTUDY_FORMAT.md)** (to be written).

Key top-level fields at a glance:

| Field | Purpose |
|-------|---------|
| `studyMetadata` | `studyId`, `estudyFileVersion`, title, author, language |
| `titlePageData` | Cover image ref, title, subtitle, author, publisher, CTA button label |
| `chapters[]` | Array of chapter objects — each has `chapterNumber`, `chapterTitle`, `elements[]` |
| `verseData` | Map of verse references → NET Bible text, used by verse pop-up modals |
| `qaCallouts` / `qaCalloutsById` | Legacy (v1) and current (v2) inline callout definitions |
| `studyOnboardingSlides` | Optional first-run slides shown when the study is opened for the first time |
| `studyAiData` | Optional AI Tutor configuration: API key (plain or obfuscated), system prompt, model |
| `howToUseData` | Optional study-specific content injected into the How To page |
| `leadersNotesData` | Optional leaders' notes page content |
| `copyrightData` | Copyright and licence text |

---

## Storage model

The app uses two persistence layers:

### localStorage

Used for everything except large study content. All app keys are prefixed with
`bsr_` for safe bulk deletion. Key patterns:

| Pattern | Contains |
|---------|----------|
| `bsr_{studyId}_ch{N}_q_{sIdx}_{qIdx}` | User's answer to question `qIdx` in section `sIdx` of chapter `N` |
| `bsr_{studyId}_ch{N}_r_{rIdx}` | User's answer to reflection question `rIdx` in chapter `N` |
| `bsr_{studyId}_ch{N}_notes_0` | Free-text notes for chapter `N` |
| `bsr_{studyId}_ch{N}_likert_{elementId}_{stIdx}` | Likert scale response |
| `bsr_{studyId}_star_ch{N}_{elementId}` | `"1"` if a question is starred |
| `lastPosition_{studyId}` | `{ chapterIdx, scrollY }` — last reading position |
| `appSettings` | Serialised `appSettings` object |
| `app_language` | User's chosen UI language code |
| `app_onboarding_complete` | `"1"` once the app-level onboarding has been seen |
| `lib_recent_opened` | JSON array of recently opened study IDs (newest first, max 7) |
| `lib_recent_installed` | JSON array of recently installed study IDs (newest first, max 4) |
| `lib_pinned` | JSON array of pinned study IDs (Recent tab) |
| `lib_pinned_all` | JSON array of pinned study IDs (All tab) |
| `bsr_activePathwayId` | Active learning pathway key (`"{l1Idx}_{l2Idx}"`) |

### IndexedDB

Managed by `StudyIDB` in `idb.js`. Database name: `BibleStudyReader`,
version 2. Two object stores:

- **`studies`** — stores the parsed study JSON object for each installed study,
  keyed by `studyId`. This avoids the ~5 MB localStorage limit for large studies.
- **`images`** — stores cover/publisher/author images as Blobs, keyed by
  `{studyId}_cover`, `{studyId}_publisher`, `{studyId}_author`.

---

## Internationalisation (i18n)

All user-facing strings are looked up at runtime via the `t(key, vars)`
function defined in `i18n.js`. This means the app can be re-rendered in a
different language without a page reload — `reloadLocaleAndRerender()` in
`app-init.js` fetches the new locale files and re-renders the current view.

### Supported languages (UI)

| Code | Language | Script |
|------|----------|--------|
| `en` | English | Latin |
| `fr` | Français | Latin |
| `es` | Español | Latin |
| `pt` | Português | Latin |
| `ha` | Hausa | Latin |
| `ff` | Fulfulde | Latin |
| `sw` | Swahili | Latin |
| `ig` | Igbo | Latin |
| `ms` | Melayu | Latin |
| `yo` | Yorùbá | Latin |
| `ne` | नेपाली (Nepali) | Devanagari |
| `am` | አማርኛ (Amharic) | Ethiopic |
| `ar` | العربية (Arabic) | Arabic (RTL) |

RTL layout is applied automatically: when the language is set to `ar`,
`i18n.js` sets `dir="rtl"` on `<html>` and all CSS RTL overrides activate via
attribute selectors.

### Locale file structure

Each language has a folder at `js/locales/{lang}/` containing:

- **`ui_{lang}.json`** — every UI string, keyed by `{file_or_feature}_{description}`.
  English is the canonical reference; other languages mirror these keys exactly.
- **`learningPathways_{lang}.json`** — translated pathway titles and descriptions.
- **`libraryShelvesStructure_{lang}.json`** — translated shelf/section names.
- **`appAboutData_{lang}.json`** — app "about" text, version strings, and
  `estudyVersion` (the file format version this build expects).

To add a new UI language, add the language code to `SUPPORTED_LANGUAGES` in
`i18n.js`, create the locale folder with all four JSON files translated, and
add an entry to `LANGUAGE_MAP` in `render-pages.js`.

---

## Settings system

All user preferences live in a single `appSettings` object, initialised in
`settings.js` from `SETTINGS_DEFAULTS` merged with whatever is persisted in
`localStorage` under the key `appSettings`.

Selected defaults and what they do:

| Key | Default | Effect |
|-----|---------|--------|
| `darkMode` | `false` | Toggles `body.dark-mode` class |
| `fontSize` | `16` | Sets `html` font-size (px); range 14–24 |
| `useSansSerif` | `true` | Switches body font between Inter (sans) and Source Serif 4 |
| `iconStyle` | `'rounded'` | Selects icon set: `rounded`, `bold`, or `solid` |
| `interfaceMode` | `'basic'` | `basic` hides advanced features; `intermediate` reveals them |
| `rememberPosition` | `true` | Saves/restores chapter and scroll position between sessions |
| `showProgressBar` | `true` | Shows the thin progress bar in the top nav |
| `ttsMode` | `'always'` | When to show TTS buttons: `always`, `long` (≥200 chars), `never` |
| `swipeSensitivity` | `'low'` | Swipe threshold for chapter/tab navigation |
| `shareFormat` | `'formatted'` | Answer export format: `formatted` or `plain` |
| `localValidateMode` | `'auto'` | When to show the local answer validator button |

Settings are written immediately on change via `saveSetting(key, value)`, which
updates `appSettings` in memory and serialises the whole object back to
`localStorage`.

---

## Android / WebView integration

The app detects a `window.Android` object injected by the WebView host and
routes several features through it:

| Bridge method | Called from | Purpose |
|---------------|-------------|---------|
| `Android.speak(text)` | `tts.js` | Native TTS playback |
| `Android.stopSpeaking()` | `tts.js` | Stop TTS |
| `Android.isSpeaking()` | `tts.js` | Query TTS state |
| `Android.startVoiceInput()` | `voice.js` | Open native speech recognition |

The WebView host can also push a study into the app before the DOM is ready by
setting `window.pendingStudyData` to a parsed study object, or by calling
either of these functions once the app has started:

- **`loadStudyFromJson(jsonString)`** — accepts a raw JSON string.
- **`loadStudyFromBase64(base64String)`** — accepts a base64-encoded `.estudy`
  ZIP or JSON. Used to deliver study files from Android's asset storage.

When a voice recognition result is available, the Android host should call
`window.receiveVoiceTranscript(transcript)` — defined in `voice.js`.

If `window.Android` is not present, all these features fall back gracefully to
their Web API equivalents (Web Speech API for TTS and voice input) or are
hidden from the UI.

---

## Third-party dependencies

Both libraries are **bundled directly** in the `js/` folder. There is no
package manager, no `node_modules`, and no build step.

| Library | Version | Licence | File | Purpose |
|---------|---------|---------|------|---------|
| [SweetAlert2](https://sweetalert2.github.io) | 11.26.24 | MIT | `sweetalert2.all.min.js` | Confirm dialogs (delete study, clear answers, etc.) |
| [JSZip](https://stuk.github.io/jszip/) | 3.10.1 | MIT | `jszip.min.js` | Reading bundled `.estudy` ZIP files |

No other external scripts, no CDN calls at runtime.

---

## Running locally

1. **Clone the repository.**

2. **Download fonts.** The `fonts/` folder is not included in this repo
   because the font files are large and subject to their own licences. Download
   the following families from [Google Fonts](https://fonts.google.com) and
   place the `.ttf` files in `fonts/`:
   - Playfair Display (Regular, Italic, SemiBold)
   - Source Serif 4 (Light, LightItalic, Regular, Italic)
   - DM Mono (Regular, Medium)
   - Inter (Regular, Italic, Medium)
   - Noto Sans Arabic, Noto Sans Devanagari, Noto Sans Ethiopic, Noto Serif CJK SC
     (for non-Latin language support — only needed if you plan to use those UI languages)

   The app works without these files — browsers will substitute system fonts —
   but the intended typographic design relies on them.

3. **Serve over HTTP.** Some browser security policies block `localStorage` and
   `IndexedDB` on `file://` URLs. Serve the project root with any local HTTP
   server, for example:
   ```bash
   npx serve .
   # or
   python3 -m http.server 8080
   ```
   Then open `http://localhost:8080` in your browser.

4. **Load a study.** Use the Library → Load button to open a `.estudy` file
   from your local machine. See [ESTUDY_FORMAT.md](ESTUDY_FORMAT.md) for how
   to create one.

---

## Contributing

Contributions are welcome. A few things to know before you start:

**Architecture constraints.** The app intentionally uses no build tooling and
no JavaScript modules — everything is plain globals loaded in a defined order.
This keeps the Android WebView build simple and the repo approachable for
contributors who are not Node/npm users. Please keep this constraint in mind:
new JS files belong in the load-order table in `index.html` and should declare
their public API on `window` (or as named functions in global scope).

**File organisation.** Follow the existing naming and layout conventions:

- New JS files get a header comment block following the `// ── FILE NAME ──`
  style, listing their public functions and their dependencies.
- New CSS rules go in the most specific file that already handles similar
  elements; include dark-mode overrides at the bottom of the same file.
- New UI strings go in `js/locales/en/ui_en.json` first, following the
  `{file_or_feature}_{description}` key convention. Add the same key (with a
  placeholder translation) to any other locale files you can. Other translators
  can fill in the rest.

**Storage keys.** Any new `localStorage` keys should use the `bsr_` prefix and
be documented in the [Storage model](#storage-model) section above.

**Testing.** There is currently no automated test suite. Before submitting a
pull request, please manually verify:
- The changed feature in both light and dark mode.
- Arabic (`ar`) layout to confirm RTL is not broken.
- The print/PDF export (`@media print`) if your change touches answer fields or
  page layout.
- That the app still works when served from a fresh `localStorage` (open an
  incognito window).

**Opening issues.** Bug reports and feature requests are very welcome. Please
include the browser/OS and, if relevant, whether you're using the web version
or the Android WebView build.

---

## Licence

This project is licensed under the
[Creative Commons Attribution-ShareAlike 4.0 International licence (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/).

You are free to share and adapt the material for any purpose, including
commercially, provided you give appropriate credit and distribute any
derivative works under the same licence.

Bundled third-party libraries (SweetAlert2, JSZip) retain their own MIT
licences — see the headers of the respective files.
