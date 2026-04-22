# Authoring a `.estudy` File

A `.estudy` file is the content package for a single Bible study series. The
app reads it, stores it in IndexedDB, and renders every page — title, chapters,
leaders' notes, about, copyright — from its contents. This document describes
the full file format so you can author one from scratch.

---

## Contents

1. [Two file formats](#two-file-formats)
2. [Top-level structure](#top-level-structure)
3. [`studyMetadata`](#studymetadata)
4. [`imageData`](#imagedata)
5. [`theme`](#theme)
6. [`chapters` and the `elements[]` array](#chapters-and-the-elements-array)
   - [Element types reference](#element-types-reference)
     - [`text`](#text-element)
     - [`heading`](#heading-element)
     - [`biblePassage`](#biblepassage-element)
     - [`question`](#question-element)
     - [`callout`](#callout-element)
     - [`likertScale`](#likertscale-element)
     - [`image`](#image-element)
7. [`studyOnboardingSlides`](#studyonboardingslides)
8. [`studyAiData`](#studyaidata)
9. [`howToUseData`](#howtousedata)
10. [`leadersNotesData`](#leadersnotedata)
11. [`studyAboutData`](#studyaboutdata)
12. [`copyrightData`](#copyrightdata)
13. [Bundle ZIPs](#bundle-zips)
14. [Validation and version checking](#validation-and-version-checking)
15. [Minimal working example](#minimal-working-example)

---

## Two file formats

A `.estudy` file is one of:

| Format | Description | When to use |
|--------|-------------|-------------|
| **Plain JSON** | A single `.estudy` file containing the entire study as a JSON object. Images are either omitted or embedded as base64 in `imageData`. | Simple studies; no cover photo needed. |
| **ZIP** | A ZIP archive with the extension `.estudy`, containing `study.json` at the root and an `images/` folder. | Studies with a cover image, publisher logo, author photo, or inline chapter images. |

The app auto-detects which format you have used. Both formats produce identical
results in the UI.

### ZIP layout

```
my-study.estudy         ← the ZIP file itself; rename freely
├── study.json          ← the study data (same structure as plain JSON)
└── images/
    ├── cover.webp      ← title-page cover photo       (optional)
    ├── publisher.webp  ← publisher logo               (optional)
    ├── author.webp     ← author photo                 (optional)
    └── {elementId}.webp  ← per-chapter inline images  (optional, one per image element)
```

All image files must be **WebP** format. Other formats are not currently
supported. Images are loaded once on install and stored in IndexedDB, so they
are available offline.

---

## Top-level structure

```json
{
  "studyMetadata":        { ... },   // required
  "imageData":            { ... },   // optional
  "theme":                { ... },   // optional
  "chapters":             [ ... ],   // required — at least one chapter
  "studyOnboardingSlides":[ ... ],   // optional
  "studyAiData":          { ... },   // optional
  "howToUseData":         { ... },   // optional
  "leadersNotesData":     { ... },   // optional
  "studyAboutData":       { ... },   // optional
  "copyrightData":        { ... }    // optional
}
```

All top-level keys are optional except `studyMetadata` and `chapters`. Omitting
an optional key simply means that section of the app is not shown (e.g. no
Leaders' Notes page if `leadersNotesData` is absent).

---

## `studyMetadata`

Required. Identifies the study and provides the title-page content.

```json
"studyMetadata": {
  "studyId":             "romans_foundations_v001",
  "estudyFileVersion":   "3",
  "title":               "Romans: The Gospel Unpacked",
  "shortTitle":          "Romans",
  "subtitle":            "A ten-session study",
  "language":            "en",
  "author":              "Jane Smith",
  "authorLabel":         "Written by",
  "publishedBy":         "Example Publishing",
  "year":                "2026",
  "ctaLabel":            "Begin the Course →",
  "libraryShelves": [
    { "Shelf": "New Testament", "Section": "Paul's Letters", "Subsection": "Romans" }
  ]
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `studyId` | **Yes** | Unique string. Used as the key in IndexedDB and as the namespace prefix for all localStorage entries. Once published, **never change this** — it would break saved answers for existing users. Use a stable convention like `{book}_{series}_{vNNN}`. |
| `estudyFileVersion` | Recommended | Integer as a string (e.g. `"3"`). The app compares this against the version it expects and shows a non-blocking warning if they differ. See [Validation and version checking](#validation-and-version-checking). |
| `title` | **Yes** | Full study title. Shown on the title page and library cards. |
| `shortTitle` | Recommended | Abbreviated title used in the top nav bar and chapter menu heading. Defaults to `title` if absent. |
| `subtitle` | No | Shown below the title on the title page. |
| `language` | Recommended | BCP 47 language code (e.g. `"en"`, `"fr"`, `"ar"`). Used for the language filter in the library. |
| `author` | No | Author name, shown on the title page. |
| `authorLabel` | No | Label before the author name. Defaults to `"Author"`. |
| `publishedBy` | No | Publisher name, shown on the title page. |
| `year` | No | Publication year. |
| `ctaLabel` | No | Custom text for the "begin" button on the title page. |
| `libraryShelves` | No | Array of placement objects — each with `Shelf`, `Section` (optional), and `Subsection` (optional). Controls where the study appears in the Library's Shelves tab. Shelf and section names must match those defined in `libraryShelvesStructure_en.json`. |

---

## `imageData`

Optional. Describes the images associated with the study. In ZIP format, image
files live in `images/` and this block tells the app what alt text and emoji
fallback to use. In plain-JSON format you can embed base64 data directly,
though the resulting file will be large.

```json
"imageData": {
  "cover": {
    "alt":      "An open Bible on a wooden table",
    "fallback": "📖"
  },
  "publisher": {
    "alt":      "Example Publishing logo"
  },
  "author": {
    "alt":      "Photo of Jane Smith"
  }
}
```

| Field | Notes |
|-------|-------|
| `cover.alt` | Alt text for the cover image. |
| `cover.fallback` | Emoji shown if the cover image fails to load. Defaults to `"📖"`. |
| `publisher.alt` | Alt text for the publisher logo. |
| `author.alt` | Alt text for the author photo. |

Chapter inline images are described inside the relevant `image` element (see
[`image`](#image-element)); their files are named `images/{elementId}.webp`
in the ZIP.

---

## `theme`

Optional. Overrides the app's default CSS custom properties with a
study-specific colour scheme. All values are CSS colour strings.

```json
"theme": {
  "surface":         "#fdf6ee",
  "surface-mid":     "#f5e9d6",
  "text":            "#2c1a0e",
  "text-secondary":  "#6b4c30",
  "text-faint":      "#a08060",
  "emphasis":        "#c0392b",
  "emphasis-light":  "#f5c6c0",
  "success":         "#27ae60",
  "accent":          "#8b5a2b",
  "accent-light":    "#d4a97a",
  "border":          "#ddd0bb",
  "shadow":          "rgba(0,0,0,0.08)",
  "card-bg":         "#ffffff",

  "dm-base":         "#1a1208",
  "dm-surface":      "#241a0e",
  "dm-raised":       "#2e2210",
  "dm-sunken":       "#130e06",
  "dm-border":       "#3d2e18",
  "dm-text":         "#f0e6d6",
  "dm-text-mid":     "#c8a882",
  "dm-text-faint":   "#8a6a44"
}
```

Light-mode properties (`surface` through `card-bg`) and dark-mode properties
(`dm-*`) can be set independently. Unknown keys are silently ignored. When the
user navigates to the Library or Settings, the study theme is temporarily
suspended so those pages always appear in the default colour scheme.

---

## `chapters` and the `elements[]` array

`chapters` is the main content array. Each entry is a chapter object:

```json
"chapters": [
  {
    "chapterNumber": 1,
    "chapterTitle":  "Who Needs the Gospel?",
    "elements": [ ... ]
  }
]
```

| Field | Required | Notes |
|-------|----------|-------|
| `chapterNumber` | **Yes** | Integer. Must be unique within the study. Used in storage keys and display labels. |
| `chapterTitle` | **Yes** | Displayed as the chapter heading and in the chapter menu. |
| `elements` | **Yes** | Array of element objects (see below). Can be empty but should not be. |

All content within a chapter is expressed as a flat array of **elements**. The
app processes them in order, top to bottom, and renders each one into the
chapter view. There is no nesting.

Every element must have:

| Field | Notes |
|-------|-------|
| `type` | String. One of: `text`, `heading`, `biblePassage`, `question`, `callout`, `likertScale`, `image`. |
| `elementId` | String. Must be **unique within the entire study** (not just within the chapter). Used as the localStorage key suffix for saved answers and starred state. Once published, never change an `elementId` — it would orphan saved answers. A good convention is `ch{N}_{type}_{sequential}`, e.g. `ch1_q_001`. |

Optional on any element:

| Field | Notes |
|-------|-------|
| `bottomPadding` | Set to `"none"` to remove the bottom margin below this element. Useful for tightly-coupled element pairs. |
| `repeatElement` | `elementId` of another element in this chapter. If set, this slot renders an exact copy of the referenced element, including its storage key — so both positions share the same saved answer. Useful for repeating a question at the end of a chapter. |

---

### Element types reference

---

#### `text` element

Renders a block of body text. Used for chapter intros, bridge paragraphs,
and closing summaries.

```json
{
  "type":    "text",
  "subtype": "intro",
  "elementId": "ch1_intro",
  "text":    "<p>Paul opens his letter with a bold statement...</p>",
  "format":  "HTML"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `subtype` | **Yes** | One of: `intro`, `bridge`, `closing`. `intro` uses a visually distinct intro-block style. `bridge` and `closing` use the bridge-text style; `closing` also inserts a decorative section divider above it. |
| `text` | **Yes** | The content. |
| `format` | No | `"HTML"` — the text is injected as raw HTML, allowing `<p>`, `<strong>`, `<em>`, lists, etc. Omitting this field causes the text to be treated as plain text and wrapped in `<p>` tags automatically. |

A TTS (read-aloud) button is shown automatically when the text is long enough
(controlled by the `ttsMode` setting).

---

#### `heading` element

Inserts a visual section divider or sub-heading within a chapter.

```json
{
  "type":    "heading",
  "subtype": "section",
  "elementId": "ch1_h_01",
  "text":    "Part Two: The Solution"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `subtype` | **Yes** | `"section"` — a prominent h2-level heading with a horizontal rule above it. `"subsection"` — a lighter h3-level sub-heading. `"reflection"` — the heading above the reflection questions block (uses a specific `.reflection-header` style). |
| `text` | **Yes** | The heading text. |

---

#### `biblePassage` element

Registers a Bible passage so that question cards can pop it up as a verse
modal when tapped. The passage is not rendered visibly in the chapter; it only
becomes accessible via the verse reference link on question cards that are
linked to it.

```json
{
  "type":       "biblePassage",
  "elementId":  "ch1_passage_rom1v16",
  "bibleRef":   "Romans 1:16–17",
  "passageText": "<p><sup>16</sup>For I am not ashamed of the gospel...</p>",
  "passageUrl":  "https://netbible.org/bible/Romans+1"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `bibleRef` | **Yes** | The human-readable reference string, e.g. `"Romans 1:16–17"`. Question elements reference passages by this exact string in their `linkedPassage` field. |
| `passageText` | **Yes** | The passage text as HTML. Verse numbers can be wrapped in `<sup>` tags for proper display and TTS stripping. |
| `passageUrl` | No | Link to the full passage in context at netbible.org or another site. Shown as a "see context" link in the verse modal. |

Place a `biblePassage` element **before** any question elements that reference
it, so the passage is registered before the question cards are rendered.

---

#### `question` element

The primary interactive element. Renders a question card with a text area for
the user's answer.

```json
{
  "type":          "question",
  "subtype":       "bible",
  "elementId":     "ch1_q_001",
  "question":      "What does Paul mean by 'the power of God'?",
  "linkedPassage": "Romans 1:16–17",
  "answerPlaceholder": "Write your thoughts here…",
  "sampleAnswer":  "Paul means God's active power to save…",
  "questionHint":  "Think about what 'salvation' meant in Paul's day.",
  "deeper": {
    "label":    "Go deeper",
    "question": "How does this challenge a transactional view of salvation?"
  }
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `subtype` | **Yes** | One of: `bible` — a passage-based study question (eligible for local answer validation); `reflection` — a personal reflection question (uses a `r_` storage key prefix and a softer style); `header` — a question whose ref-bar label is custom text rather than a scripture reference (see below). |
| `question` | **Yes** | The question text. HTML is not interpreted here — use plain text. |
| `linkedPassage` | No | Must match a `bibleRef` from a `biblePassage` element in this chapter. When set, the ref bar becomes tappable and opens the verse modal. Required for local answer validation to work. |
| `answerPlaceholder` | No | Custom placeholder text inside the textarea. |
| `sampleAnswer` | No | A model answer string used internally by the local answer validator. Never shown to the user. |
| `questionHint` | No | A hint string available to the local validator. Never shown directly. |
| `deeper` | No | Adds a "(Go deeper)" button next to the question text that opens a modal with an additional question. `label` is the button text; `question` is the deeper question itself. |

**`header` subtype** — when `subtype` is `"header"`, the ref bar shows the
value of a `header` field instead of a scripture reference:

```json
{
  "type":      "question",
  "subtype":   "header",
  "elementId": "ch1_q_intro",
  "header":    "Opening reflection",
  "question":  "What did you find most surprising in the reading?",
  "format":    "HTML"
}
```

Setting `"format": "HTML"` on a `header` subtype allows the `header` field to
contain HTML (e.g. styled labels). For plain text, omit `format`.

---

#### `callout` element

A card that highlights a common misunderstanding or a key term, with a button
that opens a modal containing the explanation.

```json
{
  "type":       "callout",
  "subtype":    "misunderstanding",
  "elementId":  "ch1_callout_001",
  "eyebrow":    "Common misunderstanding",
  "term":       "The gospel is just about going to heaven",
  "question":   "Is that what Paul means here?",
  "answer":     "<p>Paul uses 'salvation' to mean far more than…</p>",
  "buttonText": "Find out ➡"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `subtype` | **Yes** | `"misunderstanding"` — renders with the `qa-callout-card` style (orange-tinted). `"general"` — renders with the `gen-callout-card` style (neutral). |
| `eyebrow` | **Yes** | Small label above the term, e.g. `"Common misunderstanding"` or `"Key term"`. |
| `term` | **Yes** | The bold headline of the callout. |
| `question` | **Yes** | A short question or teaser shown on the card, prompting the user to tap. |
| `answer` | **Yes** | HTML content shown inside the modal when the button is tapped. |
| `buttonText` | No | Custom label for the callout button. Defaults to `"Find out ➡"`. |

---

#### `likertScale` element

A matrix of radio-button rows for self-assessment statements.

```json
{
  "type":        "likertScale",
  "elementId":   "ch1_likert_001",
  "scaleNumber": 5,
  "scale":       ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"],
  "statements":  [
    "I understand what Paul means by 'righteousness from God'.",
    "I can explain the gospel to a friend in my own words."
  ],
  "instruction": "Rate yourself honestly on each statement.",
  "popupTitle":  "About this scale"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `scaleNumber` | **Yes** | Number of points on the scale (e.g. `5` for a 5-point scale). Must match the length of `scale`. |
| `scale` | **Yes** | Array of label strings for each point. Length must equal `scaleNumber`. |
| `statements` | **Yes** | Array of statement strings. One row of radio buttons is rendered per statement. |
| `instruction` | No | Instruction text shown in the "About this scale" popup. |
| `popupTitle` | No | Title of the popup. Defaults to `"About this scale"`. |

Responses are saved immediately to localStorage on each radio-button change.

---

#### `image` element

An inline image displayed within the chapter content.

```json
{
  "type":      "image",
  "elementId": "ch1_img_map",
  "alt":       "Map of the Roman Empire in the 1st century",
  "caption":   "The extent of the Roman Empire when Paul wrote.",
  "fallback":  "🗺️",
  "align":     "full",
  "width":     "100"
}
```

In ZIP format, the image file must be at `images/{elementId}.webp` (e.g.
`images/ch1_img_map.webp`). The `src` field is not needed — the app loads the
image from IDB by `elementId`.

In plain-JSON format, provide an absolute URL or data URI in `src`:

```json
{
  "type":      "image",
  "elementId": "ch1_img_map",
  "src":       "https://example.com/images/roman-empire.webp",
  "alt":       "Map of the Roman Empire"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `alt` | Recommended | Alt text for accessibility. |
| `caption` | No | Plain-text caption rendered below the image. |
| `fallback` | No | Emoji shown if the image fails to load. Defaults to `"🖼️"`. |
| `align` | No | `"full"` (default), `"left"`, `"right"`, or `"center"`. |
| `width` | No | Integer 1–100, treated as a percentage of the available width. Only used when `align` is not `"full"`. |

---

## `studyOnboardingSlides`

Optional. An array of slide objects shown to the user the first time they open
this study (before the title page). Uses the same slide overlay engine as the
app-level onboarding.

```json
"studyOnboardingSlides": [
  {
    "icon":    "✝️",
    "eyebrow": "Welcome",
    "heading": "Romans: The Gospel Unpacked",
    "body":    "Over ten sessions we will work through Paul's masterpiece..."
  },
  {
    "icon":    "❓",
    "eyebrow": "How it works",
    "heading": "Questions and answers",
    "body":    "Each chapter contains passage-based questions. Tap the verse reference to read the passage.",
    "action": {
      "label": "Open Settings",
      "fn":    null
    }
  }
]
```

| Field | Required | Notes |
|-------|----------|-------|
| `icon` | No | Emoji shown large above the heading. |
| `eyebrow` | No | Small uppercase label. |
| `heading` | **Yes** | Slide title. |
| `body` | No | Body text. |
| `action` | No | Optional button at the bottom. `label` is the button text. `fn` must be `null` in the JSON file — the app resolves it at runtime using keyword matching on `label`. Currently recognised keywords: `"Settings"` → opens the Settings page; `"How to use"` → opens the How To Use page. |

---

## `studyAiData`

Optional. Enables the AI Tutor feature, which gives Socratic feedback on
question answers using the Google Gemini API.

```json
"studyAiData": {
  "apiKey":        "bsr1.YOUR_OBFUSCATED_KEY_HERE",
  "aiTutorPrompt": "You are a warm, thoughtful tutor for a study on Romans..."
}
```

| Field | Notes |
|-------|-------|
| `apiKey` | A Google Gemini API key. Can be plain text or obfuscated (see below). If absent, the AI Tutor button is hidden. |
| `aiTutorPrompt` | System prompt for the tutor. A detailed default is used if this is omitted. |

**Key obfuscation.** A plain API key in a `.estudy` file is readable by anyone
who opens the file. To make it less immediately usable, you can obfuscate it:

1. Load the app in a browser with a study already open.
2. Open the browser console and call:
   ```js
   aiTutorObfuscateKey('AIzaSy...')
   ```
3. Copy the output (a `bsr1.` prefixed string) and paste it as the `apiKey`
   value in your study JSON.

This is obfuscation only — not encryption. Anyone who reads the source code
of `validation.js` can reverse it. For studies distributed publicly, consider
whether including an API key is appropriate.

---

## `howToUseData`

Optional. Provides study-specific content for the "Study" tab of the How To
Use page. This supplements the app's generic how-to content with guidance
specific to your study.

```json
"howToUseData": {
  "sections": [
    {
      "title": "About this study",
      "body":  "<p>Romans is Paul's most systematic presentation of the gospel...</p>"
    },
    {
      "title": "Suggested pace",
      "body":  "<p>Each session is designed for 60–90 minutes of group discussion.</p>"
    }
  ]
}
```

Each item in `sections` is rendered as a titled block. `body` is injected as
HTML.

---

## `leadersNotesData`

Optional. Provides content for the Leaders' Notes page (visible only when the
`showPageLeaders` setting is enabled). This page is intended for study group
leaders — the app marks it as confidential.

```json
"leadersNotesData": {
  "intro": "<p>These notes are for the group leader...</p>",
  "chapters": [
    {
      "chapterNumber": 1,
      "title":         "Who Needs the Gospel?",
      "keyPoints":     "<p>The key theological point is Paul's universal diagnosis...</p>",
      "pastorals":     "<p>Some in the group may find the idea of universal sinfulness confronting...</p>",
      "watch":         "Watch for members who conflate 'wrath of God' with anger or punishment."
    }
  ]
}
```

| Field | Notes |
|-------|-------|
| `intro` | Introductory text shown on the Intro tab. Can be a string of HTML or an array of paragraph strings. |
| `chapters[]` | One object per chapter. `chapterNumber` must match a chapter in `chapters[]`. |
| `chapters[].keyPoints` | HTML. Key theological points for the leader to communicate. |
| `chapters[].pastorals` | HTML. Pastoral notes — things to watch for in the group. |
| `chapters[].watch` | Plain text. A "watch out for" note highlighted with a 👁️ icon. |

The `keyPoints` and `pastorals` text from leaders' notes is also used by the
AI Tutor to build context for its feedback — if the AI Tutor is enabled.

---

## `studyAboutData`

Optional. Provides content for the About page (Author and Publisher tabs).

```json
"studyAboutData": {
  "author": {
    "image":    "",
    "imageAlt": "Photo of Jane Smith",
    "paras": [
      "Jane Smith is a lecturer in New Testament Studies at...",
      "She has led Bible study groups for over twenty years..."
    ]
  },
  "publisher": {
    "name":     "Example Publishing",
    "image":    "",
    "imageAlt": "Example Publishing logo",
    "url":      "https://examplepublishing.org",
    "paras": [
      "Example Publishing exists to resource the local church..."
    ]
  }
}
```

Leave `"image": ""` in the JSON — image files are supplied in the ZIP's
`images/` folder (`publisher.webp`, `author.webp`) and the app fills in the
`src` at load time. In plain-JSON format you can put a URL or data URI here
instead.

`paras` is an array of paragraph strings (plain text). Each entry is wrapped
in a `<p>` tag.

---

## `copyrightData`

Optional. Provides content for the Copyright tab on the About page.

```json
"copyrightData": {
  "copyright": {
    "statement": "© 2026 Jane Smith. All rights reserved."
  },
  "notices": [
    "Scripture quotations are from the NET Bible, © Biblical Studies Press.",
    "Cover photograph by John Doe, used with permission."
  ]
}
```

| Field | Notes |
|-------|-------|
| `copyright.statement` | The main copyright line, shown as the `authorLine`. |
| `notices` | Array of additional copyright or licence notice strings. Each is rendered as a `<li>`. |

---

## Bundle ZIPs

A bundle ZIP is a regular `.zip` file (not `.estudy`) that contains multiple
`.estudy` files. When the user loads a bundle, the app installs all studies
inside it silently and then opens the library — useful for distributing a
complete curriculum in one download.

```
my-curriculum.zip
├── romans-part-1.estudy
├── romans-part-2.estudy
└── romans-part-3.estudy
```

Each inner file is a valid `.estudy` file in either plain-JSON or ZIP format.

---

## Validation and version checking

### `estudyFileVersion`

The app checks the `estudyFileVersion` string in `studyMetadata` against the
version it currently expects (declared in `locales/en/appAboutData_en.json`,
currently `"3"`). If they differ, a non-blocking toast-style warning is shown:

- If the file is **older** than expected, the user is told to download a newer
  version of the study.
- If the file is **newer** than expected, the user is told to update the app.

This check is informational only — mismatched files still load. If you set
`estudyFileVersion` to `"3"`, no warning will appear.

### `studyId` stability

The `studyId` is the primary key for all persistent data. If you change it,
the app treats the file as a new study and all previously saved answers are
orphaned (they remain in storage under the old key but are never loaded). Set
it once and leave it unchanged for the lifetime of the study.

---

## Minimal working example

A complete single-chapter study in plain-JSON format:

```json
{
  "studyMetadata": {
    "studyId":           "my_study_v001",
    "estudyFileVersion": "3",
    "title":             "My First Study",
    "shortTitle":        "My Study",
    "language":          "en"
  },
  "chapters": [
    {
      "chapterNumber": 1,
      "chapterTitle":  "Starting Out",
      "elements": [
        {
          "type":      "text",
          "subtype":   "intro",
          "elementId": "ch1_intro",
          "text":      "Welcome to this study. Read John 3:16 before you begin.",
          "format":    "HTML"
        },
        {
          "type":       "biblePassage",
          "elementId":  "ch1_passage_john3v16",
          "bibleRef":   "John 3:16",
          "passageText":"<p><sup>16</sup>For this is the way God loved the world...</p>",
          "passageUrl": "https://netbible.org/bible/John+3"
        },
        {
          "type":          "question",
          "subtype":       "bible",
          "elementId":     "ch1_q_001",
          "question":      "What does this verse tell us about God's motivation?",
          "linkedPassage": "John 3:16"
        },
        {
          "type":      "question",
          "subtype":   "reflection",
          "elementId": "ch1_r_001",
          "question":  "How does knowing this change the way you think about yourself?"
        }
      ]
    }
  ]
}
```

Save this as `my-study.estudy` and load it from the app's Library. You should
see a title page with "My First Study", and Chapter 1 with an intro block, a
passage-linked question, and a reflection question.
