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
//   LANGUAGE_MAP         – i18n.js
//   SUPPORTED_LANGUAGES  – i18n.js
//   renderLangBadge      – i18n.js
//   resolveLanguage      – i18n.js
//   applyLanguageToDom   – i18n.js
//   loadLocale           – app-init.js
//   ICONS                – icons.js
//   appSettings          – settings.js
//   chapters             – state.js
//   currentChapter       – state.js
//   answerFieldKey       – state.js
//   voiceInputAvailable  – voice.js
//   startVoiceInput      – voice.js
//   openNotesInfo        – modals.js
//   autoResize           – utils.js
//   saveAnswers          – save.js
//   printChapter         – share-print.js
//   shareAnswers         – share-print.js
//   goToChapter          – navigation.js
//   renderChapter        – render-chapter.js


// ── SESSION UI LANGUAGE OVERRIDE ──────────────────────────────────────────────
// When the user switches to a UI-supported study language via the chapter lang
// bar, we temporarily override the UI language for the session without touching
// the user's saved preference in localStorage.
//
// window._sessionUiLangOverride  – the lang code currently overriding the UI,
//                                  or null when no override is active.
//
// clearStudyUiLangOverride() is called at the top of every non-chapter page
// renderer (renderHowToUse, renderSettings, renderLeadersNotes, renderAbout,
// and openLibrary) so the user's real preference is restored the moment they
// leave the study.

async function clearStudyUiLangOverride() {
  if (!window._sessionUiLangOverride) return;
  window._sessionUiLangOverride = null;
  const realLang = resolveLanguage(); // reads the user's saved localStorage preference
  applyLanguageToDom(realLang);
  await loadLocale(realLang);
}


// ── LANGUAGE BAR ──────────────────────────────────────────────────────────────
// A sticky bar of flag/badge buttons, one per language present in the chapter.
// Mirrors the pattern of the library's renderLangBar (render-library.js).
//
// langs      – ordered array of language codes present in the chapter.
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

  const flagCounts = {};
  langs.forEach(code => {
    const f = LANGUAGE_MAP[code]?.flag;
    if (f) flagCounts[f] = (flagCounts[f] || 0) + 1;
  });

  const buttons = langs.map(code => {
    const entry = LANGUAGE_MAP[code];
    const label      = entry?.label || code.toUpperCase();
    const flagShared = entry && flagCounts[entry.flag] > 1;
    const display    = ((flagShared || entry?.alwaysBadge) && entry?.badge)
      ? renderLangBadge(entry)
      : (entry?.flag || '🌐');
    return `<button class="lib-lang-btn${activeLang === code ? ' active' : ''}"
                     onclick="setStudyLang('${code}')"
                     aria-label="${label}"
                     title="${label}">${display}</button>`;
  }).join('');

  bar.innerHTML = buttons;
}


// ── SET STUDY LANGUAGE ────────────────────────────────────────────────────────

async function setStudyLang(code) {
  window._activeStudyLang = code;

  if (SUPPORTED_LANGUAGES.includes(code)) {
    window._sessionUiLangOverride = code;
    applyLanguageToDom(code);
    await loadLocale(code);
  }

  renderChapter(currentChapter, window.scrollY);
}


// ── SAVE / SHARE BAR ──────────────────────────────────────────────────────────

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
// Always-present free-text area at the foot of every chapter.
//
// chapterAnswers – the pre-loaded IDB answer record for this chapter, fetched
//                  once by the orchestrator (render-chapter.js) and passed in.
//                  The notes value is stored under answerFieldKey('notes', 0).
//                  Defaults to {} when no answers exist yet.

function buildNotesField(ch, chapterAnswers) {
  const notesVal = escapeHtml((chapterAnswers || {})[answerFieldKey('notes', 0)] || '');

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
      ${voiceInputAvailable() ? `<button class="mic-btn" onclick="startVoiceInput(this)" aria-label="${t('renderchapter_answer_tools_mic_label')}" title="${t('renderchapter_answer_tools_mic_label')}">${ICONS.mic}</button>` : ''}
    </div>`;
}


// ── PREV / NEXT NAV BUTTONS ───────────────────────────────────────────────────

function buildNavButtons(idx, activeLang, langMap) {
  if (!appSettings.showNavButtons) return '';

  function resolveChapterTitle(ch) {
    if (langMap && Object.keys(langMap).length > 0) {
      const slot = langMap[activeLang];
      if (slot !== undefined) {
        return ch[`chapterTitle${slot}`] || ch[`chapterTitle1`] || ch.chapterTitle || '';
      }
      return ch[`chapterTitle1`] || ch.chapterTitle || '';
    }
    return ch.chapterTitle || '';
  }

  const showBack = idx > 0;
  const showNext = idx < chapters.length - 1;

  return `
    <div class="chapter-nav">
      ${showBack
        ? `<button class="chapter-nav-btn secondary" onclick="Router.navigate({ page: 'chapter', idx: ${idx - 1} })">← ${resolveChapterTitle(chapters[idx - 1])}</button>`
        : `<div style="flex:1"></div>`}
      ${showNext
        ? `<button class="chapter-nav-btn" onclick="Router.navigate({ page: 'chapter', idx: ${idx + 1} })">→ ${resolveChapterTitle(chapters[idx + 1])}</button>`
        : `<div style="flex:1"></div>`}
    </div>`;
}
