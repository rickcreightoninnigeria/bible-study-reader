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
window.goDeeperData      = null;
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
// celebratedIDBKey(studyId, chapterNum) – standalone IDB key for the chapter-completion flag
//   Stored as a separate answers-store entry (not inside the chapter record) so
//   it cannot be overwritten by saveAnswers() read-modify-write cycles.
//   → `${studyId}_celebrated_ch${chapterNum}`
//
// starFieldKey(elementId)             – field name for a starred-question flag
//   → 'star_{elementId}'
//
// For callers that still need to address the IDB record itself (not a field
// within it), use:
//   chapterAnswersIDBKey(studyId, chapterNum)  → `${studyId}_ch${chapterNum}`
//
// ── New canonical field-key helpers ──────────────────────────────────────────

function answerFieldKey(type, index) {
  return `${type}_${index}`;
}

function likertFieldKey(elementId, stIdx) {
  return `likert_${elementId}_${stIdx}`;
}

function celebratedIDBKey(studyId, chapterNum) {
  return `${studyId}_celebrated_ch${chapterNum}`;
}

function starFieldKey(elementId) {
  return `star_${elementId}`;
}

// Returns the IDB answers-store key for a chapter's answer record.
function chapterAnswersIDBKey(studyId, chapterNum) {
  return `${studyId}_ch${chapterNum}`;
}

