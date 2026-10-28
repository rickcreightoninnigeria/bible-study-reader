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
//   • Always visible on eligible cards
//   • Disabled when the answer field is empty
//   • Hidden on non-bible question subtypes (reflection, deeper, etc.)
//
// The matching itself lives in answer-match.js (pure text logic, no DOM). This
// file only gathers the inputs, maps result codes to translated messages, and
// wires the buttons.
//
// Per-question study fields, all optional and read from the question ELEMENT
// (looked up by the card's id), not from data-* attributes — so model answers
// no longer sit in the page markup, and study text never becomes an attribute:
//   sampleAnswer, questionHint   numbered in multilingual studies
//   keyTerms                     array of "alt|alt|prefix$" strings (see answer-match.js)
//   mainPoint, mainPointFormat   shown on demand by the Main point button (modals.js)
//   shortAnswerThreshold         minimum words; 0 turns the check off
//   skipBibleVerseCheck          true skips the "repeats the passage" check
//
// ── SHARED DEPENDENCIES (globals) ────────────────────────────────────────────
//   ICONS, showToast, chapters, currentChapter, verseData, studyText,
//   buildLangMap, getActiveLang, detectAvailableLangs,
//   answer-match.js (evaluateAnswer)
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
// Triggered by a dedicated icon in the answer-action-row. Results appear in a
// short-lived toast only; nothing is persisted or appended to the answer.
//
// Question subtypes that local validate handles: standard, and any question
// with a linked passage (see localValidateEligible). Reflection and deeper
// questions are personal or devotional, so they get no check.
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
  '.local-validate-btn, .main-point-btn, .verse-trans-btn, .star-btn';

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
function _localValidateShowFeedback(card, detail) {
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const toast = document.getElementById('validate-toast');
  if (toast) {
    toast.classList.remove('lv-red', 'lv-amber', 'lv-green');
    const level = _lvLevelFor(detail.code).level;
    if (level) toast.classList.add('lv-' + level);
  }
  // resetText '' : this toast has no default text to restore (it used to inherit
  // "✓ Answers saved", which could replace the feedback while it was showing).
  showToast({ message: _lvToastHtml(detail), isHtml: true, duration: _LV_TOAST_MS,
              elementId: 'validate-toast', isManual: true, resetText: '' });
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

  const detail = _lvDetailFor(card, answer);
  if (detail === null) return;

  // detail is always non-null here (either a problem message or a positive
  // confirmation). Scroll card to centre first so the toast never covers the
  // answer field, then display.
  _localValidateShowFeedback(card, detail);
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

    const detail = _lvDetailFor(card, answer);
    if (detail !== null) _localValidateShowFeedback(card, detail);
  }, 120);
}

// ── Inputs: the question element, looked up by the card's id ───────────────────
// The study fields are read from the element itself rather than from data-*
// attributes on the card. The card's id is the element's elementId (for a
// repeatElement card it is the source element's id, which is the one found
// here, since repeat entries are skipped in the first pass).
function _lvQuestionElement(card) {
  const id = card && card.id;
  if (!id || typeof chapters === 'undefined') return null;
  const ch = chapters[typeof currentChapter === 'number' ? currentChapter : 0];
  const list = ch && Array.isArray(ch.elements) ? ch.elements : [];
  return list.find(e => e && e.elementId === id && !e.repeatElement)
      || list.find(e => e && e.elementId === id)
      || null;
}

// The language used for matching: the active study language, else the study's
// declared language, else English (the behaviour before this was configurable).
function _lvLang() {
  try {
    const active = getActiveLang(detectAvailableLangs());
    if (active) return active;
  } catch (e) { /* fall through */ }
  const declared = window.studyMetadata && window.studyMetadata.language;
  return typeof declared === 'string' && declared ? declared : 'en';
}

// A numeric field (shortAnswerThreshold) can legitimately be 0, which
// resolveText()'s "empty means missing" rule would drop, so it is resolved here
// with explicit undefined/null/'' tests: active slot → slot 1 → unnumbered.
function _lvNumberField(el, field) {
  let slot;
  try { slot = buildLangMap(window.studyMetadata || {})[_lvLang()]; } catch (e) { slot = undefined; }
  const candidates = slot !== undefined ? [el[field + slot], el[field + '1'], el[field]] : [el[field]];
  for (const v of candidates) {
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  }
  return null;
}

function _lvStringField(el, field) {
  const v = studyText(el, field);
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

// Everything the check needs for one card. Never throws: a missing element or
// a hostile field just yields empty values.
function _lvQuestionConfig(card) {
  const cfg = { questionText: '', sampleAnswer: null, questionHint: null, keyTerms: null,
                hasMainPoint: false, shortAnswerThreshold: null, skipBibleVerseCheck: false, lang: 'en' };
  try {
    cfg.questionText = _getQuestionText(card);
    cfg.lang = _lvLang();
    const el = _lvQuestionElement(card);
    if (!el) return cfg;
    cfg.sampleAnswer  = _lvStringField(el, 'sampleAnswer');
    cfg.questionHint  = _lvStringField(el, 'questionHint');
    const kt = studyText(el, 'keyTerms');
    cfg.keyTerms      = Array.isArray(kt) ? kt : null;
    cfg.hasMainPoint  = _lvStringField(el, 'mainPoint') !== null;
    cfg.shortAnswerThreshold = _lvNumberField(el, 'shortAnswerThreshold');
    cfg.skipBibleVerseCheck  = el.skipBibleVerseCheck === true || el.skipBibleVerseCheck === 'true';
  } catch (e) {
    console.warn('[localValidate] could not read the question fields', e);
  }
  return cfg;
}

// The feedback for one card as { code, text, steps, message }, or null if
// something unexpected went wrong (a failed check must never break typing or
// saving). `message` is the same feedback as one plain string.
function _lvDetailFor(card, answer) {
  try {
    const c = _lvQuestionConfig(card);
    return _localValidateDetail(answer, c.questionText, card, c.sampleAnswer, c.questionHint,
      c.shortAnswerThreshold, c.skipBibleVerseCheck,
      { keyTerms: c.keyTerms, hasMainPoint: c.hasMainPoint, lang: c.lang });
  } catch (e) {
    console.warn('[localValidate] check failed', e);
    return null;
  }
}

// Just the plain-text message (or null).
function _lvFeedbackFor(card, answer) {
  const d = _lvDetailFor(card, answer);
  return d === null ? null : d.message;
}

// Plain text of one passage translation, for the "repeats the passage" check.
//   • [[sc:Text]] (the small-capitals divine name) becomes Text, so
//     "[[sc:Lord]]’s" reads as "Lord’s", the way an answer will write it;
//   • a verse number in <sup> is dropped;
//   • every other tag becomes a space, so poetry lines ("livestock<br>and")
//     stay two words instead of gluing into "livestockand";
//   • entities are decoded, a verse number stuck to a word ("21For") is
//     removed, and runs of spaces collapse.
function _lvPlainPassage(raw) {
  const spaced = String(raw)
    .replace(/\[\[sc:(.*?)\]\]/g, '$1')
    .replace(/<sup\b[^>]*>\s*\d+[a-z]?\s*<\/sup>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/</g, '&lt;');            // a stray "<" is text, never markup, when _stripHtml parses it
  return _stripHtml(spaced)
    .replace(/\b\d+(?=[a-zA-Z])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Plain-text versions of the linked passage in every translation.
function _lvPassageTexts(card) {
  const refEl      = card && card.querySelector('.question-ref span[data-ref]');
  const passageRef = refEl ? refEl.dataset.ref : null;
  const entry      = passageRef && typeof verseData !== 'undefined' && verseData[passageRef];
  const translations = entry && Array.isArray(entry.translations) ? entry.translations : [];
  return translations
    .map(tr => _lvPlainPassage((tr && tr.text) || ''))
    .filter(s => s.length > 20);
}

// ── Core validation logic ─────────────────────────────────────────────────────
//
// Returns a feedback string in all cases — never null.
// Callers decide how to display it (toast, thread, etc.).
//
// The checks run in answer-match.js (evaluateAnswer); this maps its result code
// to a translated message and appends the questionHint where it always did.
//
// Parameters:
//   userAnswer           — the raw answer text from the textarea
//   questionText         — the question text (plain, from DOM)
//   card                 — the .question-card element (for passage lookup)
//   sampleAnswer         — optional model answer string
//   questionHint         — optional hint string
//   shortAnswerThreshold — optional minimum word count (number or numeric
//                          string; 0 disables the check; null = built-in default)
//   skipBibleVerseCheck  — true skips the "repeats the passage" check
//   extra                — optional { keyTerms, hasMainPoint, lang }
function _localValidate(...args) {
  return _localValidateDetail(...args).message;
}

function _localValidateDetail(userAnswer, questionText, card, sampleAnswer, questionHint, shortAnswerThreshold, skipBibleVerseCheck = false, extra = {}) {
  const opts = extra && typeof extra === 'object' ? extra : {};
  const { code } = evaluateAnswer({
    answer: userAnswer,
    questionText,
    passageTexts: skipBibleVerseCheck ? [] : _lvPassageTexts(card),
    sampleAnswer,
    keyTerms: opts.keyTerms,
    shortAnswerThreshold,
    skipBibleVerseCheck,
    lang: opts.lang,
  });
  return _lvDetailForCode(code, questionHint, !!opts.hasMainPoint);
}

// How long the feedback toast stays up. A partial answer now gets a short list
// of steps, which takes longer to read.
const _LV_TOAST_MS = 12000;

// Result code → traffic-light level and face. Red: a long way off (just repeating
// the question or the passage). Amber: getting closer, or heading a different way.
// Green: good. No level (the toast keeps its usual teal) when the check could not
// tell: "passes basic checks, no thematic data".
const _LV_LEVELS = {
  repeatsQuestion: { level: 'red',   face: '😕' },
  repeatsPassage:  { level: 'red',   face: '😕' },
  offTopic:        { level: 'amber', face: '😶' },
  tooShort:        { level: 'amber', face: '😐' },
  stuck:           { level: 'amber', face: '😐' },
  partial:         { level: 'amber', face: '😐' },
  strong:          { level: 'green', face: '😀' },
  pass:            { level: 'green', face: '😀' },
};
function _lvLevelFor(code) {
  return Object.prototype.hasOwnProperty.call(_LV_LEVELS, code) ? _LV_LEVELS[code] : { level: null, face: '' };
}

// Result code → { code, text, steps, message }. `text` is the message, `steps` an
// optional list of things to do (shown as a numbered list), `message` the two
// joined as plain text. Appends the hint after the message when there is one
// (the "stuck" and "off topic" messages have wording of their own for that
// case). Messages that could be read as praise point to the Main point button
// when the question has one; a partial answer gets a short list of steps, the
// last of which is that pointer.
function _lvDetailForCode(code, hint, hasMainPoint) {
  const hintItems = _lvHintItems(hint);
  if (!hintItems.length) hint = null;            // nothing readable in it: treat as no hint
  // With a hint, the message is shown on its own and the hint below it as a
  // bulleted list (see _lvToastHtml); `message` keeps the older one-string form.
  // So every lead-in used with a hint (the *_hint strings) ends with a colon,
  // ready for the list. The no-hint strings end as sentences.
  const withHint = (withKey, withoutKey) => hint ? t(withKey) : t(withoutKey);
  const pointer = hasMainPoint ? ' ' + t('validation_lv_see_main_point') : '';
  let text, steps = [];
  switch (code) {
    case 'stuck':           text = withHint('validation_lv_stuck_hint', 'validation_lv_stuck_no_hint'); break;
    case 'tooShort':        text = withHint('validation_lv_too_short_hint', 'validation_lv_too_short'); break;
    case 'repeatsQuestion': text = withHint('validation_lv_repeats_question_hint', 'validation_lv_repeats_question'); break;
    case 'repeatsPassage':  text = withHint('validation_lv_repeats_passage_hint', 'validation_lv_repeats_passage'); break;
    case 'offTopic':        text = withHint('validation_lv_off_topic_hint', 'validation_lv_off_topic_no_hint'); break;
    case 'partial':
      text = t('validation_lv_partial');
      steps = [t('validation_lv_partial_step1'), t('validation_lv_partial_step2')];
      if (hasMainPoint) steps.push(t('validation_lv_partial_step3'));
      break;
    case 'strong':          text = t('validation_lv_strong') + pointer; break;
    case 'pass':            text = t('validation_lv_pass_thematic') + pointer; break;
    default:                text = withHint('validation_lv_pass_no_sample_hint', 'validation_lv_pass_no_sample_no_hint');
  }
  const showItems = hint && !['partial', 'strong', 'pass'].includes(code) ? hintItems : [];
  const flatText = showItems.length ? text + ' ' + hint : text;
  const message = [flatText, ...steps.map((s, i) => `${i + 1}. ${s}`)].join('\n');
  return { code, text, steps, hintItems: showItems, message };
}

// A hint written on several lines (a "\n" between points) is shown as a
// bulleted list, one bullet per line; a one-line hint is a list of one. A leading
// "-", "*", "•" or "1." on a line is dropped, since the bullet replaces it.
function _lvHintItems(hint) {
  if (typeof hint !== 'string') return [];
  return hint.split(/\r?\n/)
    .map(s => s.replace(/^\s*(?:[-*•·]|\d{1,2}[.)])(?:\s+|$)/, '').trim())
    .filter(Boolean);
}

// The toast's HTML. Everything from the study (the hint) is escaped; the face
// and the numbered list are built here. [[icon:mainPoint]] in a message is drawn
// as the Main point button's lightbulb, or as 💡 if that icon is not available.
function _lvToastHtml(detail) {
  const icon = (typeof ICONS !== 'undefined' && ICONS && ICONS.mainPoint) ? '[[icon:mainPoint]]' : '💡';
  const fix = s => escapeHtml(s).replace(/\[\[icon:mainPoint\]\]/g, icon);
  const steps = detail.steps && detail.steps.length
    ? `<ol class="lv-steps">${detail.steps.map(s => `<li>${fix(s)}</li>`).join('')}</ol>` : '';
  const hints = detail.hintItems && detail.hintItems.length
    ? `<ul class="lv-hints">${detail.hintItems.map(s => `<li>${fix(s)}</li>`).join('')}</ul>` : '';
  const face = _lvLevelFor(detail.code).face;
  const faceHtml = face ? `<span class="lv-face" aria-hidden="true">${face}</span>` : '';
  const body = `<div class="lv-text">${fix(detail.text)}${hints}${steps}</div>`;
  const html = faceHtml ? `<div class="lv-toast">${faceHtml}${body}</div>` : body;
  return typeof expandInlineMarkers === 'function' ? expandInlineMarkers(html) : html;
}

// Wires the local-validate and Main point buttons after a chapter renders:
// removes them from cards that are not eligible, and enables or disables them as
// the answer field fills or empties.
function wireLocalValidateCards(container) {
  container.querySelectorAll('.question-card').forEach(card => {
    const lvBtn = card.querySelector('.local-validate-btn');
    const mpBtn = card.querySelector('.main-point-btn');
    if (!lvBtn) { if (mpBtn) mpBtn.remove(); return; }
    if (!localValidateEligible(card)) {
      lvBtn.remove();
      if (mpBtn) mpBtn.remove();
      return;
    }
    const textarea = card.querySelector('.answer-field');
    if (textarea) {
      textarea.addEventListener('input', () => {
        const empty = !textarea.value.trim();
        lvBtn.disabled = empty;
        if (mpBtn) mpBtn.disabled = empty;
      });
    }
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// SHARED UTILITIES
// ═════════════════════════════════════════════════════════════════════════════

function _stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').trim();
}

