// ── RENDER CHAPTER UI ─────────────────────────────────────────────────────────
// Chrome elements that surround the chapter content: the save/share bar,
// the notes free-text field, the prev/next navigation buttons, and the
// sticky language switcher bar.
//
// buildSaveBar, buildNotesField, buildNavButtons return HTML strings and are
// free of side-effects. They are called by the orchestrator (render-chapter.js)
// and their output is included in the single contentHtml string written to
// innerHTML.
//
// buildLangBar and setStudyLang work differently — buildLangBar directly
// manipulates a persistent DOM element (#chapterLangBar) that is created
// once by the orchestrator and lives outside the contentHtml flow so that
// it can be genuinely sticky (position: sticky, top: 0) above the scrolling
// chapter content.
//
// Globals used (must be loaded before this file):
//   t()                  – i18n.js
//   ICONS                – icons.js
//   appSettings          – settings.js
//   chapters             – main.js STATE section
//   currentChapter       – main.js STATE section
//   storageKey           – main.js STATE section
//   voiceInputAvailable  – voice.js
//   startVoiceInput      – voice.js
//   openNotesInfo        – modals.js
//   autoResize           – utils.js
//   saveAnswers          – save.js
//   printChapter         – share-print.js
//   shareAnswers         – share-print.js
//   goToChapter          – main.js
//   renderChapter        – render-chapter.js
//   LANGUAGE_MAP         – render-pages.js
//   renderLangBadge      – render-pages.js


// ── LANGUAGE BAR ──────────────────────────────────────────────────────────────
// A sticky bar of flag/badge buttons, one per language present in the chapter.
// Mirrors the pattern of the library's renderLangBar (render-library.js).
//
// The bar element (#chapterLangBar) is created once by the orchestrator in
// render-chapter.js immediately after container.innerHTML = ''. This function
// populates (or repopulates) that element's innerHTML on each render.
//
// If only one language is present the bar is hidden; the DOM node remains so
// it can be shown immediately on the next render without a layout recalculation.
//
// langs      – ordered array of language codes present in the chapter
//              (e.g. ['ha', 'en']). Derived by detectAvailableLangs() in
//              render-chapter.js.
// activeLang – the currently selected language code.

function buildLangBar(langs, activeLang) {
  const bar  = document.getElementById('chapterLangBar');
  const page = bar && bar.closest('.chapter-page');
  if (!bar) return;

  if (langs.length < 2) {
    bar.style.display = 'none';
    if (page) page.classList.remove('chapter-page--with-lang-bar');
    return;
  }

  bar.style.display = 'flex';
  if (page) page.classList.add('chapter-page--with-lang-bar');

  // Determine which flag emojis appear more than once among the present langs.
  // When two or more present languages share a flag, use their badges instead
  // so the user can tell them apart. Mirrors the library's renderLangBar logic.
  const flagCounts = {};
  langs.forEach(code => {
    const f = LANGUAGE_MAP[code]?.flag;
    if (f) flagCounts[f] = (flagCounts[f] || 0) + 1;
  });

  const buttons = langs.map(code => {
    const entry = LANGUAGE_MAP[code];
    // Graceful fallback for language codes not yet in LANGUAGE_MAP.
    const label      = entry?.label || code.toUpperCase();
    const flagShared = entry && flagCounts[entry.flag] > 1;
    const display    = (flagShared && entry?.badge)
      ? renderLangBadge(entry)   // badge: distinguishes same-flag languages
      : (entry?.flag || '🌐');   // flag: unambiguous when alone or no badge
    return `<button class="lib-lang-btn${activeLang === code ? ' active' : ''}"
                     onclick="setStudyLang('${code}')"
                     aria-label="${label}"
                     title="${label}">${display}</button>`;
  }).join('');

  bar.innerHTML = buttons;
}


// ── SET STUDY LANGUAGE ────────────────────────────────────────────────────────
// Called by the chapter lang bar buttons. Updates the session preference and
// re-renders the current chapter at the current scroll position so all
// language-keyed text updates in one pass.
//
// window._activeStudyLang is session-only (not persisted to localStorage).
// On a fresh load it will be undefined, and the orchestrator defaults to the
// first language found in the chapter data.

function setStudyLang(code) {
  window._activeStudyLang = code;
  renderChapter(currentChapter, window.scrollY);
}


// ── SAVE / SHARE BAR ──────────────────────────────────────────────────────────
// Fixed bar at the bottom of the chapter with Save, Print, and Share buttons.

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
