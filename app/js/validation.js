// ── VALIDATION ────────────────────────────────────────────────────────────────
// Local validate: a lightweight, fully offline answer check for bible-study
// question cards.
//
// (This file once also held an AI tutor that called the Gemini API. That feature
// was removed; studyAiData in old study files is ignored. The filename is kept
// because index.html and the script-order test refer to it.)
//
// Entry point:  openLocalValidateForCard(buttonEl)
//   Called by the localValidate button injected into each bible-question card.
//   Reads the current answer, runs heuristic checks, and shows the result in
//   a self-dismissing toast. Nothing is persisted or appended to the answer.
//
// The local-validate icon is:
//   • Always visible on eligible cards (independent of AI availability)
//   • Disabled when the answer field is empty
//   • Hidden on non-bible question subtypes (reflection, deeper, etc.)
//
// sampleAnswer (optional, per question):
//   If a question element carries a sampleAnswer field in the study JSON, the
//   renderer should pass it as data-sample-answer on the .question-card element.
//   _localValidate reads it from the DOM if present and uses it for thematic
//   checking. It is never rendered visibly to the user.
//
// shortAnswerThreshold (optional, per question):
//   Overrides the default minimum word count used in the short-answer check
//   (step 2) for a specific question. Useful when a genuinely short answer is
//   the correct form of response (e.g. "name one word", "which option best
//   describes you?").
//
//   The renderer resolves the effective threshold and writes it as
//   data-short-answer-threshold on the .question-card element:
//
//   Monolingual studies:
//     element.shortAnswerThreshold  →  data-short-answer-threshold
//
//   Multilingual studies (languageN suffix convention):
//     Resolution order for the active language suffix N:
//       1. element.shortAnswerThresholdN  (per-language override)
//       2. element.shortAnswerThreshold   (cross-language default)
//       3. Attribute omitted              (built-in default logic applies)
//
//   Values:
//     Integer ≥ 1  — use as the minimum word count for this question
//     0            — disable the short-answer check entirely for this question
//     Absent       — use the existing default (35% of sampleAnswer length, ≤ 6)
//
// skipBibleVerseCheck (optional, per question):
//   Disables the passage-repetition check (step 4) for a specific question.
//   Use when the correct answer is expected to quote the passage directly —
//   e.g. "What does Paul say about X?" or "Copy out the memory verse."
//
//   Set as a boolean attribute on the .question-card element:
//     data-skip-bible-verse-check="true"  →  step 4 is skipped
//     Absent or any other value           →  step 4 runs as normal
//
//   Unlike shortAnswerThreshold, this is a simple boolean with no per-language
//   variant — it applies to all languages for the question.
//
// ── SHARED DEPENDENCIES (globals) ────────────────────────────────────────────
//   ICONS, showToast, chapters, currentChapter, storageKey,
//   saveAnswers, verseData
// ─────────────────────────────────────────────────────────────────────────────


// ── Question text ─────────────────────────────────────────────────────────────

// Extracts the question text from the card DOM.
function _getQuestionText(card) {
  const el = card.querySelector('.question-text');
  return el ? el.innerText.trim() : '(question not found)';
}

// ═════════════════════════════════════════════════════════════════════════════
// STRAND 2 — LOCAL VALIDATE
// ═════════════════════════════════════════════════════════════════════════════
//
// Lightweight offline answer checking for bible-study question cards.
// Triggered by a dedicated icon in the answer-action-row. Results appear in a short-lived toast only;
// nothing is persisted or appended to the answer.
//
// Question subtypes that local validate handles:
//   standard, header   — full heuristic checks + sampleAnswer thematic check
//
// Question subtypes that local validate skips (hidden icon):
//   reflection, deeper — these are personal/devotional; heuristic checks
//                        would be misleading or patronising
//
// sampleAnswer:
//   An optional, study-author-supplied model answer stored in the element JSON.
//   The renderer should write it as data-sample-answer on the .question-card
//   element IF it is present. _localValidate reads it from there if available.
//   It is never rendered visibly to the user anywhere in the UI.
//
// shortAnswerThreshold:
//   An optional per-question override for the minimum word count checked in
//   step 2. The renderer resolves the effective value (honouring the
//   shortAnswerThresholdN / shortAnswerThreshold multilingual fallback chain)
//   and writes it as data-short-answer-threshold on the .question-card element.
//   0 = disable the short-answer check entirely for this question.
//   Absent = use the built-in default (35% of sampleAnswer length, capped at 6).
//
// ── Eligibility check ─────────────────────────────────────────────────────────

// Question subtypes that local validate should run on.
// Add further eligible subtypes here as needed.
const _LV_ELIGIBLE_SUBTYPES = new Set(['standard', '']);

// Returns true if this card should show the local validate icon.
// Rules (either condition is sufficient):
//   (a) type=question, subtype is in _LV_ELIGIBLE_SUBTYPES
//   (b) type=question, any subtype, where data-linked-passage is present and non-empty
function localValidateEligible(card) {
  if (!card) return false;
  const subtype       = (card.dataset.questionSubtype || '').toLowerCase().trim();
  const linkedPassage = (card.dataset.linkedPassage   || '').trim();
  return _LV_ELIGIBLE_SUBTYPES.has(subtype) || linkedPassage.length > 0;
}


// ── "Still working on this answer" suppression ───────────────────────────────
// A textarea blurs whenever the user taps anything else on screen — including
// controls inside the *same* question card that have nothing to do with
// leaving the answer (rereading the linked verse, opening the info popup,
// starting voice input, tapping the star, switching translation tabs). Mobile
// browsers dismiss the keyboard (and fire blur) on any outside tap, even
// though the user hasn't finished composing.
//
// To tell "still working" taps apart from an actual "I'm done with this
// answer" blur, we watch pointerdown (which always fires before blur) and, if
// it lands on one of these in-card controls, set a short-lived flag.
// localValidateAutoTrigger checks the flag and skips entirely when set —
// no validation run, no scroll, no toast — leaving lvLastAnswer untouched so
// the *next* genuine blur still validates normally.
//
// The flag auto-clears after 500ms as a safety net, so a stray pointerdown
// that never actually causes this textarea's blur can't suppress some later,
// unrelated auto-validate.
const _LV_STILL_WORKING_SELECTOR =
  '.question-ref [data-ref], .deeper-btn, .answer-info-btn, .mic-btn, ' +
  '.local-validate-btn, .verse-trans-btn, .star-btn';

// PRIMARY FIX: a browser only blurs the currently focused field, on either
// desktop or mobile, as the *default action* of the mousedown/tap that
// targets something else. Canceling that default action on mousedown — the
// standard technique editor toolbars use so their buttons don't steal focus
// from the field being edited — stops the blur from happening at all. The
// click still fires normally afterwards (only the focus-shift default is
// canceled), so openVerseModal() etc. still run exactly as before. With no
// blur, neither save.js's auto-save nor localValidateAutoTrigger below ever
// run in the first place — nothing to suppress after the fact.
document.addEventListener('mousedown', e => {
  if (e.target.closest(_LV_STILL_WORKING_SELECTOR)) {
    e.preventDefault();
  }
}, true);

// FALLBACK: on the rare engine/webview where the above doesn't hold and blur
// still fires anyway, this flag (set on pointerdown, ahead of any blur) lets
// both localValidateAutoTrigger (below) and save.js's blur listener detect
// and skip that blur's side effects. Self-clears after 500ms.

let _lvSuppressNext = false;
let _lvSuppressTimer = null;

document.addEventListener('pointerdown', e => {
  if (e.target.closest(_LV_STILL_WORKING_SELECTOR)) {
    _lvSuppressNext = true;
    clearTimeout(_lvSuppressTimer);
    _lvSuppressTimer = setTimeout(() => { _lvSuppressNext = false; }, 500);
  }
}, true);

// STRONGER FALLBACK: on platforms/webviews where the OS dismisses the
// keyboard (and blurs the field) as part of touch handling itself — before
// mousedown's preventDefault has any chance to matter — the mousedown fix
// above can't stop the blur from happening. In that case, reclaim focus for
// the same textarea right away, in the same tick the blur fired in. This
// means the field never really stops being "the one being edited" for more
// than an instant, regardless of which lower-level mechanism caused the
// blur — so there is no real "user left the field" moment here for
// localValidateAutoTrigger to (correctly) react to.
document.addEventListener('blur', e => {
  if (_lvSuppressNext && e.target.classList && e.target.classList.contains('answer-field')) {
    const el = e.target;
    setTimeout(() => el.focus(), 0);
  }
}, true);

// Overlays that represent "the user is still engaged with this question,
// not leaving it" — the verse modal, the deeper-answer modal, the Likert
// info popup, and the shared info modal (used by the answer-info icon). If
// any of these is open when the deferred check below runs, the blur that preceded it was caused by opening one of them, not by
// the user actually moving on.
const _LV_STILL_WORKING_OVERLAYS =
  '#verseModalOverlay.open, #deeperModalOverlay.open, #likertPopupOverlay.open, ' +
  '#qaModalOverlay.open, #info-modal-overlay.open';


// ── Public entry point ────────────────────────────────────────────────────────

// Scrolls the card to the centre of the viewport, then shows the toast.
// Centralising first ensures the toast never obscures the answer field,
// regardless of where on the screen the card started.
function _localValidateShowFeedback(card, feedback) {
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  showToast({ message: feedback, duration: 10000, elementId: 'validate-toast', isManual: true });
}

// Called by the localValidate button injected into each eligible question card.
// buttonEl — the button DOM element that was tapped.
function openLocalValidateForCard(buttonEl) {
  const card = buttonEl.closest('.question-card');
  if (!card) return;

  const textarea = card.querySelector('.answer-field');
  const answer   = textarea ? textarea.value.trim() : '';

  // Guard: icon should be disabled when empty, but double-check here
  if (!answer) return;

  const questionText          = _getQuestionText(card);
  const sampleAnswer          = card.dataset.sampleAnswer || null;
  const questionHint          = card.dataset.questionHint || null;
  const shortAnswerThreshold  = card.dataset.shortAnswerThreshold ?? null;
  const skipBibleVerseCheck   = card.dataset.skipBibleVerseCheck === 'true';

  const feedback = _localValidate(answer, questionText, card, sampleAnswer, questionHint, shortAnswerThreshold, skipBibleVerseCheck);

  // feedback is always a non-null string (either a problem message or a
  // positive confirmation). Scroll card to centre first so the toast
  // never covers the answer field, then display.
  _localValidateShowFeedback(card, feedback);
}

// Called from the textarea's blur handler (onblur attribute in
// render-chapter-elements.js) when localValidate mode is 'auto'. Runs
// validation only if the answer has changed since the last time validation
// ran on this card, AND only once we can confirm the user actually left the
// field rather than just tapping something inside the same card.
//
// We store the last-validated answer text in a data attribute on the card
// so we can diff on the next blur without any external state.
function localValidateAutoTrigger(textareaEl) {
  if ((appSettings.localValidateMode || 'manual') !== 'auto') return;

  const card = textareaEl.closest('.question-card');
  if (!card) return;

  // Only fire if card has a validate button (i.e. it is eligible)
  const lvBtn = card.querySelector('.local-validate-btn');
  if (!lvBtn) return;

  // A blur fires whenever focus leaves the field for ANY reason — including
  // tapping the verse ref, info icon, mic, etc. inside the same card, which
  // is not the user leaving the answer. We can't tell those apart at the
  // instant blur fires, because the tap's own effect (e.g. openVerseModal()
  // adding .open to the verse overlay) runs via the click event, which is
  // dispatched immediately AFTER blur but still within the same synchronous
  // browser-handled tap — before any timer can fire. So we defer this check
  // to a short timeout: by the time it runs, that whole tap (blur → click →
  // modal open, if any) has already finished, and we can reliably tell
  // "still working" apart from "actually done" by looking at the result:
  //   • the same field already has focus again (quick tap back in), or
  //   • one of the still-working overlays is now open, or
  //   • the fallback pointerdown flag is set
  // — any of which means: not done yet, skip validating.
  setTimeout(() => {
    if (document.activeElement === textareaEl) return;
    if (document.querySelector(_LV_STILL_WORKING_OVERLAYS)) return;
    if (_lvSuppressNext) return;

    const answer = textareaEl.value.trim();
    if (!answer) return;                            // nothing to check

    const lastValidated = card.dataset.lvLastAnswer ?? null;
    if (answer === lastValidated) return;           // answer unchanged — skip

    // Record the answer we are about to validate so next blur can diff
    card.dataset.lvLastAnswer = answer;

    const questionText          = _getQuestionText(card);
    const sampleAnswer          = card.dataset.sampleAnswer || null;
    const questionHint          = card.dataset.questionHint || null;
    const shortAnswerThreshold  = card.dataset.shortAnswerThreshold ?? null;
    const skipBibleVerseCheck   = card.dataset.skipBibleVerseCheck === 'true';

    const feedback = _localValidate(answer, questionText, card, sampleAnswer, questionHint, shortAnswerThreshold, skipBibleVerseCheck);
    _localValidateShowFeedback(card, feedback);
  }, 120);
}

// ── Core validation logic ─────────────────────────────────────────────────────
//
// Returns a feedback string in all cases — never null.
// Callers decide how to display it (toast, thread, etc.).
//
// Parameters:
//   userAnswer           — the raw answer text from the textarea
//   questionText         — the question text (plain, from DOM)
//   card                 — the .question-card element (for passage lookup)
//   sampleAnswer         — optional model answer string (from data-sample-answer)
//   questionHint         — optional hint string (from data-question-hint)
//   shortAnswerThreshold — optional string from data-short-answer-threshold:
//                            '0'        → disable the short-answer check
//                            '1', '2'…  → use as the minimum word count
//                            null       → use built-in default logic

function _localValidate(userAnswer, questionText, card, sampleAnswer, questionHint, shortAnswerThreshold, skipBibleVerseCheck = false) {
  const answer = userAnswer.trim();

  // ── Shared utilities ────────────────────────────────────────────────────────
  // Appends the questionHint to withMsg as a new sentence if one is available; otherwise falls back to withoutMsg
  const withHint = (withMsg, withoutMsg) => questionHint
    ? withMsg + ' ' + questionHint
    : withoutMsg;


  const normalise = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

  // Words to exclude from overlap and thematic comparisons.
  // Biblical text is saturated with these, so they inflate overlap ratios falsely.
  const STOPWORDS = new Set([
    'the','a','an','and','or','but','in','on','of','to','is','it','he','his',
    'was','for','with','that','this','are','as','at','by','from','have','had',
    'not','be','has','were','they','we','you','i','my','our','their','him','her',
    'its','so','if','then','will','would','can','could','should','all','one',
    'who','what','which','when','how','do','did','been','more','no','up','out',
    // High-frequency biblical vocabulary that appears in almost every passage
    'god','jesus','lord','christ','said','went','came','upon','into','them',
    'him','us','me','thy','thee','thou','ye','unto','hath','doth','shall'
  ]);

  const contentWords = str =>
    new Set(normalise(str).split(' ').filter(w => w.length > 1 && !STOPWORDS.has(w)));

  // ── 1. Low-engagement filler ────────────────────────────────────────────────
  // Catches non-answers before the word-count check.
  const LOW_ENGAGEMENT = /^(i\s+don'?t\s+know|not\s+sure|not\s+really\s+sure|not\s+sure\s+about\s+this|no\s+idea|no\s+idea\s+at\s+all|no\s+clue|idk|idc|n\/a|yes|no|maybe|yeah|yep|nope|nah|ok|okay|sure|fine|true|false|dunno|duno|don'?t\s+know|tbh|tbd|tbc|t\.b\.c\.|todo|to\s+do|later|will\s+do|come\s+back\s+to\s+this|revisit|unsure|pass|skip|test|testing|asdf|qwerty|aaa+|xxx+|123+|--|[-?]|\?|\.{2,})\.?$/i;
  if (LOW_ENGAGEMENT.test(answer)) {
    return withHint(
      t('validation_lv_stuck_hint'),
      t('validation_lv_stuck_no_hint')
    );
  }

  // ── 2. Very short answer ────────────────────────────────────────────────────
  // Minimum words calibrated against sampleAnswer length if available.
  // shortAnswerThreshold (from data-short-answer-threshold on the card) overrides
  // the default when present. 0 = skip this check entirely for this question.
  const wordCount = answer.split(/\s+/).filter(Boolean).length;
  const minWords  = shortAnswerThreshold !== null
    ? parseInt(shortAnswerThreshold, 10)                         // author-supplied override
    : sampleAnswer
      ? Math.min(6, Math.round(sampleAnswer.split(/\s+/).filter(Boolean).length * 0.35))
      : 6;
  if (minWords > 0 && wordCount < minWords) {
    return withHint(
      t('validation_lv_too_short'),
      t('validation_lv_too_short')
    );
  }

  // ── 3. Answer repeats the question ─────────────────────────────────────────
  const normAnswer   = normalise(answer);
  const normQuestion = normalise(questionText);
  if (normQuestion.length > 20) {
    const qWords     = contentWords(normQuestion);
    const aWordList  = normAnswer.split(' ').filter(w => !STOPWORDS.has(w));
    const overlap    = aWordList.filter(w => qWords.has(w)).length;
    const ratio      = aWordList.length > 0 ? overlap / aWordList.length : 0;
    if (ratio > 0.70) {
      return withHint(
        t('validation_lv_repeats_question'),
        t('validation_lv_repeats_question')
      );
    }
  }

  // ── 4. Answer repeats the linked Bible passage ──────────────────────────────
  // Skipped when skipBibleVerseCheck is true (author has flagged that a direct
  // quote is the expected form of answer, e.g. "What does Paul say about X?").
  if (!skipBibleVerseCheck) {
    const refEl      = card && card.querySelector('.question-ref span[data-ref]');
    const passageRef = refEl ? refEl.dataset.ref : null;
    // Build the union of content words across all translations for this passage.
    // Multilingual studies store multiple translations in the translations array
    // (one per bibleTranslationN). Checking all of them means that pasting any
    // translation — not just the first — is correctly caught.
    const passageEntry   = passageRef && typeof verseData !== 'undefined' && verseData[passageRef];
    const translations   = passageEntry?.translations || [];
    const passageStrings = translations
      .map(tr => _stripHtml(tr.text || '')
        // Strip inline verse numbers (digits at a word boundary before text,
        // e.g. "21For" → "For", "22adultery" → "adultery").
        .replace(/\b\d+(?=[a-zA-Z])/g, ''))
      .filter(s => s.length > 20);

    if (passageStrings.length > 0) {
      // Union of content words from every translation
      const pWords    = new Set(passageStrings.flatMap(s => [...contentWords(s)]));
      const aWordList = normAnswer.split(' ').filter(w => w.length > 1 && !STOPWORDS.has(w));
      const overlap   = aWordList.filter(w => pWords.has(w)).length;

      // Direction 1: what fraction of the answer's content words are from the passage?
      // Catches answers that are mostly or entirely copied verse text.
      const ratioAnswer = aWordList.length > 0 ? overlap / aWordList.length : 0;

      // Direction 2: does the answer contain ANY content words not in ANY translation?
      // Catches a pure copy of any translation with no original contribution.
      const hasOriginalWords = aWordList.some(w => !pWords.has(w));

      if (ratioAnswer > 0.70 || !hasOriginalWords) {
        return withHint(
          t('validation_lv_repeats_passage'),
          t('validation_lv_repeats_passage')
        );
      }
    }
  }

  // ── 5. Thematic check against sampleAnswer (if present) ────────────────────
  //
  // This check is intentionally lenient. Its purpose is not to mark the answer
  // right or wrong, but to catch answers that are completely off-topic —
  // i.e. those that share no meaningful vocabulary with a model answer at all.
  //
  // Threshold is low (≥ 1 shared content word out of the sample's content words)
  // so that paraphrase, personal reflection, and creative expression all pass
  // without penalty. Only truly unrelated answers are flagged.
  if (sampleAnswer && sampleAnswer.trim().length > 10) {
    const sampleContentWords = contentWords(sampleAnswer);
    if (sampleContentWords.size >= 3) {
      const aWords    = contentWords(answer);
      const thematic  = [...aWords].filter(w => sampleContentWords.has(w)).length;
      if (thematic === 0) {
        return withHint(
          t('validation_lv_off_topic_hint'),
          t('validation_lv_off_topic_no_hint')
        );
      }
    }
    // ── 6a. Passes all checks including thematic ───────────────────────────────
    return t('validation_lv_pass_thematic');
  }

  // ── 6b. Passes all checks — no thematic check available ────────────────────
  return withHint(
    t('validation_lv_pass_no_sample_hint'),
    t('validation_lv_pass_no_sample_no_hint')
  );
}


// ═════════════════════════════════════════════════════════════════════════════
// SHARED UTILITIES
// ═════════════════════════════════════════════════════════════════════════════

function _stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').trim();
}

