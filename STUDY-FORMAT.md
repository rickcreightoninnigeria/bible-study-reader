# study.json authoring guide (as the code actually behaves)

For an assistant who writes `study.json` and cannot see the app. Derived from reading `study-loader.js`, `validation.js`, `render-*.js`, `modals.js`, `format-text.js`, `gallery.js`, `onboarding.js` at `main` (13 Oct 2026). Where this disagrees with `ESTUDY_FORMAT.md` or code comments, this file reflects what the code does. Section 12 lists what was not verified.

Legend: **✔** used · **✖** ignored (no code reads it) · **⛔** unsafe or rejected.

## 1. Packaging and install rules

- A `.estudy` is a **zip** containing `study.json` (any file whose name ends `study.json`; the bulk installer takes `study.json` or the first root-level `.json`) plus `images/`. A plain-JSON file also loads. A **bundle zip** holds several `.estudy` files (optionally a `pathways.json`).
- **Images:** `images/cover.webp`, `images/publisher.webp`, `images/author.webp` (**`.webp` only**), and `images/<elementId>.webp` for each `image` element that has **no `src`**. Gallery files: `images/<name>.(webp|png|jpg|jpeg)`, name `[A-Za-z0-9._-]{1,100}`, ≤5 MB.
- **Rejected at load (user sees an error or toast):** not a zip/JSON; no `study.json`; missing or unsafe `studyMetadata.studyId` (must match `^[A-Za-z0-9_.-]+$`); zip with >200 entries, any entry >25 MB, total >150 MB, compression ratio >100 on entries >1 MB, or entry names containing `..`, `\`, a leading `/` or a drive letter; a `studyVersion` **lower** than the installed one (blocked).
- **Same `studyVersion` as installed:** the *installed* copy opens and your file is ignored. To update a study, **raise `studyVersion`** (numeric; parsed with `parseFloat`, so use `1.03`, not `1.2.3`).
- **Warns but loads:** `estudyFileVersion` ≠ `3` (non-blocking banner).
- **No schema validation exists.** `validation.js` does not validate files (it is the AI tutor and answer checker, section 8). Missing optional fields are tolerated; some missing required fields throw when the page renders (flagged below). Unknown element `type`s are silently skipped.
- **Load-time cleaning (`sanitizeStudyData`):** every string containing `<` is cleaned with DOMPurify: scripts, event handlers (`onclick`…), `javascript:` URLs, iframes are removed; `id` attributes and `<style> <form> <input> <textarea> <select> <button>` are stripped. Keys named `elementId`, `repeatElement`, `calloutId`, `id`, `tabId` and `language*` have characters outside `[A-Za-z0-9_.-]` replaced by `_`. **Keep ids inside that set from the start**: images are installed using the raw id, then looked up using the cleaned one, so a space or other character breaks the image link.

## 2. Multilingual numbered slots

- A study is multilingual only if `studyMetadata.language1` exists. Slots are `language1`, `language2`, … (stops at the first gap). Slot number = suffix number. `buildLangMap` gives `{ha:1, ff:2, en:3}`.
- A multilingual field is written `field1`, `field2`, `field3` (e.g. `question1`). Mono-lingual studies use the **unnumbered** name and no `languageN` keys; they use `studyMetadata.language` (single code).
- **Lookup for elements (`resolveText`):** multilingual → `fieldN` for the reader's language → else `field1` (empty-string and empty-array slots count as missing). **There is no fallback to the unnumbered name in multilingual studies**, so an unnumbered `question` is invisible there. Mono-lingual → unnumbered only.
- **Fallback-friendly fields** (`slot → slot1 → unnumbered`): `chapterTitle`, Go Deeper/Leaders `title`, `readMoreLabel`, `backToStudyLabel`, and the label inside `readMore`/`backToStudy`.
- **Not language-keyed even in multilingual studies (single value, all languages):** `image.alt`, `image.caption`, callout `buttonText`, gallery entry `alt`/`caption`/`provenance`, `elementId`, `answerType`, `bottomPadding`.
- **Bug to author around: question `header` is read unnumbered only**, so in a multilingual study `header1/2/3` are ignored and the label renders **empty** (confirmed in a run with Her Own Name). Put a language-neutral value in `header` or avoid the header subtype there.
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

## 4. Top-level blocks

| Block | Required | Rendered by |
|---|---|---|
| `studyMetadata` | **yes** | title page, library, header, version checks |
| `chapters[]` | **yes** (empty = nothing shown, no error) | chapter pages |
| `imageData` | no | cover / publisher / author fallbacks and alt text |
| `theme` | no | CSS custom properties |
| `studyOnboardingSlides` | no | slide overlay on first open |
| `studyAiData` | no | AI tutor |
| `howToUseData` | no | How-to → "Study" tab |
| `leadersNotesData` | no | Leaders' Notes page (only if the user enables `showPageLeaders`, default off) |
| `goDeeperData` | no | Go Deeper page (Contents menu entry appears automatically) |
| `studyAboutData`, `copyrightData` | no (see below) | About page |
| `qaCallouts` | no | legacy v1 only; ignore |

## 5. `studyMetadata`

✔ `studyId` (required, id charset, permanent: it prefixes all stored data; **never** let one id be a prefix of another, e.g. `a` and `a_b`) · `title`, `subtitle`, `shortTitle` (header text, e.g. "Jonah · Ch. 1"), `description` (title page) — all numbered in multilingual studies · `author` or `authorName` (title page) and `authorLabel` (heading above it) · `version` (free text on the title page; optional) · `studyVersion` (number) · `estudyFileVersion` (3) · `language` / `language1..N` · `bibleTranslation1..N` · `libraryShelves` (array of `{Shelf, Section, Subsection}` or one object; use names from the app's shelf list in `libraryShelvesStructure_en.json`; unmatched names are not verified; absent = "Other").

✖ `createdAt`, `updatedAt`, `tags`, `shareMessage` (stored, never read). An unnumbered `bibleTranslation: {"en":"NET"}` is also ignored (see `biblePassage`).

## 6. `imageData` and `theme`

- `imageData.cover|publisher|author`: ✔ `alt`, `fallback` (emoji or text shown when the image is missing), legacy `src` (used only if no `images/*.webp`). **The cover is always taken from `images/cover.webp`; the publisher and author images are used only if `imageData.publisher` / `imageData.author` exists in the JSON** (even as `{}`). ✖ `provenance` (never displayed).
- `theme`: ✔ any of 22 keys, each a CSS value string: `surface, surface-mid, text, text-secondary, text-faint, emphasis, emphasis-light, success, accent, accent-light, border, shadow, card-bg, validate, dm-base, dm-surface, dm-raised, dm-sunken, dm-border, dm-text, dm-text-mid, dm-text-faint` (`dm-*` = dark mode). ✖ any other key (e.g. `theme-annotation`). Applied on study pages only.

## 7. `chapters[]` and elements

Chapter: ✔ `chapterNumber` (**integer, unique**; answers are stored under it) · `chapterTitle` (numbered) · `elements[]`. Order in the file is display and navigation order. The chapter label assumes consecutive numbering (`first + count − 1`).

Every element: `type` and **`elementId`** (string, unique within the chapter; missing ids make questions collide as `q_undefined`, and a callout without one throws). `bottomPadding: "none"` removes the bottom margin (any other value ignored). `repeatElement: "<id>"` (no `type`) re-shows an earlier element; it shares that element's answers and is excluded from progress, search and print.

**`heading`**: `text` (numbered). Subtypes `section` (rule + h2), `subsection` (h3), `reflection` (reflection header). **Any other subtype renders nothing.** ✖ `level`.

**`text`**: `text` (numbered), `format`, subtype optional. `intro`, `bridge` (default style), `closing` (adds a "Closing" divider); `quote`, `openingQuote`, `application`, `diagram` and any other value render like `bridge`. Gets a read-aloud button when long enough. *Share/print quirk:* the legacy text used by print and share looks for subtypes `chapterIntro`/`chapterClosing`, so `intro` and `closing` text is **left out of printed/shared reports** (bridge text is included).

**`biblePassage`** (renders nothing; registers a verse pop-up):
- Single-translation: `bibleRef`, `passageText` (HTML, shown in the pop-up), `passageUrl` (optional link), `translation` (label, default "NET").
- Multi-translation: set `studyMetadata.bibleTranslation1..N` (string label, or `{lang: label}`), then `bibleRef1..N`, `passageText1..N`, `passageUrl1..N` matched by number. Empty `passageText` slots are skipped.
- A question's `linkedPassage` must equal the passage's `bibleRef` / `bibleRef1` **exactly**, and the passage must come **earlier in `elements[]`** than the question or the reference is not tappable on first view. ✖ `note`.

**`question`** (answer box; saved under `q_<elementId>`, or `r_` for reflection):
- Required: `question` (numbered, HTML). Optional: `answerPlaceholder` (numbered, plain text), `linkedPassage`, `sampleAnswer` (numbered), `questionHint` (numbered), `deeper`, `format`.
- Subtypes: `standard` (or none), `header` (label bar from `header`, not language-resolved, see section 2), `reflection` (devotional: counts toward progress, no local check unless it has a `linkedPassage`). Others behave as standard.
- `deeper`: `{label (numbered, default "Go deeper"), question (numbered)}`; the question opens read-only in a pop-up. ✖ any other field inside `deeper`.
- ✖ `answerType`, `required`, `commentHint`, `shortAnswerThreshold`, `skipBibleVerseCheck` (documented in comments, never wired, see section 8), and stray `passageText` / `bibleRef` on non-passage elements.

**`callout`**: ✔ `eyebrow`, `term`, `question` (card), `answer` (pop-up body, cleaned to the allowed-tag list; no markdown; eyebrow/term show as plain text in the pop-up), `buttonText` (single-language; defaults to the app's text). **Only subtypes `general` and `misunderstanding` render. Other subtypes render nothing** (confirmed: Travelling with Jonah has 51 `highlighted` and Exploring Hebrews 1 `activity`). ✖ `body`, `format`.

**`image`**: ✔ `alt`, `caption` (+`format`), `fallback` (emoji if missing, default 🖼️), `align` (`full` default | `left` | `right` | `center`), `width` (percent, ignored for `full`), `src`. If `src` is set it is used **directly as the image URL** (no file is read from the zip; an external URL needs network): prefer no `src` and ship `images/<elementId>.webp`. ✖ `provenance` (only a gallery entry's default credit), `base`.

**`likertScale`**: ✔ `scale` (array of labels; numbered), `scaleNumber` (default = number of labels or 5; may be a string), `subtype` `standard`/none with `statements` (array of strings, numbered) or `bipolar` with `statementPairs` (array of `{left,right}`, numbered), `popupTitle`, `instruction` (numbered). Answers `likert_<id>_<i>` = `"1"`…`"n"`; each statement row counts toward progress.

**Progress counts** every non-repeat `question` (reflections included) plus every Likert row. **Search** indexes bridge text, question text, the passage reference and saved answers (including reflection answers); nothing else.

## 8. Answer checks (`validation.js`)

**Local check** (offline, per card; shows a 10-second toast, nothing is saved; works for Latin-script text only, because it strips everything outside `a–z0–9`). Shown on questions of subtype `standard`/none, or any question with `linkedPassage`. In order: low-engagement filler ("I don't know", "yes", "idk"…); fewer than N words (N = 6, or 35% of the `sampleAnswer` word count, max 6); answer mostly repeats the question (>70% content-word overlap); answer mostly repeats the linked passage in any translation (>70% or no original words); no shared content word with `sampleAnswer` (only when it has ≥3 content words). `questionHint` is appended to the message when a check fails. `sampleAnswer`/`questionHint` are written into `data-` attributes, so they are readable by anyone who opens the study file or DOM; never put secrets there.

**AI tutor:** `studyAiData.apiKey` (a Gemini key; plain, or `bsr1.`-obfuscated, which is **not** secure; the key ships inside the study file and is visible to every reader) and optional `aiTutorPrompt` (system prompt; default is a short built-in one). The button also needs the user setting "check answer button" (default off). Context sent: chapter title plus the matching Leaders' Notes chapter's `keyPoints` and `pastorals` blocks.

## 9. Smaller pages

- **`studyOnboardingSlides[]`**: ✔ `icon`, `eyebrow`, `heading` (these three plain text), `body`, `bodyAfter` (HTML; `\n` becomes a blank line), `action: {label, id}` with `id` `settings` or `howto` (other ids give a button that does nothing). Numbered in multilingual studies. ✖ `format`. Shown once per study.
- **`howToUseData.sections[]`**: `heading` (numbered) and **`blocks[]` (required, or the tab throws)**, each `{title, body}` numbered; body is HTML.
- **`studyAboutData`**: **`author: {paras[], image?, imageAlt?}`** and **`publisher: {name, url, paras[], image?, imageAlt?}`**. Both objects, each `paras` array and the publisher `url` are required or the About page throws. `paras` are HTML paragraphs; `format` ignored. `images/author.webp` / `publisher.webp` replace `image` when the matching `imageData` entry exists. The `url` is shown as a link (`https://` stripped from the label; `javascript:` and `data:` are dropped).
- **`copyrightData`**: ✔ `copyright.statement` (shown as "© line"), `notices[]` (HTML list items). ✖ `licence` and everything else: **the page always shows hard-coded CC BY-SA 4.0 text**, whatever licence you declare.

## 10. `leadersNotesData` and `goDeeperData`

Shared block system: each chapter object's keys (except `chapterNumber`, `format`, `title`, `chapterTitle`; Go Deeper also skips `footnotes`, `backToStudy`) become blocks **in file order**: `{subtype, header, body}`. `standard` = prose, `highlighted` = callout box (skipped if `body` empty), `image-gallery` (below). Unknown subtypes render as `standard`. `body` is markdown only when the chapter's/top-level `format` is `markdown`; otherwise HTML as authored. Chapter tabs exist only for integer `chapterNumber`s in Go Deeper; **Leaders' Notes builds tab ids from `chapterNumber` without checking it, so a string value there is injection-prone ⛔: use integers.**

**Leaders:** `format`, `subtitle` (numbered), `intro` (string or array of HTML strings; numbered), `chapters[]` (`title`/`chapterTitle`, falls back to the study chapter's title). ✖ other top-level keys (e.g. `bookOverview`). Always shows a confidential notice.

**Go Deeper:** `titleMenuHeading` (menu and page title, numbered), `format`, `intro: {header, body}` (`body` string or array of paragraphs; numbered `intro1…`), `chapters[]`. Optional links:
- `readMoreButtons: true` adds a **Read more** button to each study chapter whose `chapterNumber` also exists in Go Deeper; per study chapter, `readMore: false` hides it and `readMore: {chapter, label}` retargets it and turns it on even if the switch is off. Labels: chapter `label`, then `readMoreLabel`, then the app default; the target chapter's `title` is the second line.
- On a Go Deeper chapter, `backToStudy: true` or `{chapter, label}` adds **Back to study** (label fallback `backToStudyLabel`). Targets that don't exist show no button.
- **`image-gallery` block:** `images[]` of `{elementId}` (reuses an inline image; `alt`/`caption`/`provenance` you omit are inherited from it) or `{src: "images/x.webp", alt, caption, provenance}`; `elementId` wins. Invalid or missing images are skipped; a gallery with none disappears entirely, header included. Provenance appears only in the viewer and thumbnail label, as plain text.

## 11. Quick lists

**Ignored:** `createdAt`, `updatedAt`, `tags`, `shareMessage`, `imageData.*.provenance`, inline `image.provenance` (except gallery credit), `answerType`, `required`, `commentHint`, `shortAnswerThreshold`, `skipBibleVerseCheck`, `note`, heading `level`, callout `body`/`format`, slide `format`, `copyrightData.licence`, Leaders `bookOverview`, theme keys outside the 22, multilingual `header1…`, unnumbered `bibleTranslation`.

**Unsafe / avoid:** any `<script>`/handlers (stripped); `src` on `image` elements pointing off-device; string `chapterNumber` in Leaders' Notes; secrets in `apiKey`, `sampleAnswer`, `questionHint`; ids outside `[A-Za-z0-9_.-]`; a `studyId` that prefixes another.

## 12. Not verified

- Nothing was tested on Android WebView or iOS; renders were checked in desktop Chromium, and several behaviours here come from reading code only (About/How-to throwing on missing fields, the Leaders' `chapterNumber` path, the `libraryShelves` placement of unknown names, `readMore` with unusual values).
- `onboarding.js` internals beyond slide fields, `render-library.js` shelf edge cases, and the editor tools in `app/*.html` (which may enforce stricter rules than the app) were not read in full.
- The AI tutor was never run (no key); the Gemini model name is a preview model.
- Behaviour with very large studies (hundreds of chapters, MBs of JSON) was not measured; only the zip limits above are enforced.
- Limits not listed here do not exist in the code as far as I found: no maximum on text length, element count or `studyId` length.
