// ── SAVE ──────────────────────────────────────────────────────────────────────
// Handles saving the current chapter's answers to localStorage
// is dependent on the toast notification system in utils.js
//
// Dependencies (all available as globals before this file loads):
//   appSettings   – settings.js
//   chapters, currentChapter – main.js STATE section
//   storageKey    – main.js STATE section
//   storageCache  – search.js (cleared on save so next search sees new answers)
//   updateProgress  – render-progress.js (runtime call only)
//   renderMenu      – render-progress.js (runtime call only)

// Saves all visible answer fields for the current chapter to localStorage,
// clears the search cache so saved answers appear in future searches,
// shows the save toast, and refreshes the progress bar and menu checkmarks.
// Called by the Save button (isManual=true) and the auto-save blur handler (isManual=false).
function saveAnswers(isManual = true) {
  const ch = chapters[currentChapter];
  const fields = document.querySelectorAll('.answer-field');
  fields.forEach(field => {
    const type  = field.dataset.type;
    const index = field.dataset.index;
    localStorage.setItem(storageKey(ch.chapterNumber, type, index), field.value);
  });

  // Clear the search cache so the next search sees the newly saved answers
  storageCache.clear();

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
// Saves only the single field that lost focus, then optionally shows the
// auto-save toast if that setting is enabled.
document.addEventListener('blur', e => {
  if (e.target.classList.contains('answer-field')) {
    const ch = chapters[currentChapter];
    const type = e.target.dataset.type;
    const index = e.target.dataset.index;
    if (type && index !== undefined) {
      localStorage.setItem(storageKey(ch.chapterNumber, type, index), e.target.value);

      // Vital: Clear the search cache so 'Auto-saved' text appears in searches.
      if (typeof storageCache !== 'undefined') storageCache.clear();

      if (appSettings.autoSaveToast) showToast({ isManual: false });
      
      // Note: We don't call updateProgress() or renderMenu() here 
      // to keep auto-save lightweight on mobile.
    }
  }
}, true);  // { capture: true } required so blur events bubble up from textareas
