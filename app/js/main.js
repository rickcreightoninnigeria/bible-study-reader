// ── RENDER ───────────────────────────────────────────────────────────────────
// This is where all the Render Functions live.

// RENDER MENU
// Rebuilds the chapter menu list with current progress checkmarks.
// A ✓ checkmark is shown if the first question of a chapter has a saved answer.
// NOTE: this check only tests question 0_0; a chapter where Q1 is unanswered
// but others are answered will not show a checkmark. Consider using getChapterProgress().
//
// Multilingual studies: the menu heading shortTitle and each chapter title are
// resolved for the active study language. The Contents overlay carries no lang
// bar — it silently follows window._activeStudyLang.

// Toggles the ✓ checkmark on the Notes item in the chapter menu without
// rebuilding the entire menu. Called from the globalNotesField oninput handler
// in render-progress.js as a cheap alternative to renderMenu().
// Guards against the item being absent (showPageNotes off, or menu not open).
function updateNotesMenuIndicator(hasContent) {
  const item = document.getElementById('menuItemNotes');
  if (!item) return;
  const existing = item.querySelector('.chapter-check');
  if (hasContent && !existing) {
    const span = document.createElement('span');
    span.className = 'chapter-check';
    span.textContent = '✓';
    item.appendChild(span);
  } else if (!hasContent && existing) {
    existing.remove();
  }
}

function renderMenu() {
  const list = document.getElementById('menuList');
  const currentStudyId = window.activeStudyId;

  // Resolve active language for multilingual title/chapter display.
  // For mono-lingual studies langMap is {} and resolveMetaField falls through
  // to the unnumbered field, so nothing changes for existing studies.
  const availableLangs = detectAvailableLangs();
  const activeLang     = getActiveLang(availableLangs);
  const langMap        = buildLangMap(window.studyMetadata || {});

  // 7. Dynamic heading: "Chapters of [shortTitle]"
  const heading = document.getElementById('menuHeading');
  if (heading) {
    const meta       = window.titlePageData;
    const shortTitle = meta
      ? ((activeLang ? resolveMetaField(meta, 'shortTitle', activeLang, langMap) : '') || meta.shortTitle || meta.title || '')
      : '';
    heading.textContent = shortTitle ? t('main_menu_heading_with_title', { title: shortTitle }) : t('main_menu_heading');
  }

  let html = `
    <div class="chapter-item" onclick="Router.navigate({ page: 'title' })">
      <span class="chapter-num">✦</span>
      <span class="chapter-name">${t('main_menu_title_page')}</span>
    </div>`;

  // 8. My Progress and How to Use removed from Contents — they live in the top bar

  html += chapters.map((ch, i) => {
    const hasAnswers = Object.keys(localStorage).some(key =>
      key.startsWith(`bsr_${currentStudyId}_ch${ch.chapterNumber}_q`) || key.startsWith(`bsr_${currentStudyId}_ch${ch.chapterNumber}_r`)
    );
    // Resolve the chapter title for the active language.
    // chapterTitle1/2/3 for multilingual, chapterTitle for mono-lingual.
    const chTitle = (activeLang ? resolveMetaField(ch, 'chapterTitle', activeLang, langMap) : '') || ch.chapterTitle || '';
    return `
      <div class="chapter-item" onclick="Router.navigate({ page: 'chapter', idx: ${i} })">
        <span class="chapter-num">${String(ch.chapterNumber).padStart(2,'0')}</span>
        <span class="chapter-name">${chTitle}</span>
        ${hasAnswers ? '<span class="chapter-check">✓</span>' : ''}
      </div>`;
  }).join('');

  if (appSettings.showPageNotes) {
    const hasNotesContent = !!localStorage.getItem(`bsr_${currentStudyId}_global_notes`);
    html += `
    <div class="chapter-item" id="menuItemNotes" onclick="Router.navigate({ page: 'notes' })">
      <span class="chapter-num">✎</span>
      <span class="chapter-name">${t('main_menu_notes')}</span>
      ${hasNotesContent ? '<span class="chapter-check">✓</span>' : ''}
    </div>`;
  }

  if (appSettings.showPageLeaders) {
    html += `
    <div class="chapter-item" onclick="Router.navigate({ page: 'leaders' })">
      <span class="chapter-num">✦</span>
      <span class="chapter-name">${t('main_menu_leaders_notes')}</span>
    </div>`;
  }

  if (appSettings.showPageAbout) {
    html += `
    <div class="chapter-item" onclick="Router.navigate({ page: 'about' })">
      <span class="chapter-num">✦</span>
      <span class="chapter-name">${t('main_menu_about')}</span>
    </div>`;
  }

  list.innerHTML = html;
}

// Renders the title/cover page into #mainContent. If a last position exists
// in localStorage, shows a "Continue" button alongside "Begin the Course".
// The cover image has an onerror fallback to a CSS gradient + emoji if the
// image file is missing (useful during development or if assets fail to load).
//
// Multilingual studies: title, subtitle, shortTitle and description are
// resolved for the active study language via resolveMetaField(). The page
// carries no language bar — it silently follows window._activeStudyLang,
// which the chapter lang bar (or the leaders/how-to lang bars) sets.

function renderTitlePage() {
  isNonChapterPage = true;
  restoreStudyTheme();
  const content = document.getElementById('mainContent');
  document.getElementById('progressBar').style.width = '0%';

  // 1. Handle the "No Data" error state
  const meta = window.titlePageData;
  if (!meta) {
    content.innerHTML = `
      <div style="padding:40px 20px; text-align:center; font-family:var(--main-font-family);">
        <div style="font-size:4rem; margin-bottom:20px;">${ICONS.library}</div>
        <h2 style="color:var(--text); margin-bottom:10px;">${t('main_no_study_heading')}</h2>
        <p style="color:var(--text-faint); margin-bottom:30px;">${t('main_no_study_body')}</p>
        <button class="howto-share-btn" style="margin:0 auto; display:inline-flex;" onclick="Router.navigate({ page: 'library' })"><span>${ICONS.library}</span>${t('main_no_study_btn')}</button>
      </div>`;
    return;
  }

  // 2. Resolve active language and build the lang→slot map.
  //    For mono-lingual studies langMap is {}, and resolveMetaField falls
  //    through to the unnumbered field (meta.title, meta.subtitle, etc.).
  const availableLangs = detectAvailableLangs();
  const activeLang     = getActiveLang(availableLangs);
  const langMap        = buildLangMap(window.studyMetadata || {});

  const title      = (activeLang ? resolveMetaField(meta, 'title',      activeLang, langMap) : '') || meta.title      || t('main_fallback_untitled');
  const subtitle   = (activeLang ? resolveMetaField(meta, 'subtitle',   activeLang, langMap) : '') || meta.subtitle   || '';
  const shortTitle = (activeLang ? resolveMetaField(meta, 'shortTitle', activeLang, langMap) : '') || meta.shortTitle || meta.title || '';
  const description= (activeLang ? resolveMetaField(meta, 'description',activeLang, langMap) : '') || meta.description|| '';

  // 3. Update nav bar title
  const navTitle = document.getElementById('header-title');
  if (navTitle) navTitle.innerText = shortTitle || t('main_fallback_study_title');

  // 4. Resolve last position for Continue button
  const savedPos = appSettings.rememberPosition && getLastPosition();
  const pos = savedPos && savedPos.chapterIdx < chapters.length ? savedPos : null;

  // 5. Render the title page using the established CSS classes
  content.innerHTML = `
    <div class="title-page">
      ${meta.image?.src ? `<img class="title-page-image" src="${meta.image.src}" alt="${meta.image?.alt || ''}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />` : ''}
      <div class="title-page-image-fallback" style="${meta.image?.src ? 'display:none' : 'display:flex'}">${meta.image?.fallbackEmoji || '📖'}</div>
      <div class="title-page-body">
        <div class="title-page-main">${title}</div>
        <div class="title-page-sub">${subtitle}</div>
        <div class="title-page-divider"></div>
        <div class="title-page-desc">${description}</div>
        <div class="title-page-author">${meta.authorLabel || t('main_fallback_author_label')}</div>
        <div class="title-page-author-name">${meta.authorName || meta.author || ''}</div>
        <div class="title-page-version">${meta.version || ''}</div>
        ${pos ? `
          <button class="title-page-start-btn" onclick="returnToLastPosition()">
            ${t('main_titlepage_continue', { chapter: chapters[pos.chapterIdx].chapterNumber })}
          </button>
          <button class="title-page-start-btn" style="margin-top:12px; background:transparent; border:1px solid rgba(184,146,42,0.5); color:var(--accent-light); font-size:15px;" onclick="Router.navigate({ page: 'chapter', idx: 0 })">${t('main_titlepage_start_beginning')}</button>
        ` : `
          <button class="title-page-start-btn" onclick="Router.navigate({ page: 'chapter', idx: 0 })">${t('main_titlepage_begin')}</button>
        `}
        <button class="title-page-start-btn" style="margin-top:12px; background:transparent; border:1px solid rgba(184,146,42,0.5); color:var(--accent-light); font-size:15px;" onclick="Router.navigate({ page: 'howto' })">${t('main_titlepage_howto')}</button>
        <div class="title-page-publisher">
          <span class="title-page-publisher-label">${t('main_titlepage_published_by')}</span>
          <button class="title-page-publisher-logo" onclick="Router.navigate({ page: 'about', tabId: 'publisher' })">
            <img src="${window.studyAboutData?.publisher?.image || ''}" alt="${window.studyAboutData?.publisher?.logoAlt || '[Publisher info]'}" class="publisher-logo-img" onerror="this.style.display='none'" />
            <span style="color:rgba(245,240,232,0.45); margin-left:4px;">${ICONS.triggerInfo}</span>
          </button>
        </div>
      </div>
    </div>`;

  window.scrollTo(0, 0);
  
  // Info trigger: title page — fires once globally across all studies
//  createInfoTrigger(
//    'title-page-intro',
//    {
//      title: '[Put infoTrigger title here]',
//      body:  '<p>[Put infoTrigger body text here]</p>'
//    },
//    {
//      placement:      'floating',
//      headingElement: document.getElementById('title-page-main')
//    }
//  );
}

// ── PROGRESS ─────────────────────────────────────────────────────────────────

// Updates the thin gold progress bar in the top nav to reflect what percentage
// of the current chapter's answer fields have non-empty content.
// Called on every keystroke (via the document 'input' listener) and after saving.

function updateProgress() {
  if (isNonChapterPage) return;
  const ch = chapters[currentChapter];
  const allFields = document.querySelectorAll('.answer-field');
  if (!allFields.length) return;

  // Exclude the notes field from progress tracking
  const fields = Array.from(allFields).filter(f => f.dataset.type !== 'notes');
  if (!fields.length) return;

  let filled = 0;
  fields.forEach(f => { if (f.value.trim().length > 0) filled++; });
  const pct = Math.round((filled / fields.length) * 100);
  document.getElementById('progressBar').style.width = pct + '%';

  // Trigger celebration toast on first completion of this chapter
  if (pct === 100) showCelebrationToast(ch);
}

async function initApp() {
  // Called after study data is loaded into the engine.
  // Decides whether to restore a saved position or show the title page,
  // then shows study-specific onboarding on first open of this study.

  // Safety guard: if no study has been loaded yet, do nothing.
  if (!window.chapters || !window.chapters.length) return;

  initSettings();

  const _savedPos = appSettings.rememberPosition && getLastPosition();
  // Guard: discard the saved position if its chapter index is out of range
  // for the current study (e.g. switching from a longer study to a shorter one).
  const _launchPos = _savedPos && _savedPos.chapterIdx < window.chapters.length
    ? _savedPos
    : null;
  if (!_launchPos) clearLastPosition();

  if (_launchPos) {
    await goToChapter(_launchPos.chapterIdx);
    setTimeout(() => window.scrollTo(0, _launchPos.scrollY), 100);
    Router.boot({ page: 'chapter', idx: _launchPos.chapterIdx, scrollY: _launchPos.scrollY });
  } else {
    renderTitlePage();
    Router.boot({ page: 'title' });
  }

  renderMenu();
  // Show app onboarding first; only show study onboarding if app onboarding
  // did not fire (otherwise both overlays stack simultaneously in the DOM,
  // with study onboarding on top, producing the wrong sequence).
  const appOnboardingShown = showAppOnboardingIfNeeded();
  if (!appOnboardingShown) {
    showOnboardingIfNeeded();
  }
}

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
