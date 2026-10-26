// ── RENDER CHAPTER UI ─────────────────────────────────────────────────────────
// Chrome elements that surround the chapter content: the print/share/recommend bar,
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
//   autoResize           – settings.js
//   debounce             – search.js
//   shareAppLink         – render-pages.js
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
  refreshChapterTextForLang();  // search/share/print/starred follow the new language

  if (SUPPORTED_LANGUAGES.includes(code)) {
    window._sessionUiLangOverride = code;
    applyLanguageToDom(code);
    await loadLocale(code);
  }

  renderChapter(currentChapter, window.scrollY);
}


// ── PRINT / SHARE / RECOMMEND BAR ─────────────────────────────────────────────
// Answers save themselves when the reader leaves a field, so the bar carries
// no Save button. Share sends this chapter's answers; Recommend sends a link
// to the app (the same message as the button on the How to Use page).
//
// Each button is an icon plus a word. In a language whose words are long, a
// label can wrap onto two lines at a narrow width, which makes all three
// buttons taller. fitSaveBar() (below) then drops the icons from the whole
// bar so the words get the room.

function buildSaveBar(ch) {
  const btn = (style, onclick, icon, label) => `
      <button class="save-btn"${style ? ` style="${style}"` : ''} onclick="${onclick}">
        <span class="save-btn-icon">${icon}</span><span class="save-btn-label">${label}</span>
      </button>`;
  return `
    <div class="save-bar">${
      btn('background:var(--text-secondary)', 'printChapter()', ICONS.print, t('renderchapter_print_btn'))}${
      btn('background:var(--success)', 'shareAnswers()', ICONS.share, t('renderchapter_share_btn'))}${
      btn('', 'shareAppLink()', ICONS.recommend, t('renderchapter_recommend_btn'))}
    </div>`;
}

// True when the text in a label breaks over more than one line.
function _saveBarLabelWraps(label) {
  const range = document.createRange();
  range.selectNodeContents(label);
  const tops = new Set(Array.from(range.getClientRects(), r => Math.round(r.top)));
  return tops.size > 1;
}

// Hides the icons (class "no-icons" on the bar) when any label wraps with the
// icons showing; shows them again when everything fits. Safe to call at any
// time: it does nothing when there is no bar on screen.
function fitSaveBar() {
  const bar = document.querySelector('.save-bar');
  if (!bar) return;
  bar.classList.remove('no-icons');
  const labels = Array.from(bar.querySelectorAll('.save-btn-label'));
  if (labels.some(_saveBarLabelWraps)) bar.classList.add('no-icons');
}

// The bar's width changes with the window (rotating the phone, split screen),
// and a web font arriving late changes the label widths, so fit again then.
window.addEventListener('resize', debounce(fitSaveBar, 150));
if (document.fonts) {
  document.fonts.ready.then(fitSaveBar);
  document.fonts.addEventListener('loadingdone', fitSaveBar);
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
        <button class="verse-btn" onclick="openNotesInfo()" aria-label="${t('renderchapter_notes_info_btn')}" title="${t('renderchapter_notes_info_btn')}">${ICONS.triggerInfo}</button>
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
    return resolveTextWithFallback(ch, activeLang, 'chapterTitle', langMap);
  }

  const showBack = idx > 0;
  const showNext = idx < chapters.length - 1;

  return `
    <div class="chapter-nav">
      ${showBack
        ? `<button class="chapter-nav-btn secondary" onclick="Router.navigate({ page: 'chapter', idx: ${idx - 1} })">← ${escapeHtml(resolveChapterTitle(chapters[idx - 1]))}</button>`
        : `<div style="flex:1"></div>`}
      ${showNext
        ? `<button class="chapter-nav-btn" onclick="Router.navigate({ page: 'chapter', idx: ${idx + 1} })">→ ${escapeHtml(resolveChapterTitle(chapters[idx + 1]))}</button>`
        : `<div style="flex:1"></div>`}
    </div>`;
}


// ── READ MORE (study chapter → appendix) ─────────────────────────────────────
// Optional full-width button after a study chapter's content that opens the
// matching Go Deeper ("appendix") chapter. Off by default:
//   • goDeeperData.readMoreButtons: true links every study chapter to the
//     appendix chapter with the same chapterNumber;
//   • per chapter, "readMore": false suppresses it, and
//     "readMore": { "chapter": N, "label": "…" } targets another appendix
//     chapter and/or sets the label — either key also turns the button on
//     for that chapter when the study-wide switch is off.
// Label: chapter's readMore.label → goDeeperData.readMoreLabel (both accept
// numbered language slots: label1/label2, readMoreLabel1/…) → the UI string.
// The second line is the appendix chapter's title, for the active language.
// No button if the target appendix chapter doesn't exist.
//
// The markup carries only the integer chapter number (data-goto-appendix).
// Before navigating, the reader's place is remembered in
// window._readMoreReturn so the appendix's "Back to study" button can return
// them there (the system Back button still goes to the Library).
function buildReadMoreButton(ch, activeLang, langMap) {
  const d = window.goDeeperData;
  if (!d || !Array.isArray(d.chapters) || ch.readMore === false) return '';
  const obj = ch.readMore && typeof ch.readMore === 'object' && !Array.isArray(ch.readMore) ? ch.readMore : null;
  if (!obj && d.readMoreButtons !== true) return '';
  const target = obj && Number.isInteger(obj.chapter) ? obj.chapter : ch.chapterNumber;
  const appendixCh = d.chapters.find(c => c.chapterNumber === target);
  if (!appendixCh || !Number.isInteger(target)) return '';
  const label = (obj && resolveTextWithFallback(obj, activeLang, 'label', langMap))
    || resolveTextWithFallback(d, activeLang, 'readMoreLabel', langMap)
    || t('renderchapter_read_more');
  const title = resolveTextWithFallback(appendixCh, activeLang, 'title', langMap);
  return `
    <button type="button" class="chapter-jump-btn read-more-btn" data-goto-appendix="${target}">
      <span class="chapter-jump-text">
        <span class="chapter-jump-label">${escapeHtml(label)}</span>
        ${title ? `<span class="chapter-jump-title">${escapeHtml(title)}</span>` : ''}
      </span>
      <span class="chapter-jump-icon" aria-hidden="true">${ICONS.arrowDown}</span>
    </button>`;
}

document.addEventListener('click', e => {
  const btn = e.target.closest && e.target.closest('[data-goto-appendix]');
  if (!btn) return;
  const n = parseInt(btn.dataset.gotoAppendix, 10);
  if (!Number.isInteger(n)) return;
  window._readMoreReturn = { studyId: window.activeStudyId, idx: currentChapter, scrollY: window.scrollY };
  Router.navigate({ page: 'godeeper', tabId: `ch_${n}` });
});
