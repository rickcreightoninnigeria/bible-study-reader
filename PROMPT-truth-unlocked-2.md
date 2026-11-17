# Prompt for the Bible Study Writing Project: bring Truth Unlocked (2) up to date

(Not part of the app. Paste everything below the line into the Project. Attach: the current `truth_unlocked_(2)_en_study.json` (v1.02) and, if you have it, the approved plan and the build script for this study.)

---

This is an **update** to an existing study, Truth Unlocked (volume 2), now at studyVersion 1.02 and 92 answer-box questions plus 18 reflections. Re-read STUDY-FORMAT.md, ANSWER-CHECK-TESTING.md and the current validate_study.py, answer-match.js and test_answers.py in the Project knowledge first: all five were refreshed on 17 November 2026 and the answer check itself changed (see "What changed in the app" at the end).

## What is wrong now

I ran `validate_study.py` and `test_answers.py --lint` on v1.02:

1. **No `mainPoint` on any of the 92 questions, and no `questionHintFirst` on any of them.** (The lint reports 184 "missing" findings: 92 + 92.) Newer studies such as 1 John for Today have both on every standard question.
2. **23 warnings: "sampleAnswer is flagged as repeating the passage"**, on these questions: ch10-el27, ch11-el09, ch13-el06, ch13-el09, ch13-el11, ch13-el28, ch13-el30, ch14-el19, ch14-el29, ch14-el31, ch15-el04, ch15-el26, ch15-el29, ch16-el04, ch16-el08, ch16-el12, ch16-el21, ch16-el24, ch16-el27, ch16-el29, ch16-el32, ch16-el34, ch16-el37.
3. **2 warnings: a reflection with a `linkedPassage` gets the answer-check button**, on ch10-el41 (Philippians 2:6-8) and ch14-el39 (Luke 10:38-42). A reflection is devotional and should have no local check: remove the `linkedPassage` from both.
4. **Lint findings on the key terms** (92 questions; the validator itself reports 0 errors): 27 `form` (for example `know` misses "knew"), 23 `tightPassage`, 14 `shortStem` (`sin`, `joy`, `lie`, `day`, `run`, `now`), 8 `generic` (`christ`), 3 `coarse` (only two key terms), and 65 `nearLimit`.

## What to do (update workflow: plan first, then rebuild)

1. **Edit the plan first**, not the JSON. If the approved plan is not attached, say so and stop; do not edit study.json by hand.
2. **Add to every standard question** (the 92; not the 18 reflections):
   - `mainPoint`: one or two plain sentences giving the answer's main idea, in the words of the key terms, at least 6 words, written so that it itself reaches "strong" in the answer check. It is shown by the **Main point** button after the reader has written an answer, so write it as feedback ("The main idea is…"), not as a quotation of the verse.
   - `questionHintFirst`: a gentle first nudge for the **Hint** button, shown while the answer box is still empty (for example where to look, or what kind of answer is wanted). It must not give the answer away. Keep the existing `questionHint` as the fuller hint that takes over once the reader has written something.
   - Both use one point per line (`\n` between points, each line becomes a bullet).
3. **Rewrite the 23 flagged `sampleAnswer`s** in your own words: keep the ideas and the key phrases that matter, not the Bible's sentence structure. Re-run the validator until the warning is gone for each. Keep the `keyTerms` plain-English alternatives so a paraphrasing reader can pass.
4. **Remove `linkedPassage` from ch10-el41 and ch14-el39.**
5. **Work through the key-term lint findings:** add word forms where `form` says one is missed (`knew` for `know`), use `$` or a longer stem for the 3-letter stems, replace or phrase the generic ones (`christ`), and add a third key term where a question has only two. Treat `nearLimit` as advice: fix it where it is easy, and list the rest in your report.
6. **Do not change** any question wording, `elementId`, chapter number or order. Readers' saved answers are stored under those ids.
7. Raise `studyVersion` to **1.03**. Rebuild with the build script (never by hand). Package as `.estudy` because the study has images.
8. Run `validate_study.py --explain` and `test_answers.py --lint` on the result, and report: errors (must be 0), the warnings that remain with a reason for each, and the lint counts before and after (324 findings now; 184 of them should disappear).

## Then Phase 3

Run a **Targeted** answer-check test (ANSWER-CHECK-TESTING.md section 2), not a Full one: the 23 reworked questions plus 6 others you choose across the chapters, with a fresh batch of blind answers. Give me the exact prompts for the controller chat and the blind writer chat, as in Phase 3 step 0, and do not start the run until I say so.

## What changed in the app (so your expectations match the current checker)

- **Spelling tolerance.** A key-term word of five or more letters now also matches a word that is one slip away (a letter wrong, missing, extra, or two swapped) when the first letter agrees. `$` and `*` terms are exempt. So a typo style should now reach "strong" much more often, and short stems are no longer the only protection against typos. Two real words one letter apart are not told apart (`grace` also matches "grave"): use `$` where that matters.
- **"Repeats the passage" is judged on copied runs.** Above 85% passage words (or with no words of the answer's own) it is still a repeat. Between 70% and 85% it is a repeat only if runs of five or more consecutive copied words make up half of the answer, or the answer is a list of words rather than sentences. So a correct answer that merely uses the passage's vocabulary in its own sentence is no longer called a copy. The 23 warnings above are the ones that remain under this rule, so they are real: the sample answers are close to the verse's wording.
- The live Project Instructions have not been updated for these two changes; follow this prompt and the knowledge files.
