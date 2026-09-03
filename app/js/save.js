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

  // Collect the visible answer fields that actually contain something.
  // Blank fields are skipped rather than stomping the record with an empty
  // string — same rationale as the blur auto-save below: clearing a field's
  // stored answer should be a deliberate action, not a side effect of an
  // empty field being present on screen when Save is tapped.
  const fields = Array.from(document.querySelectorAll('.answer-field')).filter(
    field => field.dataset.type !== undefined && field.dataset.index !== undefined && field.value.trim() !== ''
  );

  // Nothing to save — skip the read/write and the toast entirely.
  if (fields.length === 0) return;

  try {
    await StudyIDB.updateChapterAnswers(studyId, ch.chapterNumber, record => {
      fields.forEach(field => {
        record[answerFieldKey(field.dataset.type, field.dataset.index)] = field.value;
      });
    }, 'saveAnswers');
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

  // Blur caused by tapping an in-card control (verse ref, info icon, mic,
  // etc.) rather than actually leaving the answer — skip the save entirely.
  // The flag is set in validation.js (shared with localValidateAutoTrigger's
  // own check on this same blur) and self-clears after 500ms; the current
  // in-progress text simply stays unsaved in the field until a genuine blur,
  // the manual Save button, or the visibilitychange/pagehide flush below.
  if (typeof _lvSuppressNext !== 'undefined' && _lvSuppressNext) return;

  const ch    = chapters[currentChapter];
  const type  = e.target.dataset.type;
  const index = e.target.dataset.index;
  const value = e.target.value;

  if (!ch || type === undefined || index === undefined) return;

  const studyId = window.activeStudyId;
  if (!studyId) return;

  // Skip entirely if the field is blank — nothing to persist, and the
  // auto-save toast shouldn't fire just because the user tapped into and
  // back out of an empty field. This intentionally does not clear an
  // existing saved value: blurring a blank field is trivially different
  // from deliberately erasing previously-saved text, and this way idle
  // tapping around empty fields never triggers a write or a toast.
  if (value.trim() === '') return;

  // Fire-and-forget async save for the single field that lost focus.
  (async () => {
    try {
      await StudyIDB.updateChapterAnswers(studyId, ch.chapterNumber, record => {
        record[answerFieldKey(type, index)] = value;
      }, 'blur auto-save');
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
async function saveLikertAnswer(elementId, stIdx, value, chapterNumber) {
  // chapterNumber is passed in from the onchange attribute at render time,
  // so it always refers to the chapter the element was rendered for —
  // not whatever currentChapter happens to be at async execution time.
  const studyId = window.activeStudyId;
  if (chapterNumber == null || !studyId) return;

  try {
    await StudyIDB.updateChapterAnswers(studyId, chapterNumber, record => {
      record[likertFieldKey(elementId, stIdx)] = value;
    }, 'saveLikertAnswer');
  } catch (e) {
    console.warn('[saveLikertAnswer] IDB write failed.', e);
  }

  if (typeof storageCache !== 'undefined') storageCache.clear();
  updateProgress();
}
