# study.json authoring guide (as the code actually behaves)

For an assistant who writes `study.json` and cannot see the app. Derived from reading `study-loader.js`, `answer-match.js`, `validation.js`, `render-*.js`, `modals.js`, `format-text.js`, `icons.js`, `gallery.js`, `onboarding.js`, `share-print.js` at `main` (21 Oct 2026). **This is the authority for what the app does**; if an older note, template or example disagrees with it, trust this file. A short walk-through is in `AUTHORING-TUTORIAL.md`, a worked example in `example_study_excerpt.json`, and `validate_study.py` checks a file against section 13. Section 12 lists what was not verified.

Legend: **✔** used · **✖** ignored (no code reads it) · **⛔** unsafe or rejected.

## 1. Packaging and install rules

- A `.estudy` is a **zip** containing `study.json` (any file whose name ends `study.json`; the bulk installer takes `study.json` or the first root-level `.json`) plus `images/`. A plain-JSON file also loads. A **bundle zip** holds several `.estudy` files (optionally a `pathways.json`).
- **Images:** `images/cover.webp`, `images/publisher.webp`, `images/author.webp` (**`.webp` only**), and `images/<elementId>.webp` for each `image` element that has **no `src`**. Gallery files: `images/<name>.(webp|png|jpg|jpeg)`, name `[A-Za-z0-9._-]{1,100}`, ≤5 MB.
- **Rejected at load (user sees an error or toast):** not a zip/JSON; no `study.json`; missing or unsafe `studyMetadata.studyId` (must match `^[A-Za-z0-9_.-]+$`); zip with >200 entries, any entry >25 MB, total >150 MB, compression ratio >100 on entries >1 MB, or entry names containing `..`, `\`, a leading `/` or a drive letter.
- **`studyVersion` decides what happens when a reader opens a file for a study they already have.** It is compared as a **decimal number**, so `1.1` and `1.10` are the same version and both come after `1.09`. Keep to two decimal places: `1.01`, `1.02` … `1.09`, `1.10`, `1.11`. The copy the reader has is judged by the version saved inside it.
  - **Newer file:** installs, with a short "Updating … to vN" message.
  - **Same or older file:** a dialog stays until answered. It names the study and both versions and offers **Keep what I have** (opens their copy; the default) or **Install this file anyway**. Nothing happens silently.
  - **Study not installed** (never was, or the reader deleted it): installs whatever its version.
  - **Writing the version:** use a plain JSON number (`1.03`, `1.04`, … `1.10`, `2`). A string such as `"1.10"` also works and means the same. The title page shows it as "File v1.10", so a reader can tell you which they have.
- **Warns but loads:** `estudyFileVersion` ≠ `3` (non-blocking banner).
- **No schema validation exists.** `validation.js` does not validate files (it is the local answer checker, section 8). Missing optional fields are tolerated; some missing required fields throw when the page renders (flagged below). Unknown element `type`s are silently skipped.
- **Load-time cleaning (`sanitizeStudyData`):** every string containing `<` is cleaned with DOMPurify: scripts, event handlers (`onclick`…), `javascript:` URLs, iframes are removed; `id` attributes and `<style> <form> <input> <textarea> <select> <button>` are stripped. **`style="…"` attributes are *not* removed at this stage** (they are dropped later only in fields that go through the formatter, section 3), so a `style` may or may not show depending on the field. **Never use `style`**; use a class. Class rules exist only in the app's stylesheet. One exists for the divine name: write `[[sc:Lord]]` (preferred, works everywhere text is formatted, including markdown) or `<span class="divine-name">Lord</span>` (HTML fields only: it is shown as literal text in markdown fields) where the Bible prints LORD in small capitals. See "Inline markers" in section 3. Keys named `elementId`, `repeatElement`, `calloutId`, `id`, `tabId` and `language*` have characters outside `[A-Za-z0-9_.-]` replaced by `_`. **Keep ids inside that set from the start**: images are installed using the raw id, then looked up using the cleaned one, so a space or other character breaks the image link.

## 2. Multilingual numbered slots

- A study is multilingual only if `studyMetadata.language1` exists. Slots are `language1`, `language2`, … (stops at the first gap). Slot number = suffix number. `buildLangMap` gives `{ha:1, ff:2, en:3}`.
- A multilingual field is written `field1`, `field2`, `field3` (e.g. `question1`). Mono-lingual studies use the **unnumbered** name and no `languageN` keys; they use `studyMetadata.language` (single code).
- **Lookup for elements (`resolveText`):** multilingual → `fieldN` for the reader's language → else `field1` (empty-string and empty-array slots count as missing). **There is no fallback to the unnumbered name in multilingual studies**, so an unnumbered `question` is invisible there. Mono-lingual → unnumbered only.
- **Fallback-friendly fields** (`slot → slot1 → unnumbered`): `chapterTitle`, Go Deeper/Leaders `title`, `readMoreLabel`, `backToStudyLabel`, and the label inside `readMore`/`backToStudy`.
- **Not language-keyed even in multilingual studies (single value, all languages):** `image.alt`, `image.caption`, callout `buttonText`, gallery entry `alt`/`caption`/`provenance`, `elementId`, `answerType`, `bottomPadding`.
- Question `header` is numbered like other text (`header1/2/3`, falling back to slot 1 then the unnumbered `header`). *(Fixed; older app versions rendered an empty label in multilingual studies.)*
- The reader chooses the study language from a language bar (first language by default). Codes unknown to the app still work; they just show 🌐 instead of a flag.
- **Block names in Go Deeper/Leaders' Notes** collapse trailing digits into slots only in multilingual studies; there, never end a block name in a digit.
- Bible translations are independent of language slots, see `biblePassage`.

## 3. Text formats and what survives

`format` values (case-insensitive): `HTML`, `markdown`, `plainText`. Anything else, or absent, = plainText.

| Where `format` applies | Result |
|---|---|
| `text` element, `image.caption`, question `header`, Go Deeper/Leaders markdown | Rendered by `renderFormatted`: HTML → sanitised; markdown → markdown-it (raw HTML escaped) then sanitised; plainText → split on blank lines into `<p>`, sanitised. A single `\n` does not make a line break in any format. |
| Allowed tags/attributes after formatting | `b i em strong u s p br ul ol li blockquote h1–h4 a span sup sub hr`; attributes `href target rel class` only. **Tables, `div`, `cite`, `mark`, images and `id` are stripped** (text kept). Links with `target` get `rel="noopener noreferrer"`. |
| **Unformatted fields** (question text, headings, callout eyebrow/term/question, Likert text, onboarding body, How-to body, Go Deeper/Leaders non-markdown bodies, About paragraphs) | Inserted as authored HTML after the load-time cleaning (tables, `div`, `cite` survive; scripts/handlers do not). Plain text with `\n` is **not** converted to paragraphs. |

Footnotes (`[[fn:N]]` markers with a chapter `footnotes: [{id, body}]` array) work **only in Go Deeper chapters**. Study chapters never pass footnotes, so markers there show as literal text.

**Inline markers.** Two markers are swapped for app-made markup *after* the text has been cleaned, so they need nothing the cleaning step removes. Apps older than this feature show either marker as literal text.

| Marker | Result |
|---|---|
| `[[sc:Lord]]` | `<span class="divine-name">Lord</span>`: small capitals for the divine name. You write "Lord"; the L stays full size and "ord" shows as small capitals, with a little extra letter-spacing. It follows the text colour, so it is right in light mode, dark mode and print. Example: `The [[sc:Lord]] reigns.` |
| `[[icon:name]]` | One of the app's own icons, in whichever icon style the reader has chosen in Settings. Example: `Tap Check [[icon:localValidate]] to see how your answer compares.` `name` is an icon key such as `localValidate` (the shield with a tick), `mainPoint`, `triggerInfo`, `starEmpty`, `starFilled`, `speak`, `mic`, `save`, `print` or `share`. |

Rules for both:

- **Where they work:** `text` elements, image captions, question `header`, the `body` of a `highlighted` callout, the `answer` of a callout and `passageText` (pop-ups), `deeper` questions, Go Deeper and Leaders' Notes blocks and intros (any format, **including markdown**, and inside `*emphasis*`), and footnote bodies. They do **not** work in the other unformatted fields listed above (question text, headings, callout eyebrow/term/question, Likert text, and so on): there the marker shows as literal text.
- **`[[sc:…]]` text** may hold only letters (any script, with accents), spaces, apostrophes (`'` or `’`) and full stops, up to 60 characters, starting with a letter. Anything else is not a marker and shows as literal text; this is deliberate, so nothing an author or a hostile file types inside a marker can become markup. Write one marker per name: `[[sc:Lord God]]`.
- **Why `[[sc:…]]` exists:** markdown fields escape raw HTML, so `<span class="divine-name">` shows as visible text in a markdown Go Deeper body, caption or `mainPoint`. The validator warns about it.
- **Print, search and read-aloud:** printed chapters show the small-capitals span (the print window carries its own copy of the rule) and drop icons; search and text-to-speech read the plain word ("Lord") and skip icons. Nobody sees or hears the marker.
- **Icons:** you cannot paste an `<svg>` yourself (the cleaning step removes it, and it could not follow the reader's icon style). The icon is decorative and hidden from screen readers, so always name the button in words too ("tap Check"). An unknown name is removed and the validator warns. A style change in Settings shows on the next render, like every other icon.

## 4. Top-level blocks

| Block | Required | Rendered by |
|---|---|---|
| `studyMetadata` | **yes** | title page, library, header, version checks |
| `chapters[]` | **yes** (empty = nothing shown, no error) | chapter pages |
| `imageData` | no | cover / publisher / author fallbacks and alt text |
| `theme` | no | CSS custom properties |
| `studyOnboardingSlides` | no | slide overlay on first open |
| `studyAiData` | no | deprecated; ignored |
| `howToUseData` | no | How-to → "Study" tab |
| `leadersNotesData` | no | Leaders' Notes page (only if the user enables `showPageLeaders`, default off) |
| `goDeeperData` | no | Go Deeper page (Contents menu entry appears automatically) |
| `studyAboutData`, `copyrightData` | no (see below) | About page |
| `qaCallouts` | no | legacy v1 only; ignore |

## 5. `studyMetadata`

✔ `studyId` (required, id charset, permanent: it prefixes all stored data; **never** let one id be a prefix of another, e.g. `a` and `a_b`) · `title`, `subtitle`, `shortTitle` (header text, e.g. "Jonah · Ch. 1"), `description` (title page) — all numbered in multilingual studies · `author` or `authorName` (title page) and `authorLabel` (heading above it) · `version` (free text on the title page; optional) · `studyVersion` (a decimal number with two places, such as 1.03; see section 1) · `estudyFileVersion` (3) · `language` / `language1..N` · `bibleTranslation1..N` · `libraryShelves` (array of `{Shelf, Section, Subsection}` or one object; use names from the app's shelf list in `libraryShelvesStructure_en.json`; unmatched names are not verified; absent = "Other").

✖ `createdAt`, `updatedAt`, `tags`, `shareMessage` (stored, never read). An unnumbered `bibleTranslation: {"en":"NET"}` is also ignored (see `biblePassage`).

## 6. `imageData` and `theme`

- `imageData.cover|publisher|author`: ✔ `alt`, `fallback` (emoji or text shown when the image is missing), legacy `src` (used only if no `images/*.webp`). **The cover is always taken from `images/cover.webp`; the publisher and author images are used only if `imageData.publisher` / `imageData.author` exists in the JSON** (even as `{}`). ✖ `provenance` (never displayed).
- `theme`: ✔ any of 22 keys, each a CSS value string: `surface, surface-mid, text, text-secondary, text-faint, emphasis, emphasis-light, success, accent, accent-light, border, shadow, card-bg, validate, dm-base, dm-surface, dm-raised, dm-sunken, dm-border, dm-text, dm-text-mid, dm-text-faint` (`dm-*` = dark mode). ✖ any other key (e.g. `theme-annotation`). Applied on study pages only.

## 7. `chapters[]` and elements

Chapter: ✔ `chapterNumber` (**integer, unique**; answers are stored under it) · `chapterTitle` (numbered) · `elements[]`. Order in the file is display and navigation order. The chapter label assumes consecutive numbering (`first + count − 1`).

Every element: `type` and **`elementId`** (string; the app needs it unique within the chapter, but make it unique across the study as `chNN-elMM` in document order. A missing id makes questions collide as `q_undefined`, and a callout without one throws). `bottomPadding: "none"` removes the bottom margin (any other value ignored). `repeatElement: "<id>"` (no `type`) re-shows an earlier element; it shares that element's answers and is excluded from progress, search and print.

**`heading`**: `text` (numbered). Subtypes `section` (rule + h2), `subsection` (h3), `reflection` (reflection header). **Any other subtype renders nothing.** ✖ `level`.

**`text`**: `text` (numbered), `format`, subtype optional. `intro`, `bridge` (default style), `closing` (adds a "Closing" divider); `quote`, `openingQuote`, `application`, `diagram` and any other value render like `bridge`. Gets a read-aloud button when long enough. Print and share include the `intro` and `closing` text (the legacy names `chapterIntro`/`chapterClosing` are also accepted).

**`biblePassage`** (renders nothing; registers a verse pop-up):
- Single-translation: `bibleRef`, `passageText` (HTML, shown in the pop-up), `passageUrl` (optional link), `translation` (label, default "NET").
- Multi-translation: set `studyMetadata.bibleTranslation1..N` (string label, or `{lang: label}`), then `bibleRef1..N`, `passageText1..N`, `passageUrl1..N` matched by number. Empty `passageText` slots are skipped.
- A question's `linkedPassage` must equal the passage's `bibleRef` / `bibleRef1` **exactly**, and the passage must come **earlier in `elements[]`** than the question or the reference is not tappable on first view. ✖ `note`. Compare the dash too: `Titus 2:11–14` (en dash) and `Titus 2:11-14` (hyphen) are different strings.
- `passageText` is shown exactly as written, so hand-supplied text works. A passage that crosses a chapter boundary is still one element: label the first verse of the new chapter in full (`<sup>2:1</sup>`) and set `bibleRef` to `1 John 1:5–2:2`. An omitted verse needs no marker; the numbers just skip (14, 15, 17…).
- The link under the pop-up reads "*label* - see context ↗" (for example "NIV - see context ↗"), where *label* is the translation label: `translation`, or the matching `bibleTranslationN` label. The link goes to your `passageUrl`; with no `passageUrl` there is no link. *(Fixed in app 0.6.3; older versions always said "NET".)*
- `passageText` is cleaned to the allowed-tag list in section 3, so `<ul>`, `<ol>` and `<li>` work (and are spaced and indented in the pop-up); tables and `div` are stripped.

**`question`** (answer box; saved under `q_<elementId>`, or `r_` for reflection):
- Required: `question` (numbered, HTML). Optional: `answerPlaceholder` (numbered, plain text), `linkedPassage`, `sampleAnswer` (numbered), `questionHint` (numbered), `keyTerms` (numbered array of `"alt|alt|prefix$|*inside"` strings; max 12 entries), `mainPoint` (numbered; shown by the **Main point** button once the reader has written an answer; ≤2,000 characters) with `mainPointFormat` (`markdown` default | `HTML` | `plainText`; not numbered), `deeper`, `format`.
- Subtypes: `standard` (or none), `header` (label bar from `header`, numbered like other text, section 2; the answer saves as `q_<id>`, **not** `r_`: only subtype `reflection` uses `r_`), `reflection` (devotional: counts toward progress, no local check unless it has a `linkedPassage`). Others behave as standard.
- `deeper`: `{label (numbered, default "Go deeper"), question (numbered)}`; the question opens read-only in a pop-up. ✖ any other field inside `deeper`.
- `shortAnswerThreshold` (number, numbered or plain; minimum words before local validation stops calling an answer too short) and `skipBibleVerseCheck` (`true` skips the Bible-verse check) are read by local answer-checking.
- ✖ `answerType`, `required`, `commentHint`, and stray `passageText` / `bibleRef` on non-passage elements.

**`callout`**: ✔ `eyebrow`, `term`, `question` (card), `answer` (pop-up body, cleaned to the allowed-tag list; no markdown; eyebrow/term show as plain text in the pop-up), `buttonText` (single-language; defaults to the app's text). Subtypes `general` and `misunderstanding` get a button and pop-up. `highlighted` renders an inline box with `eyebrow`, `term` and `body` (numbered; `format` honoured, no button); `activity` renders `eyebrow`, `term` and `question` inline. Other subtypes render nothing.

**`image`**: ✔ `alt`, `caption` (+`format`), `fallback` (emoji if missing, default 🖼️), `align` (`full` default | `left` | `right` | `center`), `width` (percent, ignored for `full`), `src`. If `src` is set it is used **directly as the image URL** (no file is read from the zip; an external URL needs network): prefer no `src` and ship `images/<elementId>.webp`. ✖ `provenance` (only a gallery entry's default credit), `base`.

**`likertScale`**: ✔ `scale` (array of labels; numbered), `scaleNumber` (default = number of labels or 5; may be a string; clamped to 1–10), `subtype` `standard`/none with `statements` (array of strings, numbered) or `bipolar` with `statementPairs` (array of `{left,right}`, numbered), `popupTitle`, `instruction` (numbered). Answers `likert_<id>_<i>` = `"1"`…`"n"`; each statement row counts toward progress.

**Progress counts** every non-repeat `question` (reflections included) plus every Likert row. **Search** indexes bridge text, question text, the passage reference and saved answers (including reflection answers); nothing else. **Go Deeper text, passage text, Leaders' Notes and footnotes are not searched.**

## 8. Answer checks (`validation.js`)

**Local check** (offline, per card; shows a 10-second toast, nothing is saved; matching is Unicode-aware, so it works for Hausa, Yorùbá, Arabic, Chinese, Hindi and the other supported scripts, though only English has a list of ignorable words). Shown on questions of subtype `standard`/none, or any question with `linkedPassage`; the button stays disabled until the reader has typed something. In order: low-engagement filler ("I don't know", "yes", "idk"…); fewer than N words (N = 6, or 35% of the `sampleAnswer` word count, max 6, or `shortAnswerThreshold`; `0` turns it off; words in scripts without spaces are counted by segmentation); answer mostly repeats the question (>70% content-word overlap, 85% where there is no stopword list); answer mostly repeats the linked passage in any translation (same thresholds, or no original words; off when `skipBibleVerseCheck` is true); then the new tiered step: with `keyTerms`, none matched → "different direction", some → neutral "partial", at least half (never fewer than two when there are two or more) → "Well done"; without `keyTerms`, a loose `sampleAnswer` check that can only ever say "Looks good" (needs ≥3 content words in the sample). `questionHint` is appended to the message when a check fails. `sampleAnswer`, `questionHint`, `keyTerms` and `mainPoint` are read from the question element, not from the page markup, but are in the study file, so never put secrets there.

**`studyAiData`:** deprecated and ignored. The AI tutor was removed; old files that still contain it (with an `apiKey` and `aiMentorPrompt`/`aiTutorPrompt`) load normally. Do not add it to new studies, and revoke any key that was distributed in one.

## 9. Smaller pages

- **`studyOnboardingSlides[]`**: ✔ `icon`, `eyebrow`, `heading` (these three plain text), `body`, `bodyAfter` (HTML; `\n` becomes a blank line), `action: {label, id}` with `id` `settings` or `howto` (other ids give a button that does nothing). Numbered in multilingual studies. ✖ `format`. Shown once per study.
- **`howToUseData.sections[]`**: `heading` (numbered) and `blocks[]` (a missing list renders an empty section), each `{title, body}` numbered; body is HTML.
- **`studyAboutData`**: **`author: {paras[], image?, imageAlt?}`** and **`publisher: {name, url, paras[], image?, imageAlt?}`**. Missing objects, `paras` or `url` are tolerated (shown empty). `paras` are HTML paragraphs; `format` ignored. `images/author.webp` / `publisher.webp` replace `image` when the matching `imageData` entry exists. The `url` is shown as a link (`https://` stripped from the label; `javascript:` and `data:` are dropped).
- **`copyrightData`**: ✔ `copyright.statement` (shown as "© line"), `notices[]` (HTML list items). ✖ `licence` and everything else: **the page always shows hard-coded CC BY-SA 4.0 text**, whatever licence you declare.

## 10. `leadersNotesData` and `goDeeperData`

Shared block system: each chapter object's keys (except `chapterNumber`, `format`, `title`, `chapterTitle`; Go Deeper also skips `footnotes`, `backToStudy`) become blocks **in file order**: `{subtype, header, body}`. `standard` = prose, `highlighted` = callout box (skipped if `body` empty), `image-gallery` (below). Unknown subtypes render as `standard`. `body` is markdown only when the chapter's/top-level `format` is `markdown`; otherwise HTML as authored. Chapter tabs exist only for integer `chapterNumber`s in Go Deeper; **Leaders' Notes builds tab ids from `chapterNumber` without checking it, so a string value there is injection-prone ⛔: use integers.**

**Leaders:** `format`, `subtitle` (numbered), `intro` (string or array of HTML strings; numbered), `chapters[]` (`title`/`chapterTitle`, falls back to the study chapter's title). ✖ other top-level keys (e.g. `bookOverview`). Always shows a confidential notice. Tabs are labelled with the chapter number only; the chapter title appears in the page header below the tabs.

**Go Deeper:** `titleMenuHeading` (menu and page title, numbered), `format`, `intro: {header, body}` (`body` string or array of paragraphs; numbered `intro1…`), `chapters[]`. Optional links:
- `readMoreButtons: true` adds a **Read more** button to each study chapter whose `chapterNumber` also exists in Go Deeper; per study chapter, `readMore: false` hides it and `readMore: {chapter, label}` retargets it and turns it on even if the switch is off. Labels: chapter `label`, then `readMoreLabel`, then the app default; the target chapter's `title` is the second line.
- On a Go Deeper chapter, `backToStudy: true` or `{chapter, label}` adds **Back to study** (label fallback `backToStudyLabel`). Targets that don't exist show no button.
- **Header-only block:** a `standard` block with a `header` and `body: ""` renders just the heading (no empty paragraph). Use it to keep a book's boxes in order. A `highlighted` block with an empty `body` renders nothing, header included.
- **Footnote markers** may start a paragraph (`<p>[[fn:4]]Text…`): the button goes first, then the text. This is how to footnote a heading, which cannot carry a button. A marker with no matching `footnotes` entry shows as a plain superscript number.
- **Tables** work in `format: "HTML"` bodies only (markdown bodies go through a narrow allow-list with no table tags). Wrap each table in `<div class="go-deeper-table-wrap">` and give it `class="go-deeper-table"`; `<thead>`/`<tbody>`, `<th scope="col|row">`, `colspan` and `<ul>` in cells are kept. The wrapper scrolls sideways, so a wide table never widens the page, and cells stay at least 5.5rem wide (3 columns fit a 380px phone; 4 scroll). Dark mode and right-to-left are handled by the stylesheet; no inline styles.
- **Go Deeper chapters with no study chapter** (e.g. an appendix) are fine: they get a tab, but no Read more (that starts from a study chapter) and no Back to study unless `backToStudy` points at one. Tab labels are the chapter numbers, so two-digit numbers work; the tab bar scrolls and keeps the active tab in view.
- **Previous / Next buttons** (on by default) sit above Back to study on every Go Deeper chapter: a quiet Previous (only when an earlier chapter exists) and a solid Next (only when a later one exists). Default text is the neighbouring chapter's title (or "Chapter N"); override with `previousLabel` / `nextLabel` on the chapter (numbered slots `previousLabel1…` in multilingual studies). The intro tab gets a Next button to the first chapter, "Start reading" by default, or `intro.nextLabel`. The first chapter never links back to the intro tab. `goDeeperData.chapterNavButtons: false` turns all of them off. The app draws the arrows; don't put them in labels.
- **Tab labels** are the chapter numbers (two digits are fine) and the intro tab uses `intro.header`. **Keep `intro.header` short** ("About", not "About this book"): with a dozen tabs the bar scrolls sideways, and the active tab is scrolled into view.
- **`image-gallery` block:** `images[]` of `{elementId}` (reuses an inline image; `alt`/`caption`/`provenance` you omit are inherited from it) or `{src: "images/x.webp", alt, caption, provenance}`; `elementId` wins. Invalid or missing images are skipped; a gallery with none disappears entirely, header included. Provenance appears only in the viewer and thumbnail label, as plain text.

## 11. Quick lists

**Ignored:** `createdAt`, `updatedAt`, `tags`, `shareMessage`, `imageData.*.provenance`, inline `image.provenance` (except gallery credit), `answerType`, `required`, `commentHint`, `note`, heading `level`, slide `format`, `copyrightData.licence`, `studyMetadata.publishedBy` / `year` / `ctaLabel` (documented in older notes, but nothing reads them), Leaders `bookOverview`, theme keys outside the 22; unnumbered `bibleTranslation`.

**Unsafe / avoid:** any `<script>`/handlers (stripped); `src` on `image` elements pointing off-device; a non-integer `chapterNumber` (numeric strings are converted to integers; anything else becomes 0); secrets in `sampleAnswer`, `questionHint`; ids outside `[A-Za-z0-9_.-]`; a `studyId` that prefixes another (deleting/clearing now spares other installed studies whose id extends it, but avoid it).

## 12. Not verified

- Nothing was tested on Android WebView or iOS; renders were checked in desktop Chromium, and several behaviours here come from reading code only (the `libraryShelves` placement of unknown names, `readMore` with unusual values).
- `onboarding.js` internals beyond slide fields, `render-library.js` shelf edge cases, and the editor tools in `app/*.html` (which may enforce stricter rules than the app) were not read in full.
- Very large studies: a 480 KB study with 9 chapters and 11 appendix chapters loads in about 40 ms and scrolls smoothly in desktop Chromium. Bigger files and slow Android devices were not measured; only the zip limits above are enforced.
- The look of tables and Previous/Next buttons was checked at 380 px in light and dark mode, and right-to-left mirrors, in desktop Chromium only.
- `[[sc:…]]` and `[[icon:…]]` were checked with the real DOMPurify, markdown-it and app code in desktop Chromium, and by unit tests; neither has been seen on Android or iOS, or in an actual printout. Small capitals are synthesised by the browser when a font has none, so their look differs between fonts and devices. The icon keys are whatever `ICONS_ROUNDED` in `icons.js` defines.
- Limits not listed here do not exist in the code as far as I found: no maximum on text length, element count or `studyId` length.

## 13. Pre-flight checklist (what fails silently)

`validate_study.py <study.json>` checks the first nine. Nothing else in the app will tell you.

1. Valid JSON; `studyMetadata.studyId` matches `[A-Za-z0-9_.-]+` and is permanent.
2. Every `elementId` unique across the study, matching `[A-Za-z0-9_.-]+`; every `repeatElement` target exists in the same chapter.
3. Every `linkedPassage` equals an **earlier** `bibleRef` in the same chapter, character for character (check dashes and any suffix such as "(quoting Psalm 2:7)"). A chapter with **no** `biblePassage` elements may use `linkedPassage` as a plain reference label (nothing opens). Never put a placeholder such as `"NONE"` in `linkedPassage`; and a `reflection` with a `linkedPassage` gets the answer-check button, so leave it off unless you want that.
4. `chapterNumber`s are unique integers; every Go Deeper `chapterNumber` is an integer.
5. In each Go Deeper chapter the `[[fn:N]]` markers and the `footnotes` ids are the same set, and the ids are unique integers. By convention they run 1..N per chapter; the app shows the id as the note number, so a study that keeps a printed book's own numbers (5, 6, 7) also works.
6. No Go Deeper or Leaders' block key ends in a digit (required in multilingual studies; keep the habit in single-language ones).
7. Table rows all add up to the same width once `colspan` is counted; tables are in `format: "HTML"` bodies.
8. `keyTerms` is an array of strings (at most 12); `mainPoint` is 2,000 characters or fewer.
9. No `studyAiData`, no `apiKey`, no `style=` attributes, no `<script>`, no leftover template placeholders (`${…}`), no `<table>` in a callout `answer` or other pop-up text (tables are stripped there; use a list), every `[[icon:name]]` names a real icon, every `[[sc:Text]]` holds only the allowed characters, and no `<span class="divine-name">` sits in a markdown field (use `[[sc:Text]]` there). The validator warns on all three.
10. Raise `studyVersion` (1.03 → 1.04 … 1.09 → 1.10) whenever you change a file that readers may already have. A same or older version makes the app ask the reader what to do, so an update that is not newer will not reach anyone by accident.
11. Declared images exist: `images/<elementId>.webp` for every `image` without `src`; gallery `src` files are in the zip.
12. Before release open it in the app: a passage pop-up, a hint, a footnote, a table at phone width, Read more and Back to study, and the copyright page (section 9: it always prints CC BY-SA, whatever you declare).
