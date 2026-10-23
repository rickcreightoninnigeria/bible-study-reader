# Writing a BSR study: a short tutorial

This walks through building a small study. `STUDY-FORMAT.md` is the full reference and the authority on what the app does; `example_study_excerpt.json` shows every current feature in one file; `validate_study.py` checks your file. Read this first, then use the others to look things up.

## 1. What you are making

A study is one JSON file, `study.json`. To add pictures, zip it with an `images/` folder and rename the zip `something.estudy` (images must be `.webp`). The app does **not** check your file. Mistakes usually fail silently, so run `validate_study.py` every time.

## 2. The smallest study

```json
{
  "studyMetadata": { "studyId": "my_study_v001", "estudyFileVersion": 3, "studyVersion": 1.0,
                     "title": "My Study", "language": "en" },
  "chapters": [ { "chapterNumber": 1, "chapterTitle": "Starting out", "elements": [ … ] } ]
}
```

- `studyId` is permanent: all saved answers hang off it. Letters, digits, `_`, `.`, `-` only.
- `chapterNumber` is an integer and unique. Answers are saved under it, so never renumber a published chapter.
- Everything inside a chapter is a flat list of **elements**, shown in order.

## 3. Elements: a passage and a question

Every element has a `type` and an `elementId`. Name them `ch01-el01`, `ch01-el02`… in document order, and never change one after release (that orphans saved answers).

```json
{ "elementId": "ch01-el04", "type": "biblePassage", "bibleRef": "Romans 1:16–17",
  "passageText": "<p><sup>16</sup>…</p>", "passageUrl": "https://www.biblegateway.com/…" },
{ "elementId": "ch01-el05", "type": "question", "subtype": "standard",
  "question": "Why is Paul not ashamed of the gospel?", "linkedPassage": "Romans 1:16–17",
  "questionHint": "Look for the word ‘because’.", "sampleAnswer": "…" }
```

The passage is **not shown in the chapter**. It becomes a pop-up when the reader taps the verse reference on the question. Two rules cause most mistakes:

1. `linkedPassage` must equal `bibleRef` **exactly**, down to the dash (`–` is not `-`).
2. The passage must come **before** the question in the list.

Question subtypes: `standard` (a passage question), `reflection` (personal, no answer check), `header` (a label of your own instead of a verse reference, often the opening question). Other elements: `text` (`intro`, `bridge`, `closing`), `heading` (`section`, `subsection`, `reflection`), `callout`, `image`, `likertScale`.

## 4. Helping the answer check

The reader can tap a check button on a `standard` question. It runs offline and never grades. Two optional fields make it more useful:

- `keyTerms`: the ideas a good answer should contain, one string per idea, alternatives separated by `|` (`"justif|declared righteous"`; `"sin$"` means the whole word). Without `keyTerms` the check can only say "Looks good".
- `mainPoint`: a short statement of the key idea, shown when the reader taps **Main point** after answering.

Both are visible to anyone who opens the study file, so don't put anything secret in them.

## 5. A book alongside the study (Go Deeper)

`goDeeperData` holds the book chapters. Each Go Deeper chapter is a tab; its keys (other than the reserved ones) become blocks **in file order**:

```json
"chapters": [ { "chapterNumber": 1, "backToStudy": true, "title": "…", "footnotes": [ { "id": 1, "body": "…" } ],
  "introduction": { "subtype": "standard", "body": "<p>[[fn:1]]Text…</p>" },
  "exercise":     { "subtype": "highlighted", "header": "Exercise", "body": "<p>…</p>" } } ]
```

- `"readMoreButtons": true` (top level) puts **Read more** at the end of each study chapter, linking to the Go Deeper chapter with the same number. `backToStudy: true` on the Go Deeper chapter adds the way back. Previous and Next buttons appear automatically; text defaults to the neighbouring chapter titles.
- Footnotes are numbered 1, 2, 3… in each chapter (by convention; the app shows the id as the note number), and every `[[fn:N]]` needs its entry.
- A block with a header and an empty `body` shows just the heading. A `highlighted` block with an empty body shows nothing.
- Tables need `"format": "HTML"` and the two classes in `STUDY-FORMAT.md` section 10.
- Never end a block key in a digit.
- Keep the intro tab's `header` short ("About"); many tabs scroll sideways.

## 6. Things you must not do

- No `<script>`, no `style=` attributes (use a class), no curly quotes around attribute values.
- No `apiKey` or `studyAiData`: the AI tutor was removed.
- No fields the app ignores (`answerType`, `required`, `tags`, `shareMessage`, `publishedBy`, `year`, `ctaLabel`). `STUDY-FORMAT.md` section 11 lists them.
- Don't type Bible text from memory. Use text from a source you hold the right to use.

## 7. Check, test, release

1. `python3 validate_study.py study.json` until it reports no errors.
2. Zip with `images/` if you have pictures, rename to `.estudy`.
3. Open it in the app: a passage pop-up, a hint, a footnote, a table at phone width, Read more and Back to study.
4. **To update a study, raise `studyVersion`** (1.0 → 1.01). A newer version installs over the old one. If a student opens a file with the same or a lower version than the one they already have, the app asks whether to keep what they have or install the file anyway. Number versions with two decimal places: 1.01, 1.02 … 1.09, 1.10 (1.1 is the same as 1.10).
5. Remember the copyright page always prints the app's CC BY-SA text, whatever you declare in `copyrightData`. If your study is not CC BY-SA, say so to Rick.
