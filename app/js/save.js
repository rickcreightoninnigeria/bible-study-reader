// ── SAVE ──────────────────────────────────────────────────────────────────────
// Handles saving the current chapter's answers to localStorage
// is dependent on the toast notification system in utils.js
//
// Dependencies (all available as globals before this file loads):
//   appSettings   – settings.js
//   chapters, currentChapter – main.js STATE section
//   storageKey    – main.js STATE section
//   storageCache  – search.js (cleared on save so next search sees new answers)
//   updateProgress, renderMenu – main.js (runtime calls only)

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
