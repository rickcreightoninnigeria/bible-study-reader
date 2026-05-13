// ── STATE ─────────────────────────────────────────────────────────────────────
// All mutable app-level state. Declared here so every other script can read
// and write these variables as plain globals. When we later move to ES modules
// these will become exports from this file.

// ── Font size constants ───────────────────────────────────────────────────────
window.FONT_MIN     = 14;
window.FONT_MAX     = 24;
window.FONT_DEFAULT = 16;
window.FONT_STEP    = 1;

// ── Study content — set by applyStudyData() ───────────────────────────────────
window.chapters          = [];
window.titlePageData     = null;
window.studyAboutData    = {};
window.howToUseData      = {};
window.leadersNotesData  = {};
window.copyrightData     = {};
window.verseData         = {};
window.qaCallouts        = [];
window.qaCalloutsById    = {};
window.studyMetadata     = {};
window.activeStudyId     = null;

// ── Navigation / UI ───────────────────────────────────────────────────────────
window.activeTabPage     = null;
window.activeTabId       = null;

// ── Library ───────────────────────────────────────────────────────────────────
window._libActiveTab     = null;
window._libTabs          = [];
window._libShowPaths     = 'few';

// ── Transient UI ──────────────────────────────────────────────────────────────
window._titleBeforeSearch = null;
window._titleBeforeMenu   = null;
window._ttsBtn            = null;
window._voiceTarget       = null;
window._voiceBtn          = null;
window._voiceRecogniser   = null;

// ── Boot sequencing ───────────────────────────────────────────────────────────
window._appReady       = false;
window.pendingStudyData = null;

// ── Local UI state (previously in main.js) ────────────────────────────────────
window.currentChapter       = 0;
window.menuOpen             = false;
window.isNonChapterPage     = false;
window.studyOnboardingSlides = [];

// ── Storage key helpers ───────────────────────────────────────────────────────
//
// ARCHITECTURE NOTE (Option C migration)
// ───────────────────────────────────────
// Answer data is now stored in IndexedDB (via StudyIDB) rather than
// localStorage. Each chapter's answers live in a single IDB record keyed by
//   `${studyId}_ch${chapterNum}`
// whose value is a plain object. The helpers below produce the *field names*
// used inside that object.
//
// answerFieldKey(type, index)         – field name for a question / reflection / notes cell
//   type  – 'q' (question answer), 'r' (reflection answer), 'notes' (chapter notes)
//   index – '{sIdx}_{qIdx}' for questions, rIdx for reflections, 0 for notes
//   e.g.  answerFieldKey('q', '1_2')  → 'q_1_2'
//         answerFieldKey('notes', 0)  → 'notes_0'
//
// likertFieldKey(elementId, stIdx)    – field name for a Likert statement answer
//   e.g.  likertFieldKey('el_42', 0)  → 'likert_el_42_0'
//
// celebratedFieldKey()                – field name for the chapter-completion flag
//   → 'celebrated'
//
// starFieldKey(elementId)             – field name for a starred-question flag
//   → 'star_{elementId}'
//
// For callers that still need to address the IDB record itself (not a field
// within it), use:
//   chapterAnswersIDBKey(studyId, chapterNum)  → `${studyId}_ch${chapterNum}`
//
// The legacy storageKey() and likertKey() functions are retained below as
// thin wrappers around the new helpers so that any call sites not yet
// migrated continue to work identically during the transition.

// ── New canonical field-key helpers ──────────────────────────────────────────

function answerFieldKey(type, index) {
  return `${type}_${index}`;
}

function likertFieldKey(elementId, stIdx) {
  return `likert_${elementId}_${stIdx}`;
}

function celebratedFieldKey() {
  return 'celebrated';
}

function starFieldKey(elementId) {
  return `star_${elementId}`;
}

// Returns the IDB answers-store key for a chapter's answer record.
function chapterAnswersIDBKey(studyId, chapterNum) {
  return `${studyId}_ch${chapterNum}`;
}

// ── Legacy wrappers (kept for backward compatibility during migration) ────────
// These return the same short field-name string that the new helpers produce,
// because the old full localStorage key format
//   bsr_{studyId}_ch{N}_{type}_{index}
// is no longer used. Call sites that were reading these strings as localStorage
// keys must be updated to use StudyIDB.getChapterAnswers() + answerFieldKey()
// instead. The wrappers are left here so that un-migrated call sites fail
// visibly (wrong key passed to localStorage.getItem returns null, the same as
// an empty answer) rather than crashing.
//
// TODO: Remove these once all call sites have been updated.

function storageKey(chapterNum, type, index) {
  const currentStudyId = window.activeStudyId;
  if (!currentStudyId) {
    console.warn('storageKey() called with no activeStudyId — falling back to "unknown". This should not happen; check bug #29.');
  }
  // Return just the field-name portion; callers expecting a full localStorage
  // key will receive a short string and produce null from localStorage.getItem,
  // which is the same as "no answer saved" — a safe degradation.
  return answerFieldKey(type, index);
}

function likertKey(chapterNum, elementId, stIdx) {
  const currentStudyId = window.activeStudyId;
  if (!currentStudyId) {
    console.warn('likertKey() called with no activeStudyId — falling back to "unknown". This should not happen; check bug #29.');
  }
  return likertFieldKey(elementId, stIdx);
}
