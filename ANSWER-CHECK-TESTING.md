# ANSWER-CHECK-TESTING.md: testing a finished study's answer check

Run this **after** a study has been built and passes `validate_study.py`, and **before** it is released. It tests the *behaviour* of the answer check on realistic reader answers, which `validate_study.py` cannot do: the validator only proves that the author's own `sampleAnswer` and `mainPoint` pass. `STUDY-FORMAT.md` sections 7 and 8 describe the check; this file describes how to test it. Tool: `test_answers.py` (needs Node.js and the app's `answer-match.js`, found as for `validate_study.py`). Revised 8 November 2026 after an independent review; section 9 says what changed and why.

## 1. What the test is for, and what it is not

The check never grades. It tells a reader, offline, whether an answer looks like an attempt that covers what the author hoped for. It compares words; it cannot read meaning. Two ways it can fail a reader:

- **False negative:** a correct answer is told "partial", "a different direction" or "repeats the passage". This discourages, and is the most common real defect.
- **False positive:** a poor or wrong answer is told "Nice work". Because only words are compared, some of this is built in. The test measures how much, as a **rate**, and does not pretend to remove it.

Three kinds of finding, because they have three different owners: a **study defect** (fix the key terms or the question), an **app limitation** (record it; the app developer decides), and a **test defect** (a mislabelled answer; fix the answers file).

## 2. What to run, and when

| Run | What | Needs a writer? | When |
|---|---|---|---|
| **Lint** | `--lint` | no | Every build. Seconds. |
| **Auto** | `--auto`: weak answers generated from the study's own text (filler, fragment, question echo, passage copy, two key-term salads) for **every** question | no | Every build. Seconds. |
| **Smoke** | one question per session, written answers, seed recorded | yes | After a build, as a quick look |
| **Targeted** | only the questions whose key terms, sample answer, passage, `shortAnswerThreshold` or `skipBibleVerseCheck` changed, with a **fresh** batch | yes | Before releasing an update |
| **Full** | every question with key terms (1 John: 74 questions = 1,258 written answers) | yes | Before the first release, and when a large share of key terms changes |

Section 11 has the prompts to give the assistant at each step. Write in batches of one session at a time. Running the answers takes seconds; writing them is the work, which is why lint and auto exist: they find most key-term defects without a writer.

## 3. The recipes

Every question gets the same recipe so that coverage is systematic. The recipes live in `test_answers.py` (`STRONG_STYLES`, `WRITTEN_WEAK`) and in the briefing it generates.

**Strong answers (13 per question), written. Each must be a genuinely correct, reasonably complete answer.** Role decides how a result counts (section 6).

| Id | Style | Role | What to write |
|---|---|---|---|
| S1 | model | core | The answer a thoughtful reader would give, in your own words |
| S2 | formal | stress | Formal or academic; longer words; complete sentences |
| S3 | casual | core | Chatty; contractions; a personal aside |
| S4 | textspeak | diagnostic | Typed on a phone: abbreviations, no capitals, little punctuation |
| S5 | concise | core | One short sentence that is still fully correct |
| S6 | long | stress | Long, a little rambling, correct, with a personal touch |
| S7 | simpleEnglish | core | Plain English as a second-language reader might write it; minor grammar slips |
| S8 | synonyms | diagnostic | Deliberately avoids the passage's words and the obvious words |
| S9 | otherAngle | stress | A different but valid emphasis or order, or the other legitimate reading where there is one |
| S10 | notes | stress | Notes style: numbered points, dashes, semicolons, fragments |
| S11 | quoteComment | diagnostic | Quotes the verse's key words in quotation marks, then adds a sentence or two of its own (a common real habit, and the likeliest way a correct answer is called a copy) |
| S12 | hugging | diagnostic | A short correct answer, about 10 to 15 words, keeping close to the passage's own wording |
| S13 | typos | diagnostic | A correct answer with the spelling slips of a hurried or second-language typist: three or four misspelt words |

**Weak answers written by the tester (4 per question).** None may be a correct, complete answer.

| Id | Kind | What to write | Tier | Expected |
|---|---|---|---|---|
| W1 | passageReword | The passage with a few words swapped or reordered, adding nothing | B | anything except `strong` |
| W2 | offTopic | Sensible and fluent, but about something else | A | anything except `strong` |
| W3 | halfRight | Right about **one** idea only, silent on the rest (fewer than half of the ideas) | B | `partial` |
| W4 | misguided | Confident and wrong: the opposite lesson, in on-topic words | B | anything except `strong` |

**Weak answers generated by the script (A1 to A7), so a writer is not needed:**

| Id | Kind | Made from | Tier | Expected |
|---|---|---|---|---|
| A1, A2 | filler | "idk", "Not sure about this one." | A | `stuck`, `tooShort` or `offTopic` |
| A3 | fragment | the first words of the sample answer, fewer than the minimum | A | `tooShort` (or `stuck`) |
| A4 | echoQuestion | the question text | A | `repeatsQuestion` (or `tooShort`) |
| A5 | passageCopy | the passage text (not made if `skipBibleVerseCheck` is on) | A | `repeatsPassage` (or `repeatsQuestion`, `tooShort`) |
| A6 | keySalad | the first alternative of every key term, padded to the minimum length | B | reported as a rate |
| A7 | keySaladFresh | alternatives that are *not* in the passage, padded likewise | B | reported as a rate |

**Tier A** are hard criteria: the check is built to handle these, so a miss is a defect. **Tier B** probe what a word-matcher cannot know. They never fail a question on their own; they are reported as **rates by kind across the study**, because one question's result says little. The salads are the extreme case: anyone typing the key words, in any order, with no meaning, passes. On 1 John that is 91% (A6) and 96% (A7) of questions. It is not a study defect; it is the measured size of the limit.

## 4. How to write the answers (protocol, to keep the test honest)

1. **Generate the briefing:** `python3 test_answers.py --brief OUTDIR study.json [--session N | --only ID,ID]`. It writes `brief.md` (question, passage on screen, minimum word count, the recipes), `answers_skeleton.json`, and `reference.md`. **`reference.md` holds the reference answers, hints, main points and key terms and is for the adjudicator only.** Never give it, or the study file, to the person writing the answers.
2. **Why the briefing leaves out the reference answer and hints.** The validator forces every `sampleAnswer` and `mainPoint` to reach "strong", so they contain the very vocabulary the key terms were built from. On 1 John, the question and passage alone already contain at least two of the four key terms for 67 of 74 questions; with the hints, 73; with the reference answer, all 74. An answer "close to the reference answer" cannot fail. Decide what is correct from the passage itself; the adjudicator uses `reference.md` afterwards.
3. **Use a fresh conversation** that sees only `brief.md`. A conversation that wrote the plan or the key terms cannot un-see them. If that is the only option, run `--brief ... --with-reference`, which records the run as `semi-blind`; a semi-blind run flatters the study, so say so in the report.
4. **Write as a person would**, not as a test designer. Vary S7, S8 and S13 hardest: they are where a shared vocabulary hides defects. Better still, have a second writer (a different model, or a person) do S7, S8, S13.
5. **Freeze before running.** Do not edit an answer after seeing its result. An answer found to be wrongly labelled (a "strong" answer that is in fact incomplete) may be replaced only with a note in the adjudication log, and the replacement must be written fresh from the briefing.
6. **Fresh batch for every fix.** After changing key terms, write a new batch for those questions. The old batch becomes a regression set: run it with `--compare previous_results.json` and it must score no worse. `--run` checks `meta.studyId` and warns when `meta.studyVersion` differs, which is exactly the regression case.
7. **Keep the answer files out of the app repository.** The copy and reword answers contain Bible text, and the files are test artefacts, not study content.
8. **Real reader answers** are the best correction for writers' bias. The app never sends answers anywhere, so they have to be volunteered: ask test readers to paste a few answers (and which question), add them to the strong set (style `model`, `protocol` noted) or to the weak set as appropriate.

## 5. Answer file format

```json
{
  "meta": {"studyId": "1_john_for_today_v001", "studyVersion": 1.04, "author": "Claude", "date": "2026-11-08",
           "protocol": "blind", "seed": 20261108},
  "questions": {
    "ch06-el09": {
      "strong": [ {"id": "S1", "style": "model", "text": "..."}, ... S13 ],
      "weak":   [ {"id": "W1", "kind": "passageReword", "text": "..."}, ... W4 ]
    }
  }
}
```

`json templates/example_answers.json` is a complete worked example for two questions. The script checks the file before it believes it: every one of the 13 strong styles and 4 weak kinds must be present once (a question lacking any is **INCOMPLETE**, which is not a pass; `--allow-incomplete` downgrades that to a warning for a deliberate partial run); style and kind names must be known; no answer may be empty; and each label must fit what the answer measurably is (a passage copy must be at least 90% passage words, a question echo 70% question words, filler six words or fewer, a fragment four or fewer, a reword at least 40% passage words). A half-right, misguided or off-topic answer must also stay under the app's own repeat limit (70% passage words in English): above it the app calls the answer a copy, so it is a mislabelled copy, not a half-right answer. Overlap is always measured against the real passage, even on a question with `skipBibleVerseCheck`. A problem makes the run **invalid** (exit 2) instead of letting a mislabel pass quietly.

**Accepted exceptions.** When the author decides that a strong answer's shortfall is not a study defect and will not be fixed (for example a correct notes-style answer at 71% against the 70% limit), the decision is recorded in the answers file, not by editing or replacing the answer: `"accepted": [{"question": "ch04-el13", "id": "S10", "reason": "..."}]` inside `meta`. The question then reports **PASS (1 accepted)**, the report lists the exception with its reason, and the answer still counts in the rates. A reason is required; only a written strong answer can be accepted; an acceptance cannot hide a different failure; one for an answer that no longer falls short produces a warning. Only the author accepts: the assistant records an exception only when told to, in the author's words.

## 6. Running it and reading the result

```
python3 test_answers.py --lint  study.json
python3 test_answers.py --auto  study.json [--report auto.md]
python3 test_answers.py --brief OUTDIR study.json --session 3
python3 test_answers.py --run   study.json answers.json --report report.md --json results.json [--compare previous.json]
```

**Exit status:** 0 everything passed; 1 a question failed (or an answer is worse than in `--compare`); **2 the test could not run or its input is unusable** (missing Node or `answer-match.js`, unreadable files, a bad answers file). Treat 2 as "not tested", never as a pass or a fail.

**Pass criteria, per question:**

1. **Core styles** (S1, S3, S5, S7): all four must be `strong`.
2. **Core and stress styles** (those four plus S2, S6, S9, S10): none may have a hard failure (`stuck`, `tooShort`, `repeatsQuestion`, `repeatsPassage`, `offTopic`), and at most one stress answer may fall short of `strong`.
3. **Diagnostic styles** (S4, S8, S11, S12, S13) never fail a question. A hard failure among them marks the question **REVIEW**; their rates by style are in the report, and they are what to look at to see what real readers may meet.
4. **Tier A weak answers** (written and generated): every one handled as expected.
5. **Tier B** is reported, never a failure. A question is flagged **REVIEW** if two or more written Tier B probes fall outside expectation; if a key term was hit by fewer than 30% of the strong answers (a *dead* term; synonym and typo answers are not counted); if one key term was hit by both the off-topic and the misguided answer (it cannot tell good from bad); if a diagnostic answer had a hard failure; or if there are **fragile passes**: strong answers that are only just strong (the minimum number of key terms, within 10 points of the repeat limit, or within one word of the minimum length). A fragile pass is a failure waiting for the next reader.

**Release gate for a study:** every question PASS (accepted exceptions count, and are listed with their reasons) and none INCOMPLETE; `--auto` clean (every Tier A answer caught); every REVIEW, fragile pass and Tier B item outside expectation recorded in the adjudication log with a decision (fix, accept, or report to the app developer); the Tier B rates by kind seen and accepted by the author; untested questions listed (a Full run leaves none). There is no study-wide recall percentage: with 13 answers per question a percentage says little, and the gate above asks the questions that matter (do the core answers always pass, and are the near-misses explained).

## 7. Adjudication: deciding what a finding means

For every failure, REVIEW and Tier B item outside expectation, decide which of these it is, and record it:

| Finding | Typical signs | Action |
|---|---|---|
| **Mislabelled strong answer** | A "strong" answer is actually incomplete or wrong | Replace it (with a note); do not change the study |
| **Mislabelled weak answer** | A "halfRight" or "misguided" answer is really a copy of the passage or a full answer | Replace it (with a note) |
| **Key terms too narrow** | Correct answers missed a term only because of wording ("lots" for "many") | Add everyday alternatives |
| **Stem or form gap** | `love` misses "loving"; `teach` misses "taught"; `believe` misses "belief"; `lov` is safe but a 3-letter stem is broad | Add the form, or a stem of four or more letters. `--lint` finds these from the real matcher |
| **Key terms miss part of the question** | A two-part question (the situation *and* the reason); an answer to one part scores `offTopic` or 1 term | Add a key term for the other part, or split the question |
| **Misaligned key terms** | A term is missed by nearly every good answer and matches nothing in the passage or question | Rewrite from the passage on screen |
| **Restatement trap** | A correct short answer that stays close to the verse is flagged `repeatsPassage`; the quote-and-comment or hugging answer is near 70% | Prefer reducing the passage words the key terms depend on. `skipBibleVerseCheck: true` fixes it but **also switches off copy detection** for that question (a pasted passage then reaches "strong" through the key terms); use it only for a question that asks what the verse says, and record why |
| **Loose or broad alternative** | A lone broad word (`spirit`, `human`, `people`, `love`, `god`) lets an unrelated or wrong answer in | Make it a phrase, add `$`, or drop it. `--lint` reports `broad` and `generic` ones |
| **Dead or generic term** | From the term diagnostics | Replace it with a term that real answers use |
| **Typos** | A correct answer with misspelt key words scores `partial` | App limitation (no spelling tolerance). Prefer short stems; record the rate |
| **App limitation** | A reword under 70% overlap, a wrong answer using on-topic words, or a salad of key words gets `strong`; "Nice work — your answer includes the main ideas" is the message for all of these | Not fixable in the study. Record it; it is the measured false-positive rate |

All changes are content changes: **edit the plan first**, rebuild with the build script, run `validate_study.py --explain`, raise `studyVersion` for anything readers may already have, then run the Targeted test with a fresh batch.

## 8. The lint (no answers needed)

`--lint` flags, for every question that gets the answer check and has key terms:
- **unanchored:** two or more key terms that match nothing in the linked passage or the question;
- **form:** an alternative that will not match a form readers use, found by trying the form against the real matcher (so it never reports a gap that is not there): `-ing` forms of a list of verbs ending in `-e`, `-ied`/`-ies` forms of verbs ending in `-y`, irregular pasts (taught, kept, knew), and derived words (belief, wisdom, strength, truth);
- **generic:** an alternative that is a stopword or two letters or fewer;
- **shortStem:** a 3-letter alternative without `$` (it matches every longer word that starts the same way);
- **broad:** an alternative found in 30% or more of this study's own model answers (needs at least 10 questions);
- **nearLimit:** a `sampleAnswer` or `mainPoint` with 50% or more of its words in the passage (the limit is 70%), so a reader copying it, or a faithful short answer, is close to being called a copy;
- **tightPassage:** a passage of 12 content words or fewer;
- fewer than three key terms; no `mainPoint`; no `questionHintFirst`.

Lint findings are prompts for a human, not verdicts. A passage longer than 12 content words can still be tight: the `hugging` answer in the written test is what shows it.

## 9. What the reviews found (1 John for Today 1.04)

Reproduced in the revision: the pilot report is identical when run again, and the first lint found 131 findings in 61 questions. The revised lint finds fewer false alarms (the first one claimed `confess` would not match "confessing" and `conquer` "conqueing"; neither is true) and more real gaps.

- **Generated answers on all 74 questions:** every Tier A answer was caught (filler, fragment, question echo, passage copy). The key-term salads reached "strong" for 91% (first alternatives) and 96% (alternatives not in the passage) of questions.
- **Probes that showed the recipe's gaps:** a verse quoted with a short comment of the writer's own scored 67% passage overlap (limit 70%); a faithful 13-word answer scored 73% and was told it repeats the passage, on a passage of 18 content words that the old lint rule (10 or fewer) would never flag; "tset every spirt becuase … fals prophats" scored `partial`. Hence S11, S12 and S13.
- **The pilot's Tier B results, read again:** a reword of the passage at 58% overlap was `strong` (app limitation); a "half-right" answer about the readers' situation scored `offTopic` because no key term covers that half of a two-part question (a study gap, not an app limit); another "half-right" answer was really a 13-word near-copy of the passage, and `repeatsPassage` was right (a mislabelled answer); a wrong answer reached `strong` through two loose alternatives, `spirit` and `human`.
- **The earlier smoke run (6 questions, 60 answers: 51 strong, 6 partial, 2 off topic, 1 repeats-passage)** was not re-run in the revision. Its causes (key terms for verses not on screen, a term from the wrong verse, a one-verse passage called a copy, stem gaps) are what the lint now looks for.

## 10. Notes and limits

- **Language.** Only English has a stopword list (`STOPWORDS_BY_LANG`); for other languages the repeat threshold is 85% and the check is looser. In a multilingual study `--slot N` tests language slot N (default 1); the passage text of every translation is used, as the app does. Write the answers in the study's language, and treat results as indicative until someone who reads it has reviewed them. The generated filler answers are English only.
- **What the harness copies from the app.** The questions that get the check (not a header or reflection, or any with a `linkedPassage`), the active-slot field rules, the raw `sampleAnswer` for the minimum length, and `skipBibleVerseCheck` being `true` or `"true"` only. The question text is the plain text of the question as authored, which is close to, not identical with, what the screen shows.
- **Not tested:** how the messages read (note: the strong message, now "Nice work — your answer includes the main ideas", was reworded on 8 November 2026 from "Well done — your answer covers the main ideas", which claimed more than a word match can know); the UI; devices; the check on questions with no key terms (they get only the loose sample-answer check).
- **Small samples.** Thirteen answers per question give rough hit rates; rates by kind across a whole study (74 questions) are more trustworthy than any one question.
- **Rights.** Answers are written fresh; the passage copy and reword answers contain Bible text and must stay out of the app repository.

## 11. Prompts for the user, and when the assistant hands them over

In a Claude Project the user drives the test with a few prompts, in two kinds of chat: a **controller** chat (it holds the study and runs the script) and a **blind writer** chat (it holds only the briefing, so it cannot see the key terms). The assistant gives the user the right prompt at each hand-over point below, in a code block, with the square brackets filled in, and says which chat it goes in and which files to attach.

| Hand-over point | Prompt | Chat | Attach |
|---|---|---|---|
| Phase 2 is done and the validator, lint and auto results have been reported | 2 (a written run) | controller | `study.json` or the `.estudy` |
| The briefing has just been generated | 3 now; 4 for when the user returns | new blind writer chat | `brief.md`, `answers_skeleton.json` |
| The report has just been given | 5 | controller | the approved plan, `results.json` |

A study finished somewhere else starts at prompt 1. If the test cannot run (no Node, or status 2), the assistant says so and gives no further prompt.

**Prompt 1: quick checks on a finished draft** (controller; attach the study)

```text
Phase 3, step 1 only. Run test_answers.py --lint and --auto on the attached study and report the findings. Tell me if either exits with status 2.
```

**Prompt 2: start a written run** (controller; attach the study)

```text
Phase 3, [Smoke run (one question per session, seed recorded) | Targeted run for these questions: ID, ID | Full run for session N]. Generate the briefing with --brief. Give me brief.md and answers_skeleton.json to download. Do not write any answers, and do not show me reference.md.
```

**Prompt 3: write the answers** (a NEW chat in the same project; attach only `brief.md` and `answers_skeleton.json`)

```text
Write the test answers. Fill every empty text field in answers_skeleton.json from brief.md alone: 13 strong and 4 weak answers per question, in the styles and kinds the briefing lists. Every strong answer must be correct; no weak answer may be a correct, complete answer. Do not ask for the study file or anything else. Return the finished file as answers.json.
```

**Prompt 4: run the answers** (back in the controller chat; attach `answers.json`)

```text
Run the answers: test_answers.py --run study.json answers.json --report report.md --json results.json. Give me the report. For every failure, REVIEW flag, fragile pass and Tier B item outside expectation, classify it using the table in section 7 of ANSWER-CHECK-TESTING.md and propose the fix as a change to the plan. Do not change the study file.
```

**Prompt 5: after the fixes** (controller; attach the plan and `results.json`)

```text
Apply the approved plan changes, rebuild, validate, raise studyVersion. Then produce a briefing for the changed questions only, so I can get a fresh batch. When I bring it back, run it, and also re-run the old answers.json with --compare results.json: it must score no worse.
```

For a Full run, repeat prompts 2 to 4 for one session at a time. A conversation that starts with only `brief.md` and `answers_skeleton.json` attached is a blind writer: it writes the answers from the briefing alone and offers no hand-over prompts.
