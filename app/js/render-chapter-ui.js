// ── RENDER CHAPTER UI ─────────────────────────────────────────────────────────
// Chrome elements that surround the chapter content: the save/share bar,
// the notes free-text field, and the prev/next navigation buttons.
//
// All three functions return an HTML string and are free of side-effects.
// They are called by the orchestrator (render-chapter.js) and their output
// is included in the single contentHtml string that is written to innerHTML.
//
// buildSaveBar() is the intended insertion point for buildLangBar() when that
// feature is added — both are fixed-position UI chrome attached to the chapter.
//
// Globals used (must be loaded before this file):
//   t()                  – i18n.js
//   ICONS                – icons.js
//   appSettings          – settings.js
//   chapters             – main.js STATE section
//   storageKey           – main.js STATE section
//   voiceInputAvailable  – voice.js
//   startVoiceInput      – voice.js
//   openNotesInfo        – modals.js
//   autoResize           – utils.js
//   saveAnswers          – save.js
//   printChapter         – share-print.js
//   shareAnswers         – share-print.js
//   goToChapter          – main.js


// ── SAVE / SHARE BAR ──────────────────────────────────────────────────────────
// Fixed bar at the bottom of the chapter with Save, Print, and Share buttons.
// ch is accepted as a parameter in anticipation of buildLangBar(), which will
// likely need chapter context when implemented.

function buildSaveBar(ch) {
  return `
    <div class="save-bar">
      <button class="save-btn" onclick="saveAnswers()">
        ${ICONS.save} ${t('renderchapter_save_btn')}
      </button>
      <button class="save-btn" style="background:var(--text-secondary)" onclick="printChapter()">
        ${ICONS.print} ${t('renderchapter_print_btn')}
      </button>
      <button class="save-btn" style="background:var(--success)" onclick="shareAnswers()">
        ${ICONS.share} ${t('renderchapter_share_btn')}
      </button>
    </div>`;
}


// ── NOTES FIELD ───────────────────────────────────────────────────────────────
// Always-present free-text area at the foot of every chapter, preceded by a
// section-break divider. Value is loaded from localStorage on render.

function buildNotesField(ch) {
  const notesKey = storageKey(ch.chapterNumber, 'notes', 0);
  const notesVal = localStorage.getItem(notesKey) || '';

  return `
    <div class="section-break section-break-spaced">
      <div class="section-break-line"></div>
      <div class="section-break-text">${t('renderchapter_notes_section_label')}</div>
      <div class="section-break-line"></div>
    </div>
    <div class="question-card">
      <div class="question-ref question-ref-split">
        <span>${t('renderchapter_notes_heading')}</span>
        <button class="verse-btn" onclick="openNotesInfo()">${ICONS.triggerInfo}</button>
      </div>
      <textarea class="answer-field"
        data-type="notes"
        data-index="0"
        placeholder="${t('renderchapter_notes_placeholder')}"
        oninput="autoResize(this)"
      >${notesVal}</textarea>
      ${voiceInputAvailable() ? `<button class="mic-btn" onclick="startVoiceInput(this)">${ICONS.mic}</button>` : ''}
    </div>`;
}


// ── PREV / NEXT NAV BUTTONS ───────────────────────────────────────────────────
// Rendered only when appSettings.showNavButtons is true.
// Uses a flex spacer div when a direction is unavailable so the remaining
// button stays correctly aligned.

function buildNavButtons(idx) {
  if (!appSettings.showNavButtons) return '';

  const showBack = idx > 0;
  const showNext = idx < chapters.length - 1;

  return `
    <div class="chapter-nav">
      ${showBack
        ? `<button class="chapter-nav-btn secondary" onclick="goToChapter(${idx - 1})">← ${chapters[idx - 1].chapterTitle}</button>`
        : `<div style="flex:1"></div>`}
      ${showNext
        ? `<button class="chapter-nav-btn" onclick="goToChapter(${idx + 1})">→ ${chapters[idx + 1].chapterTitle}</button>`
        : `<div style="flex:1"></div>`}
    </div>`;
}
