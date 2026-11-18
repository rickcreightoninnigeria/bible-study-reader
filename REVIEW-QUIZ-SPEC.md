# Review (quiz) feature: draft spec

Status: **draft for approval, nothing built.** Written 18 November 2026 from the planning chat. Pilot study: 1 John for Today.

## 1. What it is

An optional end-of-study **Review** (menu name: "Review your learning"): multiple-choice questions that recap what the reader has learned. It is for recall, not assessment: no timer, no marks stored against the reader, no result sent to a leader.

Decisions already made:
- Shown in the Contents menu **between Study Group and Leaders' Notes**, only when the study has review data.
- Hidden in **Basic** mode; shown in **Intermediate** and **Advanced**. A setting turns it off; **on by default**.
- A question is stored as one right answer plus a pool of wrong answers (at least 4, 6 or more recommended). The app shows the right answer plus **3 wrong ones chosen at random, shuffled afresh each time**.
- Answers are hidden until the reader taps **Show answers**; then they tap the one they think is right.
- Before starting, the reader sets **how many questions** (default 10, adjustable) and **random or set order** (default random). One large **Start** button accepts the defaults.
- Ending: a gentle summary, **retry the ones missed**, and a "Can you beat your best?" prompt.
- Study groups: the leader never sees results.
- Print version for leaders: **deferred**, probably yes later.

## 2. Reader experience

**Start screen.** Heading "Review your learning"; one line of intro (study-supplied, optional); a count stepper ("10 questions", − and +, from 3 up to the number available); an order switch (Random / In order); a large **Start** button; and, if the reader has a best, "Your best: 8 of 10".

**A question.** "Question 3 of 10"; the question text; one large **Show answers** button. Tapping it reveals four large option buttons (right answer + 3 random wrong, shuffled). Tapping one:
- right: it turns green with a tick and a short encouraging line;
- wrong: the chosen one is marked, the right one turns green;
- either way the optional **explanation** appears (a sentence, or a chapter pointer such as "See chapter 2"), then **Next**.
No timer. Options are not re-shuffled once shown. Leaving mid-way asks "Leave this review?" once.

**Summary.** Gentle wording by score band (for example "Well done: 8 of 10", "A good start: 5 of 10, and the ones to look at again are below"). Buttons: **Retry the ones I missed** (asked again, with freshly drawn wrong answers; not counted towards the best), **Another round** (new draw), **Done**. If the reader beat their best: "A new best!". If not: "Your best is 9 of 10. Can you beat it?"

**Best score.** Stored per study **and per question count** (a best of 8 of 10 is not comparable with 8 of 20), on the device only. The Contents item gets a ✓ once a review has been finished.

## 3. Study file

New top-level block `reviewData` (like `goDeeperData`: no block, no menu item).

```json
"reviewData": {
  "title": "Review your learning",
  "intro": "Check what you remember. Nothing is recorded except your best score.",
  "questions": [
    {
      "id": "r01",
      "question": "What does John say God is?",
      "correct": "Light, with no darkness in him at all.",
      "wrong": ["Distant", "A judge only", "Hidden from us", "A mystery we cannot know", "Too holy to approach", "Silent"],
      "explain": "1 John 1:5.",
      "chapter": 1
    }
  ]
}
```

- `id` unique; `chapter` optional (used for the "See chapter N" link); `explain` optional.
- Multilingual studies follow the usual slot rule: `question1`, `correct1`, `wrong1` (an array), `explain1`, `title1`, `intro1`; fall back to slot 1.

**Automatic questions for a Bible-book study** (switched on by `reviewData.auto`):

```json
"auto": { "aboutChapter": true, "whichChapter": true }
```

- **"What is chapter N about?"** Needs one line per chapter: new optional chapter field `reviewSummary` (numbered in multilingual studies). The wrong answers are other chapters' summaries. Optional `reviewNotWith: [3, 4]` on a chapter lists chapters whose summaries are too similar to offer as wrong answers.
- **"Which chapter is this verse from?"** Needs verses: new optional chapter field `reviewVerses` (array of 1 to 3 verse texts the author picks, each a distinctive line, not the whole passage). Wrong answers are other chapters, shown as "Chapter 3" (plus the chapter title). Authors pick the verses so the questions are fair, and no reliance on how the passage HTML is formed.
- A study with fewer than 4 chapters gets neither automatic type (not enough options).
- In **set order**, the order is: written questions, then the "about" questions in chapter order, then the verse questions in chapter order.

## 4. Choosing questions and options

1. Pool = written questions + automatic ones. N is capped at the pool size.
2. **Random:** a random sample of N without repeats. **In order:** the first N in the order above.
3. For each question: take the right answer, draw 3 wrong answers at random from the pool (skipping any equal to the right answer, ignoring case), then shuffle all 4 (Fisher-Yates). If fewer than 3 wrong answers exist, show what there is (never fewer than 2 options in total).
4. A retry round draws fresh wrong answers.

## 5. Validator rules (`validate_study.py`)

Errors: `reviewData` not an object; a question without `id`, `question` or `correct`; duplicate ids; fewer than 4 wrong answers; the right answer also in the wrong list; `chapter` that does not exist; `reviewVerses` or `reviewSummary` of the wrong type.
Warnings: fewer than 6 wrong answers; two wrong answers that are nearly identical; **the right answer much longer than every wrong answer** (the classic giveaway); a wrong answer identical to another question's right answer in a way that suggests it is also true (listed for review); a multilingual slot missing; more than 200 questions; automatic types switched on but fewer than 4 chapters or no `reviewSummary` / `reviewVerses`.
Note for authors: the validator cannot tell when a wrong answer is accidentally true. Every wrong answer must be checked by a person, because a flawed one will only appear in some draws.

## 6. App changes (outline)

- `study-loader.js`: load `reviewData` into `window.reviewData` (and clear it on study change).
- `render-progress.js`: the Contents item, with ✓.
- New `review.js`: start screen, question and summary views, selection logic, best-score storage; new page route `review` in `router.js` and `navigation.js`.
- `settings.js` and the Settings page: `showPageReview` (default on; the menu item also requires Intermediate or Advanced mode).
- CSS: large tap targets, readable at 130% text, dark mode, no colour-only meaning (ticks and crosses as well as green and red).
- Interface strings: about 20 new keys, English first with the existing key-level fallback (the `review_` prefix exempted in `locale-error-strings.test.js` until translated, as `faq_` is).
- Accessibility: buttons are real `<button>`s; the question is announced; text size follows the app setting.
- Backup: the best score lives with the study's other saved data so Backup and Restore include it (to be confirmed in `backup.js`).
- Docs: `STUDY-FORMAT.md` (new section), `ARCHITECTURE.md`, FAQ entry, How to Use mention, What's New bullet, Project mirrors, a Writing Project prompt for authoring a review.
- Tests: selection logic (counts, no duplicates, correct option always present, shuffle, small pools), best-score keying, menu visibility rules, validator rules.

## 7. Build order

1. **Spec approved** (this document).
2. **App with a test fixture**: everything above except translations, using a small invented study.
3. **1 John for Today content** from the Writing Project (about 20 to 25 written questions, a `reviewSummary` for each of 5 chapters, 2 to 3 `reviewVerses` per chapter), then validator and a read-through of every wrong answer.
4. Translations of the interface strings; tutorial or FAQ text.
5. Later: printable version for leaders; optional read-aloud of the question (the app already has text-to-speech).

## 8. Points to confirm

1. Hide in Basic and show in Intermediate and Advanced: is that the intent of "Intermediate"?
2. Authors pick the verses for "Which chapter?" (this spec), rather than the app choosing a random verse from the passage text.
3. Best score kept per question count, retries not counted.
4. Automatic questions come after the written ones in set order.
5. Menu title "Review your learning" (study can override with `title`).
