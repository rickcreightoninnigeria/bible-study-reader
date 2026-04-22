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

// ── Storage Key helpers ───────────────────────────────────────────────────────
// Returns the localStorage key for a given answer field.
// Format: bsr_ch{N}_{type}_{index}
//   type  – 'q' (question), 'r' (reflection), 'notes'
//   index – 'sIdx_qIdx' for questions, rIdx for reflections, 0 for notes
// The 'bsr_' prefix namespaces all app keys so they can be bulk-deleted safely.
function storageKey(chapterNum, type, index) {
  const currentStudyId = window.activeStudyId;
  return `bsr_${currentStudyId}_ch${chapterNum}_${type}_${index}`;
}

// Returns the localStorage key for a single Likert statement answer.
// keyed by the scale's elementId and statement index, so it remains
// stable regardless of where the element sits in the chapter's element list.
function likertKey(chapterNum, elementId, stIdx) {
  const currentStudyId = window.activeStudyId || 'mmdd';
  return `bsr_${currentStudyId}_ch${chapterNum}_likert_${elementId}_${stIdx}`;
}
