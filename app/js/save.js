// ── SAVE ──────────────────────────────────────────────────────────────────────
// Handles saving the current chapter's answers to IndexedDB.
// Dependent on the toast notification system in utils.js.
//
// Dependencies (all available as globals before this file loads):
//   appSettings              – settings.js
//   chapters, currentChapter – state.js
//   answerFieldKey, likertFieldKey – state.js
//   StudyIDB                 – idb.js
//   storageCache             – search.js (cleared on save so next search sees new answers)
//   updateProgress           – render-progress.js (runtime call only)
//   renderMenu               – render-progress.js (runtime call only)

// Saves all visible answer fields for the current chapter to IndexedDB as a
// single per-chapter object, clears the search cache so saved answers appear
// in future searches, shows the save toast, and refreshes the progress bar
// and menu checkmarks.
//
// Called by the Save button (isManual=true) and the auto-save blur handler
// (isManual=false). Returns a Promise — callers may await it but do not have
// to (HTML onclick handlers fire-and-forget safely).
async function saveAnswers(isManual = true) {
  const studyId = window.activeStudyId;
  const ch      = chapters[currentChapter];
  if (!studyId || !ch) return;

  // Read the existing chapter object first so we preserve any fields not
  // currently visible (e.g. from a different element type or a prior save).
  let record;
  try {
    record = await StudyIDB.getChapterAnswers(studyId, ch.chapterNumber);
  } catch (e) {
    console.warn('[saveAnswers] IDB read failed; falling back to empty object.', e);
    record = {};
  }

  // Overwrite only the fields that are visible in the DOM right now.
  const fields = document.querySelectorAll('.answer-field');
  fields.forEach(field => {
    const type  = field.dataset.type;
    const index = field.dataset.index;
    if (type !== undefined && index !== undefined) {
      record[answerFieldKey(type, index)] = field.value;
    }
  });

  try {
    await StudyIDB.setChapterAnswers(studyId, ch.chapterNumber, record);
  } catch (e) {
    console.warn('[saveAnswers] IDB write failed.', e);
  }

  // Clear the search cache so the next search sees the newly saved answers.
  if (typeof storageCache !== 'undefined') storageCache.clear();

  showToast({ isManual });
  updateProgress();
  renderMenu();
}

// ── BLUR/INPUT LISTENERS ──────────────────────────────────────────────────────
// Track progress as user types.
// Debounced at 200ms so querySelectorAll and the DOM write in updateProgress()
// run at most once per 200ms burst of keystrokes rather than on every character.
let _updateProgressTimer = null;
document.addEventListener('input', e => {
  if (e.target.classList.contains('answer-field')) {
    clearTimeout(_updateProgressTimer);
    _updateProgressTimer = setTimeout(updateProgress, 200);
  }
});

// Auto-save on blur (when the user taps away from an answer field).
// Saves only the single field that lost focus using a read-modify-write on the
// chapter's IDB record, then optionally shows the auto-save toast.
//
// The handler itself cannot be async (blur listeners are fire-and-forget), so
// we define an inner async function and call it immediately. The IDB write
// completes asynchronously; the UI toast fires after the await so it correctly
// reflects a completed save.
document.addEventListener('blur', e => {
  if (!e.target.classList.contains('answer-field')) return;

  const ch    = chapters[currentChapter];
  const type  = e.target.dataset.type;
  const index = e.target.dataset.index;
  const value = e.target.value;

  if (!ch || type === undefined || index === undefined) return;

  const studyId = window.activeStudyId;
  if (!studyId) return;

  // Fire-and-forget async save for the single field that lost focus.
  (async () => {
    let record;
    try {
      record = await StudyIDB.getChapterAnswers(studyId, ch.chapterNumber);
    } catch (e) {
      console.warn('[blur auto-save] IDB read failed; falling back to empty object.', e);
      record = {};
    }

    record[answerFieldKey(type, index)] = value;

    try {
      await StudyIDB.setChapterAnswers(studyId, ch.chapterNumber, record);
    } catch (e) {
      console.warn('[blur auto-save] IDB write failed.', e);
    }

    // Vital: clear the search cache so auto-saved text appears in searches.
    if (typeof storageCache !== 'undefined') storageCache.clear();

    if (appSettings.autoSaveToast) showToast({ isManual: false });

    // Note: We don't call updateProgress() or renderMenu() here
    // to keep auto-save lightweight on mobile.
  })();
}, true);  // { capture: true } required so blur events bubble up from textareas

// ── LIKERT SAVE ───────────────────────────────────────────────────────────────
// Saves a single Likert radio selection to IDB via a read-modify-write on the
// chapter's answer record. Called by the onchange handler on each .likert-radio
// input (rendered by renderLikertScale() in modals.js).
//
// elementId – the element's stable ID (el.elementId from the study JSON)
// stIdx     – zero-based statement index within the Likert scale
// value     – the selected radio value as a string (e.g. '3')
//
// Fire-and-forget async; no toast shown (consistent with other auto-saves when
// appSettings.autoSaveToast is false, and Likert changes are always silent).
async function saveLikertAnswer(elementId, stIdx, value) {
  const ch      = chapters[currentChapter];
  const studyId = window.activeStudyId;
  if (!ch || !studyId) return;

  let record;
  try {
    record = await StudyIDB.getChapterAnswers(studyId, ch.chapterNumber);
  } catch (e) {
    console.warn('[saveLikertAnswer] IDB read failed; falling back to empty object.', e);
    record = {};
  }

  record[likertFieldKey(elementId, stIdx)] = value;

  try {
    await StudyIDB.setChapterAnswers(studyId, ch.chapterNumber, record);
  } catch (e) {
    console.warn('[saveLikertAnswer] IDB write failed.', e);
  }

  if (typeof storageCache !== 'undefined') storageCache.clear();
  updateProgress();
}
