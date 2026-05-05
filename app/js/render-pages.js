// ── RENDER PAGES ──────────────────────────────────────────────────────────────
// All non-chapter page renderers: How To Use, Settings, Leaders Notes, About,
// Copyright, and the Share App link. Also contains navigateTab() (used by
// swipe navigation on tabbed pages) and renderParas() (shared text helper).
//
// Dependencies (all available as globals before this file loads):
//   ICONS                          – icons.js
//   appSettings                    – settings.js
//   isNonChapterPage               – main.js STATE section
//   chapters                       – window.chapters (state.js)
//   window.activeTabPage,
//   window.activeTabId,
//   window._libTabs,
//   window.appAboutData            – state.js
//   closeMenu, closeNonChapterPage,
//   _resetNonChapterPageState      – navigation.js
//   goToChapter                    – navigation.js
//   tutorialIcon, showFeatureTutorial,
//   showOnboardingFromHowTo,
//   showAppOnboardingFromHowTo,
//   showUpgradeOnboarding         – onboarding.js

// ── TAB PAGE CONSTANTS ────────────────────────────────────────────────────────
// Defined at module level so navigateTab() can access them for swipe navigation.

const HOWTO_TABS = [
  { id: 'study',    label: () => t('renderpages_tab_study')    },
  { id: 'topbar',   label: () => t('renderpages_tab_topbar')   },
  { id: 'chapters', label: () => t('renderpages_tab_chapters') },
  { id: 'library',  label: () => t('renderpages_tab_library')  },
  { id: 'sharing',  label: () => t('renderpages_tab_sharing')  },
];

// SETTINGS_TABS is computed dynamically so the Library tab is hidden in Basic
// and Intermediate modes. Call getSettingsTabs() wherever the list is needed.
function getSettingsTabs() {
  const mode = getInterfaceMode();
  const tabs = [
    { id: 'app',      label: () => t('renderpages_tab_app')            },
    { id: 'study',    label: () => t('renderpages_tab_study_settings') },
    { id: 'language', label: () => `${currentLangFlag()} ${t('renderpages_tab_language')}` },
  ];
  if (mode === 'intermediate' || mode === 'advanced') tabs.push({ id: 'library', label: () => t('renderpages_tab_library') });
  return tabs;
}

// ── PAGE-LEVEL STUDY LANGUAGE SWITCHER ────────────────────────────────────────
// setPageStudyLang(code, rerender)
//
// Used by the lang bars on renderLeadersNotes and tabStudy (renderHowToUse).
// Mirrors the behaviour of setStudyLang() in render-chapter-ui.js but accepts
// a rerender callback so both pages can share one implementation.
//
// Sets window._activeStudyLang (shared with chapter pages), optionally updates
// the session UI locale if the chosen language has UI support, then calls the
// supplied rerender function to refresh the page.
//
// The rerender callback is passed as an inline string via onclick, so it must
// be resolvable as a global. The two callers use:
//   () => renderLeadersNotes(window.activeTabId)
//   () => renderHowToUse('study')

async function setPageStudyLang(code, rerender) {
  window._activeStudyLang = code;

  if (SUPPORTED_LANGUAGES.includes(code)) {
    window._sessionUiLangOverride = code;
    applyLanguageToDom(code);
    await loadLocale(code);
  }

  rerender();
}


// page:      'settings' | 'howto'
// direction: +1 (swipe left → next tab) | -1 (swipe right → prev tab)
function navigateTab(page, direction) {
  const tabs = page === 'settings'  ? getSettingsTabs()
             : page === 'library'   ? (window._libTabs || [{ id: 'all' }, { id: 'recent' }, { id: 'load' }])
             : page === 'leaders'   ? LEADERS_TABS
             : page === 'godeeper' ? GODEEPER_TABS
             : page === 'about'     ? ABOUT_TABS
             : page === 'progress'  ? PROGRESS_TABS
             :                        HOWTO_TABS;
  const currentId = window.activeTabId || tabs[0].id;
  const idx       = tabs.findIndex(t => t.id === currentId);
  const newIdx    = Math.max(0, Math.min(tabs.length - 1, idx + direction));
  if (newIdx === idx) return;
  const newId = tabs[newIdx].id;
  if      (page === 'settings')  { Router.replaceState({ page: 'settings',  tabId: newId }); renderSettings(newId); }
  else if (page === 'library')   switchLibTab(newId);
  else if (page === 'leaders')   { Router.replaceState({ page: 'leaders',   tabId: newId }); renderLeadersNotes(newId); }
  else if (page === 'godeeper') { Router.replaceState({ page: 'godeeper', tabId: newId }); renderGoDeeper(newId); }
  else if (page === 'about')     { Router.replaceState({ page: 'about',     tabId: newId }); renderAbout(newId); }
  else if (page === 'progress')  { if (document.getElementById('progressTabBar')) switchProgressTab(newId); }
  else                           { Router.replaceState({ page: 'howto',     tabId: newId }); renderHowToUse(newId); }
  if (page !== 'library') window.scrollTo(0, 0);
}

// ── RENDER TILE PAGE ─────────────────────────────────────────────────────────
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
  closeMenu();
  _resetNonChapterPageState();
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

// ── RENDER HOW TO USE PAGE ───────────────────────────────────────────────────
// Renders the "How to Use This App" instructional page into #mainContent.
// Accessible from the title page, the onboarding overlay, and the Contents menu.

async function renderHowToUse(tabId) {
  closeMenu();
  _resetNonChapterPageState();
  // Note: clearStudyUiLangOverride() is intentionally NOT called here.
  // The Study tab carries its own lang bar and shares window._activeStudyLang
  // with the chapter pages, so the session language override is preserved.
  // clearStudyUiLangOverride() is still called by renderSettings, renderAbout,
  // and openLibrary where no study content is displayed.
  isNonChapterPage = true;
  window.activeTabPage = 'howto';
  window.activeTabId   = tabId || 'study';
  if (window.activeTabId === 'study') { restoreStudyTheme(); } else { suspendStudyTheme(); }
  const howtoBtn = document.getElementById('navHowtoBtn');
  if (howtoBtn) { howtoBtn.innerHTML = ICONS.close; howtoBtn.onclick = () => Router.back(); }
  const content = document.getElementById('mainContent');
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.parentElement.style.display = 'none';
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('header-title').innerText = t('renderpages_header_howto');

  const TABS      = HOWTO_TABS;
  const activeTab = window.activeTabId;

  // ── Tab content builders ──────────────────────────────────────────────────

  function tabStudy() {
    const sections        = howToUseData.sections || [];
    const studyTitle      = window.titlePageData?.title || '';
    const studyShortTitle = window.titlePageData?.shortTitle || '';
    const hasStudy        = !!window.titlePageData;

    // ── Language bar (multilingual studies only) ──────────────────────────────
    // Resolve the active language and build the slot map for this tab's content.
    // The bar is hidden for mono-lingual studies (availableLangs.length < 2).
    // Shares window._activeStudyLang with chapter pages and leaders notes.
    const availableLangs = detectAvailableLangs();
    const activeLang     = getActiveLang(availableLangs) || 'en';
    const langMap        = buildLangMap(window.studyMetadata || {});

    const langBarHtml = (() => {
      if (availableLangs.length < 2) return '';

      // Determine which flags appear more than once (mirrors buildLangBar logic).
      const flagCounts = {};
      availableLangs.forEach(code => {
        const f = LANGUAGE_MAP[code]?.flag;
        if (f) flagCounts[f] = (flagCounts[f] || 0) + 1;
      });

      const buttons = availableLangs.map(code => {
        const entry      = LANGUAGE_MAP[code];
        const label      = entry?.label || code.toUpperCase();
        const flagShared = entry && flagCounts[entry.flag] > 1;
        const display    = ((flagShared || entry?.alwaysBadge) && entry?.badge)
          ? renderLangBadge(entry)
          : (entry?.flag || '🌐');
        return `<button class="lib-lang-btn${activeLang === code ? ' active' : ''}"
                         onclick="setPageStudyLang('${code}', () => { Router.replaceState({ page: 'howto', tabId: 'study' }); renderHowToUse('study'); })"
                         aria-label="${label}"
                         title="${label}">${display}</button>`;
      }).join('');

      return `<div class="howto-lang-bar">${buttons}</div>`;
    })();

    // Resolve the study title/shortTitle for the active language (used in the
    // "New here?" panel). Falls back to the raw meta fields for mono-lingual studies.
    const meta              = window.titlePageData;
    const resolvedTitle      = meta && activeLang
      ? (resolveMetaField(meta, 'title',      activeLang, langMap) || meta.title      || studyTitle)
      : studyTitle;
    const resolvedShortTitle = meta && activeLang
      ? (resolveMetaField(meta, 'shortTitle', activeLang, langMap) || meta.shortTitle || studyShortTitle)
      : studyShortTitle;

    // "New here?" panel — adapts based on whether a study is loaded.
    // When no study is loaded, the study-slides button is replaced with a
    // prompt to visit the Library, since there is nothing to show.
    const newHerePanel = `
     <div class="howto-section">
      <div class="howto-block">
        <div class="howto-block-title">${t('renderpages_newhere_title')}</div>
        ${hasStudy ? `
          <p>${t('renderpages_newhere_hasstudy_body', { studyTitle: resolvedTitle })}</p>
          <button class="howto-share-btn" style="background:var(--text); margin-top:8px;"
                  onclick="showOnboarding()">
            <span>${ICONS.triggerSlides}</span> ${t('renderpages_newhere_hasstudy_btn', { studyShortTitle: resolvedShortTitle })}
          </button>
        ` : `
          <p>${t('renderpages_newhere_nostudy_body')}</p>
          <button class="howto-share-btn" style="background:var(--text); margin-top:8px;"
                  onclick="Router.navigate({ page: 'library' })">
            <span>${ICONS.library}</span> ${t('renderpages_newhere_nostudy_btn')}
          </button>
        `}
        <p style="margin-top:16px;">${t('renderpages_newhere_appslides_prompt')}</p>
        <button class="howto-share-btn" style="background:var(--text-secondary); margin-top:8px;"
                onclick="showAppOnboardingFromHowTo()">
          <span>${ICONS.triggerSlides}</span> ${t('renderpages_newhere_appslides_btn')}
        </button>
        <p style="margin-top:16px;">${t('renderpages_newhere_upgradeslides_prompt')}</p>
        <button class="howto-share-btn" style="background:var(--text-secondary); margin-top:8px;"
                onclick="showUpgradeOnboarding()">
          <span>✨</span> ${t('renderpages_newhere_upgradeslides_btn', { version: window.appAboutData?.appVersion ?? '—' })}
        </button>
      </div>
     </div>`;

    return `
      ${langBarHtml}

      ${newHerePanel}

      ${sections.map(section => {
        // Resolve section heading for the active language.
        // Multilingual: heading1/heading2/… — mono-lingual: heading (unnumbered).
        const heading = resolveMetaField(section, 'heading', activeLang, langMap);
        return `
        <div class="howto-section">
          <div class="howto-section-heading">${heading}</div>
          ${section.blocks.map(block => {
            // Resolve block title and body for the active language.
            const blockTitle = resolveMetaField(block, 'title', activeLang, langMap);
            const blockBody  = resolveMetaField(block, 'body',  activeLang, langMap);
            return `
            <div class="howto-block">
              <div class="howto-block-title">${blockTitle}</div>
              <div class="howto-block-body">${blockBody}</div>
            </div>`;
          }).join('')}
        </div>`;
      }).join('')}

      ${hasStudy ? `
        <div class="howto-section" style="margin-top: 24px;">
          <button class="howto-start-btn" onclick="Router.navigate({ page: 'chapter', idx: 0 })">${t('renderpages_begin_ch1_btn')}</button>
          <button class="howto-start-btn howto-leaders-btn"
                  style="margin-top:12px; font-size:15px;"
                  onclick="Router.navigate({ page: 'leaders' })">
            ${t('renderpages_leaders_notes_btn')}
          </button>
        </div>
      ` : ''}
    `;
  }

  function tabTopBar() {
    return `
      <div class="howto-section">
        <div class="howto-section-heading">${t('renderpages_topbar_heading')}</div>

        <div class="howto-ui-item">
          <div class="howto-ui-icon">${ICONS.library}</div>
          <div class="howto-ui-text">
            <div class="howto-ui-label">${t('renderpages_topbar_library_label')}</div>
            <div class="howto-ui-desc">${t('renderpages_topbar_library_desc')}</div>
          </div>
        </div>

        <div class="howto-ui-item">
          <div class="howto-ui-icon">${ICONS.search}</div>
          <div class="howto-ui-text">
            <div class="howto-ui-label">
              ${t('renderpages_topbar_search_label')}
              <button class="howto-tutorial-btn" data-tutorial-id="search"
                      onclick="showFeatureTutorial('search', () => { Router.replaceState({ page: 'howto', tabId: 'topbar' }); renderHowToUse('topbar'); })">
                <span class="tutorial-trigger-icon">${tutorialIcon('search')}</span>
              </button>
            </div>
            <div class="howto-ui-desc">${t('renderpages_topbar_search_desc')}</div>
          </div>
        </div>

        <div class="howto-ui-item">
          <div class="howto-ui-icon">${ICONS.progress}</div>
          <div class="howto-ui-text">
            <div class="howto-ui-label">
              ${t('renderpages_topbar_progress_label')}
              <button class="howto-tutorial-btn" data-tutorial-id="my-progress"
                      onclick="showFeatureTutorial('my-progress', () => { Router.replaceState({ page: 'howto', tabId: 'topbar' }); renderHowToUse('topbar'); })">
                <span class="tutorial-trigger-icon">${tutorialIcon('my-progress')}</span>
              </button>
            </div>
            <div class="howto-ui-desc">${t('renderpages_topbar_progress_desc')}</div>
          </div>
        </div>

        <div class="howto-ui-item">
          <div class="howto-ui-icon">${ICONS.howto}</div>
          <div class="howto-ui-text">
            <div class="howto-ui-label">${t('renderpages_topbar_howto_label')}</div>
            <div class="howto-ui-desc">${t('renderpages_topbar_howto_desc')}</div>
          </div>
        </div>

        <div class="howto-ui-item">
          <div class="howto-ui-icon">${ICONS.settings}</div>
          <div class="howto-ui-text">
            <div class="howto-ui-label">${t('renderpages_topbar_settings_label')}</div>
            <div class="howto-ui-desc">${t('renderpages_topbar_settings_desc')}. Key options: <b>Text Size</b>, <b>Dark Mode</b>, swipe sensitivity, answer box height, and share format.</div>
          </div>
        </div>

        <div class="howto-ui-item">
          <div class="howto-ui-icon">${ICONS.contents}</div>
          <div class="howto-ui-text">
            <div class="howto-ui-label">${t('renderpages_topbar_contents_label')}</div>
            <div class="howto-ui-desc">${t('renderpages_topbar_contents_desc')}</div>
          </div>
        </div>

        <div class="howto-ui-item">
          <div class="howto-ui-icon" style="font-size:14px;">▬</div>
          <div class="howto-ui-text">
            <div class="howto-ui-label">
              ${t('renderpages_topbar_progressbar_label')}
              <button class="howto-tutorial-btn" data-tutorial-id="progress-bar"
                      onclick="showFeatureTutorial('progress-bar', () => { Router.replaceState({ page: 'howto', tabId: 'topbar' }); renderHowToUse('topbar'); })">
                <span class="tutorial-trigger-icon">${tutorialIcon('progress-bar')}</span>
              </button>
            </div>
            <div class="howto-ui-desc">${t('renderpages_topbar_progressbar_desc')}</div>
          </div>
        </div>

        <div class="howto-block" style="margin: 16px 0 0;">
          <div class="howto-block-title">${t('renderpages_topbar_gotosettings_title')}</div>
          <p>${t('renderpages_topbar_gotosettings_body')}</p>
          <button class="howto-share-btn" style="background: var(--text); margin-top:8px;" onclick="Router.navigate({ page: 'settings' })">
            <span>${ICONS.settings}</span> ${t('renderpages_topbar_gotosettings_btn')}
          </button>
        </div>
      </div>`;
  }

  function tabChapters() {
    return `
      <div class="howto-section">
        <div class="howto-section-heading">${t('renderpages_chapters_heading')}</div>

        <div class="howto-ui-item">
          <div class="howto-ui-icon">${ICONS.triggerInfo}</div>
          <div class="howto-ui-text">
            <div class="howto-ui-label">
              ${t('renderpages_chapters_biblepopup_label')}
              <button class="howto-tutorial-btn" data-tutorial-id="bible-popups"
                      onclick="showFeatureTutorial('bible-popups', () => { Router.replaceState({ page: 'howto', tabId: 'chapters' }); renderHowToUse('chapters'); })">
                <span class="tutorial-trigger-icon">${tutorialIcon('bible-popups')}</span>
              </button>
            </div>
            <div class="howto-ui-desc">${t('renderpages_chapters_biblepopup_desc')}</div>
          </div>
        </div>

        <div class="howto-ui-item">
          <div class="howto-ui-icon">${ICONS.starFilled}</div>
          <div class="howto-ui-text">
            <div class="howto-ui-label">
              ${t('renderpages_chapters_starring_label')}
              <button class="howto-tutorial-btn" data-tutorial-id="starring-questions"
                      onclick="showFeatureTutorial('starring-questions', () => { Router.replaceState({ page: 'howto', tabId: 'chapters' }); renderHowToUse('chapters'); })">
                <span class="tutorial-trigger-icon">${tutorialIcon('starring-questions')}</span>
              </button>
            </div>
            <div class="howto-ui-desc">${t('renderpages_chapters_starring_desc')}</div>
          </div>
        </div>

        <div class="howto-ui-item">
          <div class="howto-ui-icon">📝</div>
          <div class="howto-ui-text">
            <div class="howto-ui-label">
              ${t('renderpages_chapters_notes_label')}
              <button class="howto-tutorial-btn" data-tutorial-id="notes-area"
                      onclick="showFeatureTutorial('notes-area', () => { Router.replaceState({ page: 'howto', tabId: 'chapters' }); renderHowToUse('chapters'); })">
                <span class="tutorial-trigger-icon">${tutorialIcon('notes-area')}</span>
              </button>
            </div>
            <div class="howto-ui-desc">${t('renderpages_chapters_notes_desc')}</div>
          </div>
        </div>

        <div class="howto-ui-item">
          <div class="howto-ui-icon">${ICONS.save}</div>
          <div class="howto-ui-text">
            <div class="howto-ui-label">
              ${t('renderpages_chapters_save_label')}
              <button class="howto-tutorial-btn" data-tutorial-id="auto-save"
                      onclick="showFeatureTutorial('auto-save', () => { Router.replaceState({ page: 'howto', tabId: 'chapters' }); renderHowToUse('chapters'); })">
                <span class="tutorial-trigger-icon">${tutorialIcon('auto-save')}</span>
              </button>
            </div>
            <div class="howto-ui-desc">${t('renderpages_chapters_save_desc')}</div>
          </div>
        </div>

        <div class="howto-ui-item">
          <div class="howto-ui-icon">${ICONS.print}</div>
          <div class="howto-ui-text">
            <div class="howto-ui-label">${t('renderpages_chapters_print_label')}</div>
            <div class="howto-ui-desc">${t('renderpages_chapters_print_desc')}</div>
          </div>
        </div>

        <div class="howto-ui-item">
          <div class="howto-ui-icon">${ICONS.share}</div>
          <div class="howto-ui-text">
            <div class="howto-ui-label">
              ${t('renderpages_chapters_share_label')}
              <button class="howto-tutorial-btn" data-tutorial-id="sharing"
                      onclick="showFeatureTutorial('sharing', () => { Router.replaceState({ page: 'howto', tabId: 'chapters' }); renderHowToUse('chapters'); })">
                <span class="tutorial-trigger-icon">${tutorialIcon('sharing')}</span>
              </button>
            </div>
            <div class="howto-ui-desc">${t('renderpages_chapters_share_desc')}</div>
          </div>
        </div>

        <div class="howto-ui-item">
          <div class="howto-ui-icon">${ICONS.mic}</div>
          <div class="howto-ui-text">
            <div class="howto-ui-label">
              ${t('renderpages_chapters_voice_label')}
              <button class="howto-tutorial-btn" data-tutorial-id="voice-input"
                      onclick="showFeatureTutorial('voice-input', () => { Router.replaceState({ page: 'howto', tabId: 'chapters' }); renderHowToUse('chapters'); })">
                <span class="tutorial-trigger-icon">${tutorialIcon('voice-input')}</span>
              </button>
            </div>
            <div class="howto-ui-desc">${t('renderpages_chapters_voice_desc')}</div>
          </div>
        </div>

        <div class="howto-ui-item">
          <div class="howto-ui-icon">${ICONS.localValidate}</div>
          <div class="howto-ui-text">
            <div class="howto-ui-label">
              ${t('renderpages_chapters_answercheck_label')}
              <button class="howto-tutorial-btn" data-tutorial-id="answer-check"
                      onclick="showFeatureTutorial('answer-check', () => { Router.replaceState({ page: 'howto', tabId: 'chapters' }); renderHowToUse('chapters'); })">
                <span class="tutorial-trigger-icon">${tutorialIcon('answer-check')}</span>
              </button>
            </div>
            <div class="howto-ui-desc">${t('renderpages_chapters_answercheck_desc')}</div>
          </div>
        </div>


        <div class="howto-ui-item">
          <div class="howto-ui-icon">${ICONS.speak}</div>
          <div class="howto-ui-text">
            <div class="howto-ui-label">
              ${t('renderpages_chapters_readaloud_label')}
              <button class="howto-tutorial-btn" data-tutorial-id="read-aloud"
                      onclick="showFeatureTutorial('read-aloud', () => { Router.replaceState({ page: 'howto', tabId: 'chapters' }); renderHowToUse('chapters'); })">
                <span class="tutorial-trigger-icon">${tutorialIcon('read-aloud')}</span>
              </button>
            </div>
            <div class="howto-ui-desc">${t('renderpages_chapters_readaloud_desc')}</div>
          </div>
        </div>

        <div class="howto-ui-item">
          <div class="howto-ui-icon">←→</div>
          <div class="howto-ui-text">
            <div class="howto-ui-label">
              ${t('renderpages_chapters_navbtns_label')}
              <button class="howto-tutorial-btn" data-tutorial-id="swipe-navigation"
                      onclick="showFeatureTutorial('swipe-navigation', () => { Router.replaceState({ page: 'howto', tabId: 'chapters' }); renderHowToUse('chapters'); })">
                <span class="tutorial-trigger-icon">${tutorialIcon('swipe-navigation')}</span>
              </button>
            </div>
            <div class="howto-ui-desc">${t('renderpages_chapters_navbtns_desc')}</div>
          </div>
        </div>

        <div class="howto-ui-item">
          <div class="howto-ui-icon">✦</div>
          <div class="howto-ui-text">
            <div class="howto-ui-label">${t('renderpages_chapters_other_label')}</div>
            <div class="howto-ui-desc">${t('renderpages_chapters_other_desc')}</div>
          </div>
        </div>

      </div>

      <button class="howto-start-btn" onclick="Router.navigate({ page: 'chapter', idx: 0 })">${t('renderpages_begin_ch1_btn')}</button>`;
  }

  function tabLibrary() {
    return `
      <div class="howto-section">
        <div class="howto-section-heading">${t('renderpages_library_heading')}</div>

        <div style="margin-bottom:16px;">
          <button class="howto-tutorial-btn" style="font-size:14px; color:var(--accent);"
                  data-tutorial-id="library"
                  onclick="showFeatureTutorial('library', () => { Router.replaceState({ page: 'howto', tabId: 'library' }); renderHowToUse('library'); })">
            <span class="tutorial-trigger-icon">${tutorialIcon('library')}</span>
            ${t('renderpages_library_tour_btn')}
          </button>
        </div>

        <div class="howto-block">
          <div class="howto-block-title">${t('renderpages_library_loading_title')}</div>
          <p>${t('renderpages_library_loading_body')}</p>
        </div>

        <div class="howto-block">
          <div class="howto-block-title">${t('renderpages_library_switching_title')}</div>
          <p>${t('renderpages_library_switching_body')}</p>
        </div>

        <div class="howto-block">
          <div class="howto-block-title">${t('renderpages_library_removing_title')}</div>
          <p>${t('renderpages_library_removing_body')}</p>
        </div>

      </div>`;
  }

  function tabSharing() {
    return `
      <div class="howto-section">
        <div class="howto-section-heading">${t('renderpages_sharing_heading')}</div>

        <div style="margin-bottom:16px;">
          <button class="howto-tutorial-btn" style="font-size:14px; color:var(--accent);"
                  data-tutorial-id="sharing"
                  onclick="showFeatureTutorial('sharing', () => { Router.replaceState({ page: 'howto', tabId: 'sharing' }); renderHowToUse('sharing'); })">
            <span class="tutorial-trigger-icon">${tutorialIcon('sharing')}</span>
            ${t('renderpages_sharing_tour_btn')}
          </button>
        </div>

        <div class="howto-block">
          <div class="howto-block-title">${t('renderpages_sharing_chapter_title')}</div>
          <p>${t('renderpages_sharing_chapter_body')}</p>
        </div>

        <div class="howto-block">
          <div class="howto-block-title">${t('renderpages_sharing_all_title')}</div>
          <p>${t('renderpages_sharing_all_body')}</p>
        </div>

        <div class="howto-block">
          <div class="howto-block-title">${t('renderpages_sharing_print_title')}</div>
          <p>${t('renderpages_sharing_print_body')}</p>
        </div>

        <div class="howto-block">
          <div class="howto-block-title">${t('renderpages_sharing_format_title')}</div>
          <p>${t('renderpages_sharing_format_body')}</p>
        </div>

      </div>

      <div class="howto-section">
        <div class="howto-section-heading">${t('renderpages_shareapp_heading')}</div>
        <div class="howto-block">
          <div class="howto-block-title">${t('renderpages_shareapp_know_title')}</div>
          <p>${t('renderpages_shareapp_know_body')}</p>
          <button class="howto-share-btn" onclick="shareAppLink()">
            <span>📲</span> ${t('renderpages_shareapp_know_btn')}
          </button>
        </div>

        <div class="howto-block">
          <div class="howto-block-title">${t('renderpages_shareapp_download_title')}</div>
          <p>${t('renderpages_shareapp_download_body')}</p>
          <button class="howto-share-btn"
            onclick="${(() => {
              const pkg       = window.appAboutData?.androidPackageId || '';
              const playUrl   = `https://play.google.com/store/apps/details?id=${pkg}`;
              const intentUrl = `market://details?id=${pkg}`;
              return `window.Android?.openUrl ? Android.openUrl('${intentUrl}') : window.open('${playUrl}', '_blank')`;
            })()}">
            <span>⬇️</span> ${t('renderpages_shareapp_download_btn')}
          </button>
        </div>`;
  }

  // Tab content dispatch
  const tabContentFns = {
    study:    tabStudy,
    topbar:   tabTopBar,
    chapters: tabChapters,
    library:  tabLibrary,
    sharing:  tabSharing,
  };

  // Build tab bar HTML
  const tabBarHtml = `
    <div class="howto-tab-bar" id="howtoTabBar">
      ${TABS.map(t => `
        <button
          class="howto-tab${t.id === activeTab ? ' active' : ''}"
          onclick="Router.replaceState({ page: 'howto', tabId: '${t.id}' }); renderHowToUse('${t.id}')"
        >${typeof t.label === 'function' ? t.label() : t.label}</button>`).join('')}
    </div>`;

  const tabContent = (tabContentFns[activeTab] || tabStudy)();

  content.innerHTML = `
    <div class="howto-page">
      <div class="howto-header">
        <div class="howto-eyebrow">${t('renderpages_howto_eyebrow')}</div>
        <div class="howto-title">${t('renderpages_howto_title')}</div>
      </div>

      ${tabBarHtml}

      <div id="howtoTabContent">
        ${tabContent}
      </div>

      <div class="page-close-bar">
        <button class="page-close-btn" onclick="Router.back()"><span>&#10005;</span> ${t('renderpages_close_btn')}</button>
      </div>

      <div style="height:40px;"></div>
    </div>
  `;
  window.scrollTo(0, 0);
}


// Shares a short promotional message about the app via the native share sheet,
// Android bridge, or clipboard fallback. Called from the How To Use page.
// Clipboard fallback uses copyToClipboard() → navigator.clipboard.writeText()
// with execCommand as a last resort via fallbackCopy().
function shareAppLink() {
  const pkg      = window.appAboutData?.androidPackageId || '';
  const playUrl  = pkg ? `https://play.google.com/store/apps/details?id=${pkg}` : '';

  const message  = t('renderpages_shareapp_share_message', { url: playUrl });

  if (window.Android && window.Android.share) {
    window.Android.share(message);
  } else if (navigator.share) {
    navigator.share({ title: t('renderpages_shareapp_share_title'), text: message });
  } else {
    copyToClipboard(message);
    showToast({ message: t('renderpages_shareapp_copied_toast'), isManual: true });
  }
}

// ── RENDER SETTINGS PAGE ─────────────────────────────────────────────────────
// Renders the Settings page into #mainContent. Builds the font size dot track
// and all toggle/segment controls from current appSettings values.
// The inner tog() helper generates a toggle switch HTML snippet for a given key,
// wired to saveSetting() so each toggle immediately saves and applies its change.
// updateSettingsControls() is called after render to sync the size dots and labels.

async function renderSettings(tabId) {
  closeMenu();
  _resetNonChapterPageState();
  await clearStudyUiLangOverride();
  isNonChapterPage = true;
  window.activeTabPage = 'settings';
  window.activeTabId   = tabId || 'app';
  if (window.activeTabId === 'study') { restoreStudyTheme(); } else { suspendStudyTheme(); }
  const settingsBtn = document.getElementById('navSettingsBtn');
  if (settingsBtn) { settingsBtn.innerHTML = ICONS.close; settingsBtn.onclick = () => Router.back(); }
  const content = document.getElementById('mainContent');
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.parentElement.style.display = 'none';
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('header-title').innerText = t('renderpages_header_settings');
  // Compute the tab list for the current mode, and fall back to 'app' if the
  // requested tab (e.g. 'library') is not available in the current mode.
  const SETTINGS_TABS = getSettingsTabs();
  const activeTab = SETTINGS_TABS.find(t => t.id === window.activeTabId)
    ? window.activeTabId
    : 'app';

  // ── Helper: toggle switch HTML ─────────────────────────────────────────────
  function tog(key) {
    return `<div class="settings-toggle ${appSettings[key] ? 'on' : ''}" data-setting-key="${key}" onclick="saveSetting('${key}', !appSettings['${key}'])">
      <div class="settings-toggle-knob"></div>
    </div>`;
  }

  // ── Tab: App ───────────────────────────────────────────────────────────────
  function tabApp() {
    const mode  = getInterfaceMode();
    const basic = mode === 'basic';
    const adv   = mode === 'advanced';

    const steps = (FONT_MAX - FONT_MIN) / FONT_STEP;
    let dotsHtml = '';
    for (let i = 0; i <= steps; i++) {
      const px = FONT_MIN + (i * FONT_STEP);
      dotsHtml += `<div class="settings-size-dot" onclick="setFontSize(${px})" title="${px}px"></div>`;
    }

    // ── Appearance rows — visibility by mode ─────────────────────────────────
    const appearanceRows = `
          <div class="settings-row">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_darkmode_label')}</div>
              <div class="settings-row-desc">${t('renderpages_settings_darkmode_desc')}</div>
            </div>
            ${tog('darkMode')}
          </div>

          <div class="settings-divider"></div>
          <div class="settings-row">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_progressbar_label')}</div>
              <div class="settings-row-desc">${t('renderpages_settings_progressbar_desc')}</div>
            </div>
            ${tog('showProgressBar')}
          </div>

          ${!basic ? `
          <div class="settings-divider"></div>
          <div class="settings-row">
            <div class="settings-row-text">
              <div class="settings-row-label">
                ${t('renderpages_settings_rememberplace_label')}
                <button class="howto-tutorial-btn" data-tutorial-id="remember-position"
                        onclick="showFeatureTutorial('remember-position', () => { Router.replaceState({ page: 'settings', tabId: 'app' }); renderSettings('app'); })">
                  <span class="tutorial-trigger-icon">${tutorialIcon('remember-position')}</span>
                </button>
              </div>
              <div class="settings-row-desc">${t('renderpages_settings_rememberplace_desc')}</div>
            </div>
            ${tog('rememberPosition')}
          </div>

          <div class="settings-divider"></div>
          <div class="settings-row" style="flex-direction:column; align-items:stretch; gap:10px;">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_readingfont_label')}</div>
              <div class="settings-row-desc">${t('renderpages_settings_readingfont_desc')}</div>
            </div>
            <div class="settings-seg">
              <button class="settings-seg-btn ${appSettings.useSansSerif ? '' : 'active'}"
                data-setting-key="useSansSerif" data-setting-value="false"
                onclick="saveSetting('useSansSerif', false)">${t('renderpages_settings_font_serif')}</button>
              <button class="settings-seg-btn ${appSettings.useSansSerif ? 'active' : ''}"
                data-setting-key="useSansSerif" data-setting-value="true"
                onclick="saveSetting('useSansSerif', true)">${t('renderpages_settings_font_sansserif')}</button>
            </div>
          </div>` : ''}

          ${adv ? `
          <div class="settings-divider"></div>
          <div class="settings-row" style="flex-direction:column; align-items:stretch; gap:10px;">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_iconstyle_label')}</div>
              <div class="settings-row-desc">${t('renderpages_settings_iconstyle_desc')}</div>
            </div>
            <div class="settings-seg">
              ${ICON_THEME_LABELS.map(t => `
                <button class="settings-icon-theme-btn settings-seg-btn ${appSettings.iconStyle === t.value ? 'active' : ''}"
                  data-setting-key="iconStyle" data-setting-value="${t.value}"
                  onclick="saveSetting('iconStyle', '${t.value}')">
                  <span class="settings-icon-theme-preview">${ICON_THEMES[t.value].search || ICONS.search}</span>
                  <span class="settings-icon-theme-label">${t.label}</span>
                </button>`).join('')}
            </div>
          </div>` : ''}`;

    // ── Answer Check Mode — shown in Basic and above ──────────────────────────
    const lvMode = appSettings.localValidateMode || 'manual';
    const answerCheckModeSection = `
      <div class="settings-section">
        <div class="settings-section-heading">
          ${t('renderpages_settings_answercheck_heading')}
          <button class="howto-tutorial-btn" data-tutorial-id="answer-check"
                  onclick="showFeatureTutorial('answer-check', () => { Router.replaceState({ page: 'settings', tabId: 'app' }); renderSettings('app'); })">
            <span class="tutorial-trigger-icon">${tutorialIcon('answer-check')}</span>
          </button>
        </div>
        <div class="settings-block">
          <div class="settings-row" style="flex-direction:column; align-items:stretch; gap:10px;">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_answercheck_label')}</div>
              <div class="settings-row-desc">
                ${t('renderpages_settings_answercheck_desc')}
              </div>
            </div>
            <div class="settings-seg">
              <button class="settings-seg-btn ${lvMode === 'manual' ? 'active' : ''}"
                data-setting-key="localValidateMode" data-setting-value="manual"
                onclick="saveSetting('localValidateMode', 'manual')">${t('renderpages_settings_answercheck_manual')}</button>
              <button class="settings-seg-btn ${lvMode === 'auto' ? 'active' : ''}"
                data-setting-key="localValidateMode" data-setting-value="auto"
                onclick="saveSetting('localValidateMode', 'auto')">${t('renderpages_settings_answercheck_auto')}</button>
            </div>
          </div>
        </div>
      </div>`;

    // ── Navigation — swipe always; nav buttons only in Advanced ──────────────
    const navSection = `
      <div class="settings-section">
        <div class="settings-section-heading">
          ${t('renderpages_settings_navigation_heading')}
          <button class="howto-tutorial-btn" data-tutorial-id="swipe-navigation"
                  onclick="showFeatureTutorial('swipe-navigation', () => { Router.replaceState({ page: 'settings', tabId: 'app' }); renderSettings('app'); })">
            <span class="tutorial-trigger-icon">${tutorialIcon('swipe-navigation')}</span>
          </button>
        </div>
        <div class="settings-block">
          ${adv ? `
          <div class="settings-row">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_navbtns_label')}</div>
              <div class="settings-row-desc">${t('renderpages_settings_navbtns_desc')}</div>
            </div>
            ${tog('showNavButtons')}
          </div>
          <div class="settings-divider"></div>` : ''}
          <div class="settings-row" style="flex-direction:column; align-items:stretch; gap:10px;">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_swipe_label')}</div>
              <div class="settings-row-desc">${t('renderpages_settings_swipe_desc')}</div>
            </div>
            <div class="settings-seg" id="swipe-seg">
              <button class="settings-seg-btn ${appSettings.swipeSensitivity === 'low' ? 'active' : ''}"
                data-setting-key="swipeSensitivity" data-setting-value="low"
                onclick="saveSetting('swipeSensitivity', 'low')">${t('renderpages_settings_swipe_low')}</button>
              <button class="settings-seg-btn ${appSettings.swipeSensitivity === 'medium' ? 'active' : ''}"
                data-setting-key="swipeSensitivity" data-setting-value="medium"
                onclick="saveSetting('swipeSensitivity', 'medium')">${t('renderpages_settings_swipe_medium')}</button>
              <button class="settings-seg-btn ${appSettings.swipeSensitivity === 'high' ? 'active' : ''}"
                data-setting-key="swipeSensitivity" data-setting-value="high"
                onclick="saveSetting('swipeSensitivity', 'high')">${t('renderpages_settings_swipe_high')}</button>
            </div>
          </div>
        </div>
      </div>`;

    // ── Answer Box Size — Intermediate+ ──────────────────────────────────────
    const answerBoxSection = !basic ? `
      <div class="settings-section">
        <div class="settings-section-heading">${t('renderpages_settings_answerbox_heading')}</div>
        <div class="settings-block">
          <div class="settings-row" style="flex-direction:column; align-items:stretch; gap:10px;">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_answerbox_label')}</div>
              <div class="settings-row-desc">${t('renderpages_settings_answerbox_desc')}</div>
            </div>
            <div class="settings-seg">
              <button class="settings-seg-btn ${appSettings.answerFieldSize === 'small' ? 'active' : ''}"
                data-setting-key="answerFieldSize" data-setting-value="small"
                onclick="saveSetting('answerFieldSize', 'small')">${t('renderpages_settings_size_small')}</button>
              <button class="settings-seg-btn ${appSettings.answerFieldSize === 'medium' || !appSettings.answerFieldSize ? 'active' : ''}"
                data-setting-key="answerFieldSize" data-setting-value="medium"
                onclick="saveSetting('answerFieldSize', 'medium')">${t('renderpages_settings_size_medium')}</button>
              <button class="settings-seg-btn ${appSettings.answerFieldSize === 'large' ? 'active' : ''}"
                data-setting-key="answerFieldSize" data-setting-value="large"
                onclick="saveSetting('answerFieldSize', 'large')">${t('renderpages_settings_size_large')}</button>
            </div>
          </div>
        </div>
      </div>` : '';

    // ── Optional Pages — Intermediate+ ───────────────────────────────────────
    const optionalPagesSection = !basic ? `
      <div class="settings-section">
        <div class="settings-section-heading">${t('renderpages_settings_optialpages_heading')}</div>
        <div class="settings-block">
          <div class="settings-row">
            <div class="settings-row-text">
              <div class="settings-row-label">
                ${t('renderpages_settings_myprogress_label')}
                <button class="howto-tutorial-btn" data-tutorial-id="my-progress"
                        onclick="showFeatureTutorial('my-progress', () => { Router.replaceState({ page: 'settings', tabId: 'app' }); renderSettings('app'); })">
                  <span class="tutorial-trigger-icon">${tutorialIcon('my-progress')}</span>
                </button>
              </div>
              <div class="settings-row-desc">${t('renderpages_settings_myprogress_desc')}</div>
            </div>
            ${tog('showPageProgress')}
          </div>

          <div class="settings-divider"></div>
          <div class="settings-row">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_notes_label')}</div>
              <div class="settings-row-desc">${t('renderpages_settings_notes_desc')}</div>
            </div>
            ${tog('showPageNotes')}
          </div>

          <div class="settings-divider"></div>
          <div class="settings-row">
            <div class="settings-row-text">
              <div class="settings-row-label">
                ${t('renderpages_settings_leaders_label')}
                <button class="howto-tutorial-btn" data-tutorial-id="leaders-notes"
                        onclick="showFeatureTutorial('leaders-notes', () => { Router.replaceState({ page: 'settings', tabId: 'app' }); renderSettings('app'); })">
                  <span class="tutorial-trigger-icon">${tutorialIcon('leaders-notes')}</span>
                </button>
              </div>
              <div class="settings-row-desc">${t('renderpages_settings_leaders_desc')}</div>
            </div>
            ${tog('showPageLeaders')}
          </div>

          ${adv ? `
          <div class="settings-divider"></div>
          <div class="settings-row">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_howto_label')}</div>
              <div class="settings-row-desc">${t('renderpages_settings_howto_desc')}</div>
            </div>
            ${tog('showPageHowToUse')}
          </div>

          <div class="settings-divider"></div>
          <div class="settings-row">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_about_label')}</div>
              <div class="settings-row-desc">${t('renderpages_settings_about_desc')}</div>
            </div>
            ${tog('showPageAbout')}
          </div>` : ''}
        </div>
      </div>` : '';

    // ── Saving & Sharing — Auto-save always shown; Share format Advanced only ──
    const savingSection = `
      <div class="settings-section">
        <div class="settings-section-heading">${t('renderpages_settings_saving_heading')}</div>
        <div class="settings-block">
          <div class="settings-row">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_autosave_label')}</div>
              <div class="settings-row-desc">${t('renderpages_settings_autosave_desc')}</div>
            </div>
            ${tog('autoSaveToast')}
          </div>
          ${adv ? `
          <div class="settings-divider"></div>
          <div class="settings-row">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_shareformat_label')}</div>
              <div class="settings-row-desc">${t('renderpages_settings_shareformat_desc')}</div>
            </div>
          </div>
          <div class="settings-seg" style="margin-top:8px;">
            <button class="settings-seg-btn ${appSettings.shareFormat === 'plain' ? 'active' : ''}"
              data-setting-key="shareFormat" data-setting-value="plain"
              onclick="saveSetting('shareFormat', 'plain')">${t('renderpages_settings_shareformat_plain')}</button>
            <button class="settings-seg-btn ${appSettings.shareFormat === 'formatted' ? 'active' : ''}"
              data-setting-key="shareFormat" data-setting-value="formatted"
              onclick="saveSetting('shareFormat', 'formatted')">${t('renderpages_settings_shareformat_whatsapp')}</button>
          </div>` : ''}
        </div>
      </div>`;

    // ── Read Aloud — Advanced only ────────────────────────────────────────────
    const ttsSection = adv ? `
      <div class="settings-section">
        <div class="settings-section-heading">
          ${t('renderpages_settings_readaloud_heading')}
          <button class="howto-tutorial-btn" data-tutorial-id="read-aloud"
                  onclick="showFeatureTutorial('read-aloud', () => { Router.replaceState({ page: 'settings', tabId: 'app' }); renderSettings('app'); })">
            <span class="tutorial-trigger-icon">${tutorialIcon('read-aloud')}</span>
          </button>
        </div>
        <div class="settings-block">
          <div class="settings-row-desc" style="margin-bottom:12px;">
            ${t('renderpages_settings_readaloud_desc')}
          </div>
          <div class="settings-row" style="flex-direction:column; align-items:stretch; gap:10px;">
            <div class="settings-seg">
              <button class="settings-seg-btn ${appSettings.ttsMode === 'never' ? 'active' : ''}"
                data-setting-key="ttsMode" data-setting-value="never"
                onclick="saveSetting('ttsMode','never')">${t('renderpages_settings_tts_never')}</button>
              <button class="settings-seg-btn ${appSettings.ttsMode === 'long' ? 'active' : ''}"
                data-setting-key="ttsMode" data-setting-value="long"
                onclick="saveSetting('ttsMode','long')">${t('renderpages_settings_tts_long')}</button>
              <button class="settings-seg-btn ${appSettings.ttsMode === 'always' ? 'active' : ''}"
                data-setting-key="ttsMode" data-setting-value="always"
                onclick="saveSetting('ttsMode','always')">${t('renderpages_settings_tts_always')}</button>
            </div>
          </div>
        </div>
      </div>` : '';

    // ── Answer Check Button — Advanced only ──────────────────────────────────
    const checkAnswerSection = adv ? `
      <div class="settings-section">
        <div class="settings-section-heading">${t('renderpages_settings_answerchecking_heading')}</div>
        <div class="settings-block">
          <div class="settings-row">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_answerbtn_label')}</div>
              <div class="settings-row-desc">${t('renderpages_settings_answerbtn_desc')}</div>
            </div>
            ${tog('showCheckAnswerBtn')}
          </div>
        </div>
      </div>` : '';

    // ── App Version & Updates — always shown ──────────────────────────────────────
    const platform = getPlatform();

    const appStoreButton = (() => {
      if (platform === 'android') {
        const pkg        = window.appAboutData?.androidPackageId;
        const playUrl    = `https://play.google.com/store/apps/details?id=${pkg}`;
        const intentUrl  = `market://details?id=${pkg}`;
        const onclick    = `window.Android?.openUrl ? Android.openUrl('${intentUrl}') : window.open('${playUrl}', '_blank')`;
        return `<button class="howto-share-btn" style="margin:0 0 4px;" onclick="${onclick}">
                  ${ICONS.download}&nbsp;${t('renderpages_settings_appupdates_btn_android')}
                </button>`;
      }
      if (platform === 'ios') {
        return `<button class="howto-share-btn" style="margin:0 0 4px; opacity:0.45; cursor:default;" disabled>
                  ${ICONS.download}&nbsp;${t('renderpages_settings_appupdates_btn_ios')}
                </button>`;
      }
      // 'web' — no store button; the app is Android/iOS only
      return '';
    })();

    const appVersionSection = `
      <div class="settings-section">
        <div class="settings-section-heading">${t('renderpages_settings_appversion_heading')}</div>
        <div class="settings-block">
          <div class="settings-row">
            <div class="settings-row-text">
              <div class="settings-row-label">${window.appAboutData?.appTitle || 'Data loading error'}</div>
              <div class="settings-row-label">${t('renderpages_settings_installed_version', { version: window.appAboutData?.appVersion || t('renderpages_settings_version_unknown') })}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-heading">${t('renderpages_settings_appupdates_heading')}</div>
        <div class="settings-block">
          <div class="settings-row">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_appupdates_label')}</div>
              <div class="settings-row-desc">${t('renderpages_settings_appupdates_body_' + platform)}</div>
            </div>
          </div>
          ${appStoreButton ? `
          <div class="settings-row" style="flex-direction:column; align-items:stretch; gap:10px;">
            ${appStoreButton}
          </div>` : ''}
        </div>
      </div>`;

    // ── Interface Mode — always at the bottom of the App tab ───────────────── 
    const interfaceModePopupHtml =
      `<p><b>Basic.</b> A clean, uncluttered experience. Everything you need to read and answer questions, nothing extra. You get:</p>` +
      `<ul><li>Text Size</li><li>Dark Mode</li><li>The progress bar</li><li>Swipe Sensitivity</li></ul>` +
      `<p><br><b>Intermediate</b> adds:</p>` +
      `<ul>` +
      `<li><em>Remember my place</em> — returns you to your last chapter on restart</li>` +
      `<li><em>Reading font</em> — choose between serif and sans-serif</li>` +
      `<li><em>Answer box size</em> — set how tall answer fields start</li>` +
      `<li><em>Optional pages</em> — turn on My Progress, Notes &amp; Comments, and Leaders’ Notes</li>` +
      `<li><em>Library tab</em> in Settings — control which Library tabs are visible</li>` +
      `<li><em>Auto-save notification</em> — a brief confirmation when answers are auto-saved</li>` +
      `</ul>` +
      `<p><br><b>Advanced</b> adds everything else:</p>` +
      `<ul>` +
      `<li><em>Icon style</em> — choose your preferred icon set</li>` +
      `<li><em>Next / Previous buttons</em> — show chapter navigation buttons (in addition to swiping)</li>` +
      `<li><em>How to Use</em> and <em>About</em> pages — toggle these optional pages on or off</li>` +
      `<li><em>Share format</em> — choose between WhatsApp Formatted and Plain Text</li>` +
      `<li><em>Read Aloud</em> — control when the speaker icon appears on passages to let the app read them aloud</li>` +
      `</ul>` +
      `<p>You can switch modes at any time. Moving to a simpler mode hides settings but never loses your data.</p>`;

    window._interfaceModePopupHtml = interfaceModePopupHtml;

    const interfaceModeSection = `
      <div class="settings-section">
        <div class="settings-section-heading">
          ${t('renderpages_settings_interfacemode_heading')}
          <button class="info-trigger-btn" style="margin-left:6px;"
            onclick="openInfoModal('interface-mode-intro', {title: t('renderpages_settings_interfacemode_heading'), body: window._interfaceModePopupHtml}, this)">${ICONS.triggerInfo}</button>
          <button class="howto-tutorial-btn" data-tutorial-id="interface-mode"
                  onclick="showFeatureTutorial('interface-mode', () => { Router.replaceState({ page: 'settings', tabId: 'app' }); renderSettings('app'); })">
            <span class="tutorial-trigger-icon">${tutorialIcon('interface-mode')}</span>
          </button>
        </div>
        <div class="settings-block">
          <div class="settings-row-desc" style="margin-bottom:12px;">
            ${t('renderpages_settings_interfacemode_chooser_desc')}
          </div>
          <div class="settings-row" style="flex-direction:column; align-items:stretch; gap:10px;">
            <div class="settings-seg">
              <button class="settings-seg-btn ${mode === 'basic'        ? 'active' : ''}"
                data-setting-key="interfaceMode" data-setting-value="basic"
                onclick="setInterfaceMode('basic'); Router.replaceState({ page: 'settings', tabId: 'app' }); renderSettings('app')">${t('renderpages_settings_mode_basic')}</button>
              <button class="settings-seg-btn ${mode === 'intermediate' ? 'active' : ''}"
                data-setting-key="interfaceMode" data-setting-value="intermediate"
                onclick="setInterfaceMode('intermediate'); Router.replaceState({ page: 'settings', tabId: 'app' }); renderSettings('app')">${t('renderpages_settings_mode_intermediate')}</button>
              <button class="settings-seg-btn ${mode === 'advanced'     ? 'active' : ''}"
                data-setting-key="interfaceMode" data-setting-value="advanced"
                onclick="setInterfaceMode('advanced'); Router.replaceState({ page: 'settings', tabId: 'app' }); renderSettings('app')">${t('renderpages_settings_mode_advanced')}</button>
            </div>
          </div>
          <div class="settings-row-desc" style="margin-top:10px; font-size:0.82rem;">
            ${mode === 'basic'
              ? `<b>${t('renderpages_settings_mode_basic')}</b> — ${t('renderpages_settings_mode_basic_desc')}`
              : mode === 'intermediate'
              ? `<b>${t('renderpages_settings_mode_intermediate')}</b> — ${t('renderpages_settings_mode_intermediate_desc')}`
              : `<b>${t('renderpages_settings_mode_advanced')}</b> — ${t('renderpages_settings_mode_advanced_desc')}`}
          </div>
        </div>
      </div>`;

    return `
      <!-- TEXT SIZE -->
      <div class="settings-section">
        <div class="settings-section-heading">${t('renderpages_settings_textsize_heading')}</div>
        <div class="settings-block">
          <div class="settings-preview" id="settings-preview">
            ${t('renderpages_settings_textsize_preview')}
          </div>
          <div class="settings-size-row">
            <button class="settings-size-btn" id="settings-btn-minus"
              onclick="setFontSize(Math.max(FONT_MIN, appSettings.fontSize - FONT_STEP))">
              A<span style="font-size:14px; vertical-align:sub;">&#8722;</span>
            </button>
            <div class="settings-size-track">${dotsHtml}</div>
            <button class="settings-size-btn" id="settings-btn-plus"
              onclick="setFontSize(Math.min(FONT_MAX, appSettings.fontSize + FONT_STEP))">
              A<span style="font-size:18px; vertical-align:super;">+</span>
            </button>
          </div>
          <div class="settings-size-label" id="settings-size-label">${appSettings.fontSize}px</div>
          <button class="settings-font-max-btn" onclick="setFontSize(${FONT_MAX})"
            style="font-size:${FONT_MAX}px;">
            ${t('renderpages_settings_textsize_makebig')}
          </button>
          <button class="settings-font-reset-btn" onclick="setFontSize(${FONT_DEFAULT})"
            style="font-size:${FONT_DEFAULT}px;">
            ${t('renderpages_settings_textsize_reset', { size: FONT_DEFAULT })}
          </button>
        </div>
      </div>

      <!-- APPEARANCE -->
      <div class="settings-section">
        <div class="settings-section-heading" id="settings-heading-appearance">${t('renderpages_settings_appearance_heading')}</div>
        <div class="settings-block">
          ${appearanceRows}
        </div>
      </div>

      ${navSection}
      ${answerCheckModeSection}
      ${answerBoxSection}
      ${optionalPagesSection}
      ${savingSection}
      ${ttsSection}
      ${checkAnswerSection}
      ${appVersionSection}
      ${interfaceModeSection}`;
  }

  // ── Tab: Study ─────────────────────────────────────────────────────────────
  function tabStudy() {
    const adv = getInterfaceMode() === 'advanced';
    return `
      <!-- DATA -->
      <div class="settings-section">
        <div class="settings-section-heading">${t('renderpages_settings_data_heading')}</div>

        <div class="settings-block" style="margin-bottom:10px;">
          <div class="settings-row-label" style="margin-bottom:4px;">
            ${t('renderpages_settings_shareall_label')}
            <button class="howto-tutorial-btn" data-tutorial-id="sharing"
                    onclick="showFeatureTutorial('sharing', () => { Router.replaceState({ page: 'settings', tabId: 'study' }); renderSettings('study'); })">
              <span class="tutorial-trigger-icon">${tutorialIcon('sharing')}</span>
            </button>
          </div>
          <div class="settings-row-desc">
            ${t('renderpages_settings_shareall_desc')}
          </div>
          <button class="howto-share-btn settings-export-btn" onclick="exportAllAnswers()">
            &#128228; ${t('renderpages_settings_shareall_btn')}
          </button>
        </div>

        <div class="settings-block" style="margin-bottom:10px;">
          <div class="settings-row-label" style="margin-bottom:4px;">${t('renderpages_settings_printall_label')}</div>
          <div class="settings-row-desc">
            ${t('renderpages_settings_printall_desc')}
          </div>
          <button class="howto-share-btn settings-export-btn" onclick="printAllChapters()">
            &#128424; ${t('renderpages_settings_printall_btn')}
          </button>
        </div>

        <div class="settings-block" style="margin-bottom:10px;">
          <div class="settings-row-label" style="margin-bottom:4px;">${t('renderpages_settings_printblank_label')}</div>
          <div class="settings-row-desc">
            ${t('renderpages_settings_printblank_desc')}
          </div>
          <button class="howto-share-btn settings-export-btn" onclick="printBlankStudy()">
            &#128462; ${t('renderpages_settings_printblank_btn')}
          </button>
        </div>
      </div>

      ${adv ? `
      <!-- RESET -->
      <div class="settings-section">
        <div class="settings-section-heading">${t('renderpages_settings_reset_heading')}</div>

        <div class="settings-block" style="margin-bottom:10px;">
          <div class="settings-row-label" style="margin-bottom:4px;">${t('renderpages_settings_resetsettings_label')}</div>
          <div class="settings-row-desc">
            ${t('renderpages_settings_resetsettings_desc')}
          </div>
          <button class="settings-danger-btn" onclick="resetToDefaults()">
            &#8635; ${t('renderpages_settings_resetsettings_btn')}
          </button>
        </div>

        <div class="settings-warn-box">
          <div class="settings-warn-box-label">
            &#9888; ${t('renderpages_settings_warning_label')}
          </div>
          <div class="settings-warn-box-body">
            ${t('renderpages_settings_clearwarning_text')}
          </div>
        </div>

        <div class="settings-warn-box">
          <div class="settings-warn-box-label">
            &#9888;&#9888; ${t('renderpages_settings_nuclear_warning_label')}
          </div>
          <div class="settings-warn-box-body">
            ${t('renderpages_settings_nuclear_warning_text')}
          </div>
        </div>

      </div>` : ''}`;
  }

  // ── Tab: Library ───────────────────────────────────────────────────────────
  // Shown in Intermediate (Recent setting only) and Advanced (all settings).
  function tabLibrary() {
    const adv = getInterfaceMode() === 'advanced';
    const r  = appSettings.libShowRecent      || '>5';
    const s  = appSettings.libShowShelvesTab  || '>8';
    const pt = appSettings.libShowPathsTab    || '>2';
    const pa = appSettings.libShowPathsAmount || 'few';
    return `
      <div class="settings-section">
        <div class="settings-section-heading">${t('renderpages_settings_recent_heading')}</div>
        <div class="settings-block">

          <div class="settings-row" style="flex-direction:column; align-items:stretch; gap:10px;">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_recent_label')}</div>
              <div class="settings-row-desc">${t('renderpages_settings_recent_desc')}</div>
            </div>
            <div class="settings-seg">
              <button class="settings-seg-btn ${r === 'off' ? 'active' : ''}"
                data-setting-key="libShowRecent" data-setting-value="off"
                onclick="saveSetting('libShowRecent', 'off')">${t('renderpages_settings_visibility_off')}</button>
              <button class="settings-seg-btn ${r === '>5'  ? 'active' : ''}"
                data-setting-key="libShowRecent" data-setting-value=">5"
                onclick="saveSetting('libShowRecent', '>5')">&gt;5</button>
              <button class="settings-seg-btn ${r === 'on'  ? 'active' : ''}"
                data-setting-key="libShowRecent" data-setting-value="on"
                onclick="saveSetting('libShowRecent', 'on')">${t('renderpages_settings_visibility_on')}</button>
            </div>
          </div>
        </div>
          
        <div class="settings-section-heading">${t('renderpages_settings_shelves_heading')}</div>
        <div class="settings-block">

          <div class="settings-row" style="flex-direction:column; align-items:stretch; gap:10px;">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_shelves_label')}</div>
              <div class="settings-row-desc">${t('renderpages_settings_shelves_desc')}</div>
            </div>
            <div class="settings-seg">
              <button class="settings-seg-btn ${s === 'off' ? 'active' : ''}"
                data-setting-key="libShowShelvesTab" data-setting-value="off"
                onclick="saveSetting('libShowShelvesTab', 'off')">${t('renderpages_settings_visibility_off')}</button>
              <button class="settings-seg-btn ${s === '>8'  ? 'active' : ''}"
                data-setting-key="libShowShelvesTab" data-setting-value=">8"
                onclick="saveSetting('libShowShelvesTab', '>8')">&gt;8</button>
              <button class="settings-seg-btn ${s === 'on'  ? 'active' : ''}"
                data-setting-key="libShowShelvesTab" data-setting-value="on"
                onclick="saveSetting('libShowShelvesTab', 'on')">${t('renderpages_settings_visibility_on')}</button>
            </div>
          </div>

          ${adv ? `
          <div class="settings-divider"></div>

          <div class="settings-row" style="flex-direction:column; align-items:stretch; gap:10px;">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_emptyshelves_label')}</div>
              <div class="settings-row-desc">${t('renderpages_settings_emptyshelves_desc')}</div>
            </div>
            <div class="settings-seg">
              <button class="settings-seg-btn ${appSettings.libShowEmptyAmount === 'none' ? 'active' : ''}"
                data-setting-key="libShowEmptyAmount" data-setting-value="none"
                onclick="saveSetting('libShowEmptyAmount', 'none')">${t('renderpages_settings_amount_none')}</button>
              <button class="settings-seg-btn ${appSettings.libShowEmptyAmount === 'few'  ? 'active' : ''}"
                data-setting-key="libShowEmptyAmount" data-setting-value="few"
                onclick="saveSetting('libShowEmptyAmount', 'few')">${t('renderpages_settings_amount_few')}</button>
              <button class="settings-seg-btn ${appSettings.libShowEmptyAmount === 'many' ? 'active' : ''}"
                data-setting-key="libShowEmptyAmount" data-setting-value="many"
                onclick="saveSetting('libShowEmptyAmount', 'many')">${t('renderpages_settings_amount_many')}</button>
              <button class="settings-seg-btn ${appSettings.libShowEmptyAmount === 'all'  ? 'active' : ''}"
                data-setting-key="libShowEmptyAmount" data-setting-value="all"
                onclick="saveSetting('libShowEmptyAmount', 'all')">${t('renderpages_settings_amount_all')}</button>
            </div>
          </div>` : ''}
        </div>
          
        <div class="settings-section-heading">${t('renderpages_settings_paths_heading')}</div>
        <div class="settings-block">

          <div class="settings-row" style="flex-direction:column; align-items:stretch; gap:10px;">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_paths_label')}</div>
              <div class="settings-row-desc">${t('renderpages_settings_paths_desc')}</div>
            </div>
            <div class="settings-seg">
              <button class="settings-seg-btn ${pt === 'off' ? 'active' : ''}"
                data-setting-key="libShowPathsTab" data-setting-value="off"
                onclick="saveSetting('libShowPathsTab', 'off')">${t('renderpages_settings_visibility_off')}</button>
              <button class="settings-seg-btn ${pt === '>2'  ? 'active' : ''}"
                data-setting-key="libShowPathsTab" data-setting-value=">2"
                onclick="saveSetting('libShowPathsTab', '>2')">&gt;2</button>
              <button class="settings-seg-btn ${pt === 'on'  ? 'active' : ''}"
                data-setting-key="libShowPathsTab" data-setting-value="on"
                onclick="saveSetting('libShowPathsTab', 'on')">${t('renderpages_settings_visibility_on')}</button>
            </div>
          </div>

          ${adv ? `
          <div class="settings-divider"></div>

          <div class="settings-row" style="flex-direction:column; align-items:stretch; gap:10px;">
            <div class="settings-row-text">
              <div class="settings-row-label">${t('renderpages_settings_pathsamount_label')}</div>
              <div class="settings-row-desc">${t('renderpages_settings_pathsamount_desc')}</div>
            </div>
            <div class="settings-seg">
              <button class="settings-seg-btn ${pa === 'one' ? 'active' : ''}"
                data-setting-key="libShowPathsAmount" data-setting-value="one"
                onclick="saveSetting('libShowPathsAmount', 'one')">${t('renderpages_settings_pathsamount_one')}</button>
              <button class="settings-seg-btn ${pa === 'few'  ? 'active' : ''}"
                data-setting-key="libShowPathsAmount" data-setting-value="few"
                onclick="saveSetting('libShowPathsAmount', 'few')">${t('renderpages_settings_amount_few')}</button>
              <button class="settings-seg-btn ${pa === 'many' ? 'active' : ''}"
                data-setting-key="libShowPathsAmount" data-setting-value="many"
                onclick="saveSetting('libShowPathsAmount', 'many')">${t('renderpages_settings_amount_many')}</button>
              <button class="settings-seg-btn ${pa === 'all'  ? 'active' : ''}"
                data-setting-key="libShowPathsAmount" data-setting-value="all"
                onclick="saveSetting('libShowPathsAmount', 'all')">${t('renderpages_settings_amount_all')}</button>
            </div>
          </div>` : ''}

        </div>
      </div>`;
  }

  // ── Tab: Language ──────────────────────────────────────────────────────────
  function tabLanguage() {
    const activeLang = window.appLocale || resolveLanguage();

    const groups = [
      { key: 'europe', codes: ['en', 'fr', 'es', 'pt'] },
      { key: 'africa', codes: ['ha', 'ig', 'yo', 'ff', 'sw', 'am', 'lg'] },
      { key: 'asia',   codes: ['ne', 'ms', 'my', 'ur', 'tl', 'ar', 'zh-CN'] },
    ];

    const groupsHtml = groups.map(group => `
      <div class="settings-block" style="margin-bottom:10px;">
        <div class="settings-row-desc" style="margin-bottom:8px; text-transform:uppercase;
             font-size:0.72rem; letter-spacing:0.08em; color:var(--text-secondary);">
          ${t('renderpages_settings_language_group_' + group.key)}
        </div>
        ${group.codes.map(code => {
          const lang     = LANGUAGE_MAP[code];
          const isActive = code === activeLang;
          return `
        <button
          class="settings-lang-btn${isActive ? ' active' : ''}"
          onclick="setLanguage('${code}'); Router.replaceState({ page: 'settings', tabId: 'language' }); renderSettings('language')"
          aria-pressed="${isActive}"
        >
          <span class="settings-lang-flag">${lang.alwaysBadge ? renderLangBadge(lang) : lang.flag}</span>
          <span class="settings-lang-label">${lang.label}</span>
          ${isActive ? '<span class="settings-lang-check">✓</span>' : ''}
        </button>`;
        }).join('')}
      </div>`).join('');

    return `
      <div class="settings-section">
        <div class="settings-section-heading">${t('renderpages_settings_language_heading')}</div>
        <div class="settings-row-desc" style="margin-bottom:16px;">
          ${t('renderpages_settings_language_desc')}
        </div>
        ${groupsHtml}
      </div>`;
  }

  // ── Tab dispatch ───────────────────────────────────────────────────────────
  const tabContentFns = {
    app:      tabApp,
    study:    tabStudy,
    language: tabLanguage,
    library:  tabLibrary,
  };

  const tabBarHtml = `
    <div class="howto-tab-bar" id="settingsTabBar">
      ${SETTINGS_TABS.map(t => `
        <button
          class="howto-tab${t.id === activeTab ? ' active' : ''}"
          onclick="Router.replaceState({ page: 'settings', tabId: '${t.id}' }); renderSettings('${t.id}')"
        >${typeof t.label === 'function' ? t.label() : t.label}</button>`).join('')}
    </div>`;

  const tabContent = (tabContentFns[activeTab] || tabApp)();

  content.innerHTML = `
    <div class="settings-page">

      <div class="settings-header">
        <div class="settings-eyebrow">${t('renderpages_settings_eyebrow')}</div>
        <div class="settings-title">${t('renderpages_settings_title')}</div>
      </div>
      <div style="height:1px; background:var(--border);"></div>

      ${tabBarHtml}

      <div id="settingsTabContent">
        ${tabContent}
      </div>

      <div class="page-close-bar">
        <button class="page-close-btn" onclick="Router.back()"><span>&#10005;</span> ${t('renderpages_close_btn')}</button>
      </div>

      <div style="height:40px;"></div>
    </div>
  `;

  window.scrollTo(0, 0);
  updateSettingsControls();
  if (activeTab === 'app') {
    createInfoTrigger(
      'interface-mode-intro',
      {
        title: t('renderpages_settings_wantmore_title'),
        body:  t('renderpages_settings_wantmore_body')
      },
      {
        placement:      'floating',
        headingElement: document.getElementById('settings-heading-appearance')
      }
    );
  }
}

// ── RENDER LEADERS' NOTES PAGE ───────────────────────────────────────────────
// Renders the Leaders' Notes page — pastoral guidance for group leaders,
// with key teaching points and sensitivities for each chapter.
// Intended for leaders/mentors; accessible from the Contents menu but not
// highlighted in the main user flow.
//
// Multilingual studies: all content fields (subtitle, intro, keyPoints,
// pastorals, watch) are resolved for the active language via resolveMetaField().
// A lang bar (same visual pattern as the chapter lang bar) is shown when two or
// more languages are available, and shares window._activeStudyLang with the
// chapter pages and the How To Use Study tab.
//
// Mono-lingual studies: langMap is empty, resolveMetaField falls through to
// unnumbered fields (d.intro, ch.keyPoints, etc.), behaviour is unchanged.
const LEADERS_TABS = []; // populated dynamically — see renderLeadersNotes

async function renderLeadersNotes(tabId) {
  closeMenu();
  _resetNonChapterPageState();
  // Note: clearStudyUiLangOverride() is intentionally NOT called here.
  // Leaders Notes carries its own lang bar and shares window._activeStudyLang
  // with chapter pages. clearStudyUiLangOverride() is still called by
  // renderSettings, renderAbout, and openLibrary.
  isNonChapterPage = true;
  window.activeTabPage = 'leaders';
  restoreStudyTheme();
  const content = document.getElementById('mainContent');
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.parentElement.style.display = 'none';
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('header-title').innerText = t('renderpages_header_leaders');

  const d = leadersNotesData;

  // ── Language resolution ───────────────────────────────────────────────────
  const availableLangs = detectAvailableLangs();
  const activeLang     = getActiveLang(availableLangs) || 'en';
  const langMap        = buildLangMap(window.studyMetadata || {});

  // ── Lang bar HTML (hidden for mono-lingual studies) ───────────────────────
  const langBarHtml = (() => {
    if (availableLangs.length < 2) return '';

    const flagCounts = {};
    availableLangs.forEach(code => {
      const f = LANGUAGE_MAP[code]?.flag;
      if (f) flagCounts[f] = (flagCounts[f] || 0) + 1;
    });

    const buttons = availableLangs.map(code => {
      const entry      = LANGUAGE_MAP[code];
      const label      = entry?.label || code.toUpperCase();
      const flagShared = entry && flagCounts[entry.flag] > 1;
      const display    = ((flagShared || entry?.alwaysBadge) && entry?.badge)
        ? renderLangBadge(entry)
        : (entry?.flag || '🌐');
      return `<button class="lib-lang-btn${activeLang === code ? ' active' : ''}"
                       onclick="setPageStudyLang('${code}', () => { Router.replaceState({ page: 'leaders', tabId: window.activeTabId }); renderLeadersNotes(window.activeTabId); })"
                       aria-label="${label}"
                       title="${label}">${display}</button>`;
    }).join('');

    return `<div class="leaders-lang-bar">${buttons}</div>`;
  })();

  // ── Resolve intro — may be a string or an array of paragraph strings ──────
  // Multilingual: d.intro1/d.intro2/… — mono-lingual: d.intro (string or array)
  const rawIntro   = resolveMetaField(d, 'intro', activeLang, langMap);
  const hasIntro   = !!(typeof rawIntro === 'string'
    ? rawIntro.trim()
    : (Array.isArray(rawIntro) ? rawIntro.join('').trim() : ''));

  // Build tab definitions once and cache on the constant so navigateTab() can use it
  LEADERS_TABS.length = 0;
  if (hasIntro) LEADERS_TABS.push({ id: 'intro', label: 'Intro' });
  (d.chapters || []).forEach(ch => LEADERS_TABS.push({ id: `ch_${ch.chapterNumber}`, label: String(ch.chapterNumber) }));

  const activeTab = tabId || (LEADERS_TABS[0] && LEADERS_TABS[0].id) || 'intro';
  window.activeTabId = activeTab;

  const tabBarHtml = `
    <div class="howto-tab-bar" id="leadersTabBar">
      ${LEADERS_TABS.map(t => `
        <button
          class="howto-tab${t.id === activeTab ? ' active' : ''}"
          onclick="Router.replaceState({ page: 'leaders', tabId: '${t.id}' }); renderLeadersNotes('${t.id}')"
        >${t.label}</button>`).join('')}
    </div>`;

  let tabContent = '';
  if (activeTab === 'intro' && hasIntro) {
    const introFormat = d.format;
    const introHtml = typeof rawIntro === 'string'
      ? renderFormatted(rawIntro, introFormat)
      : renderFormattedArray(rawIntro, introFormat);
    tabContent = `
      <div class="leaders-intro" style="margin:20px 16px;">
        ${introHtml}
      </div>`;
  } else {
    const chNum = activeTab.startsWith('ch_') ? parseInt(activeTab.slice(3), 10) : null;
    const ch = (d.chapters || []).find(c => c.chapterNumber === chNum);
    if (ch) {
      // Resolve the chapter title for the active language.
      // Supports both 'chapterTitle' (old field name) and 'title' (new field name),
      // with a fallback to window.chapters for studies that omit it entirely.
      const chapterTitle = resolveMetaField(ch, 'title', activeLang, langMap)
        || resolveMetaField(ch, 'chapterTitle', activeLang, langMap)
        || (window.chapters || []).find(c => c.chapterNumber === ch.chapterNumber)?.chapterTitle
        || '';

      // ── Discover content field base names in JSON insertion order ────────────────────
      // Strip trailing digits from every key to get the base name, deduplicate
      // while preserving first-seen order, then skip the structural fields that
      // are rendered separately (chapterNumber, format, title/chapterTitle).
      const SKIP = new Set(['chapterNumber', 'format', 'title', 'chapterTitle']);
      const seen = new Set();
      const contentFields = [];
      for (const key of Object.keys(ch)) {
        const base = key.replace(/\d+$/, '');
        if (!SKIP.has(base) && !seen.has(base)) {
          seen.add(base);
          contentFields.push(base);
        }
      }

      // ── Render each content field ─────────────────────────────────────────────────────
      // resolveMetaField returns the object stored at the resolved slot
      // (e.g. background1 for lang slot 1), which has shape:
      //   { subtype: 'standard' | 'highlighted', header: string, body: string }
      //
      // subtype 'standard'    → leaders-block with optional header label above body
      // subtype 'highlighted' → leaders-watch wrapper (no header rendered if empty)
      //
      // Body text is rendered via renderFormatted(), using the chapter-level format
      // with a fallback to the top-level leadersNotesData format.
      const blockFormat = ch.format || d.format;
      const blocksHtml = contentFields.map(field => {
        const resolved = resolveMetaField(ch, field, activeLang, langMap);
        if (!resolved || typeof resolved !== 'object') return '';

        const { subtype, header, body } = resolved;

        if (subtype === 'highlighted') {
          if (!body) return '';
          const headerHtml = header
            ? `<div class="leaders-block-label">${header}</div>`
            : '';
          return `
          <div class="leaders-block">
            ${headerHtml}
            <div class="leaders-watch">${renderFormatted(body, blockFormat)}</div>
          </div>`;
        }

        // Default: 'standard' (or any unrecognised subtype)
        const headerHtml = header
          ? `<div class="leaders-block-label">${header}</div>`
          : '';
        return `
          <div class="leaders-block">
            ${headerHtml}
            ${renderFormatted(body, blockFormat)}
          </div>`;
      }).join('\n');

      tabContent = `
        <div class="leaders-chapter" style="margin-top:16px;">
          <div class="leaders-chapter-header">
            <span class="leaders-chapter-number">${t('renderpages_leaders_chapter_label', { number: ch.chapterNumber })}</span>
            <span class="leaders-chapter-title">${chapterTitle}</span>
          </div>
          <div class="leaders-chapter-body">
            ${blocksHtml}
          </div>
        </div>`;
    }
  }

  // Resolve the page subtitle for the active language.
  // Multilingual: subtitle1/subtitle2/… — mono-lingual: subtitle (unchanged).
  const subtitle = resolveMetaField(d, 'subtitle', activeLang, langMap);

  content.innerHTML = `
    <div class="leaders-page">
      <div class="howto-header">
        <div class="howto-eyebrow">${t('renderpages_leaders_eyebrow')}</div>
        <div class="howto-title">${t('renderpages_leaders_title')}${subtitle ? ` — ${subtitle}` : ''}</div>
      </div>

      ${langBarHtml}

      ${tabBarHtml}

      <div id="leadersTabContent">
        ${tabContent}
      </div>

      <div class="leaders-confidential">${t('renderpages_leaders_confidential')}</div>
      <div class="page-close-bar">
        <button class="page-close-btn" onclick="Router.back()"><span>${ICONS.close}</span> ${t('renderpages_close_btn')}</button>
      </div>
      <div style="height: 40px;"></div>
    </div>
  `;
  window.scrollTo(0, 0);
}


// ── HELPER FUNCTIONS ─────────────────────────────────────────────────────────
// Renders the About page with author bio and publisher info.
// scrollToPublisher: if true, smoothly scrolls to the publisher section
// after render (used when the publisher logo on the title page is tapped).
const ABOUT_TABS = [
  { id: 'author',    label: () => t('renderpages_tab_author')    },
  { id: 'publisher', label: () => t('renderpages_tab_publisher') },
  { id: 'copyright', label: () => t('renderpages_tab_copyright') },
];

// Progress page has two tabs, but only renders them when a pathway is active.
// navigateTab() guards against the no-pathway case before calling switchProgressTab().
const PROGRESS_TABS = [
  { id: 'study'   },
  { id: 'pathway' },
];

async function renderAbout(tabId) {
  closeMenu();
  _resetNonChapterPageState();
  await clearStudyUiLangOverride();
  isNonChapterPage = true;
  window.activeTabPage = 'about';
  restoreStudyTheme();
  const content = document.getElementById('mainContent');
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.parentElement.style.display = 'none';
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('header-title').innerText = t('renderpages_header_about');

  const activeTab = tabId || 'author';
  window.activeTabId = activeTab;

  const a = studyAboutData.author;
  const p = studyAboutData.publisher;
  const d = copyrightData;
  const studyTitle = window.titlePageData?.title || '';

  const tabBarHtml = `
    <div class="howto-tab-bar" id="aboutTabBar">
      ${ABOUT_TABS.map(t => `
        <button
          class="howto-tab${t.id === activeTab ? ' active' : ''}"
          onclick="Router.replaceState({ page: 'about', tabId: '${t.id}' }); renderAbout('${t.id}')"
        >${typeof t.label === 'function' ? t.label() : t.label}</button>`).join('')}
    </div>`;

  let tabContent = '';
  if (activeTab === 'author') {
    const authorParas = a.paras.map(t => `<p>${t}</p>`).join('\n');
    tabContent = `
      <div class="copyright-page" style="padding-top:16px;">
        <div class="copyright-block">
          <div class="copyright-block-label">${t('renderpages_about_author_label')}</div>
          <div class="about-photo-wrap">
            <img src="${a.image || ''}" alt="${a.imageAlt || 'Author photo'}"
              class="about-photo" onerror="this.style.display='none'" />
          </div>
          ${authorParas}
        </div>
      </div>`;
  } else if (activeTab === 'publisher') {
    const publishParas = p.paras.map(t => `<p>${t}</p>`).join('\n');
    tabContent = `
      <div class="copyright-page" style="padding-top:16px;">
        <div class="copyright-block">
          <div class="copyright-block-label">${t('renderpages_about_publisher_label', { name: p.name })}</div>
          <img src="${p.image || ''}" alt="${p.imageAlt || p.name || ''}" class="about-publisher-logo" onerror="this.style.display='none'" />
          ${publishParas}
          <p>Find out more at <a href="${p.url}" target="_blank">${p.url.replace('https://','')}</a></p>
        </div>
      </div>`;
  } else if (activeTab === 'copyright') {
    const noticesHtml = (d.notices || []).map(n => `<li>${n}</li>`).join('\n');
    tabContent = `
      <div class="copyright-page" style="padding-top:16px;">
        <div class="copyright-block">
          <div class="copyright-block-label">${t('renderpages_copyright_author_label')}</div>
          <p>${d.authorLine}</p>
          <p>${t('renderpages_copyright_licence_link')}</p>
          <div class="cc-badge">⚖️ CC BY-SA 4.0</div>
        </div>
        <div class="copyright-block">
          <div class="copyright-block-label">${t('renderpages_copyright_freeto_label')}</div>
          <p>${t('renderpages_copyright_share_entry')}</p>
          <p>${t('renderpages_copyright_adapt_entry')}</p>
        </div>
        <div class="copyright-block">
          <div class="copyright-block-label">${t('renderpages_copyright_terms_label')}</div>
          <p>${t('renderpages_copyright_attribution_entry')}</p>
          <p>${t('renderpages_copyright_sharealike_entry')}</p>
        </div>
        ${noticesHtml ? `<div class="copyright-block"><div class="copyright-block-label">${t('renderpages_copyright_notices_label')}</div><ul>${noticesHtml}</ul></div>` : ''}
      </div>`;
  }

  content.innerHTML = `
    <div class="howto-page">
      <div class="howto-header">
        <div class="howto-eyebrow">${studyTitle}</div>
        <div class="howto-title">${t('renderpages_about_title')}</div>
      </div>

      ${tabBarHtml}

      <div id="aboutTabContent">
        ${tabContent}
      </div>

      <div class="page-close-bar">
        <button class="page-close-btn" onclick="Router.back()"><span>${ICONS.close}</span> ${t('renderpages_close_btn')}</button>
      </div>
      <div style="height: 40px;"></div>
    </div>
  `;
  window.scrollTo(0, 0);
}



// ── RENDER GO DEEPER PAGE ────────────────────────────────────────────────────
// Renders the optional "Go Deeper" page — supplementary prose content aimed at
// general readers who want more background on each chapter.
//
// Data source: window.goDeeperData (absent → page never appears anywhere).
// If present, an entry is added to the Contents menu (renderMenu in
// render-progress.js) between Leaders' Notes and About, labelled with
// titleMenuHeading resolved for the active language.
//
// Structure of goDeeperData:
//   format          : "HTML"
//   titleMenuHeading: string  (also used as the page's howto-title)
//   intro           : { header: string, body: string | string[] }
//                     — header becomes the Intro tab label
//                     — body is rendered as <p> tags
//                     Multilingual: intro1/intro2/… slots
//   chapters        : [ { chapterNumber, format, title, key-N: { subtype, header, body } … } ]
//                     Multilingual: title1/title2/…; key-N1/key-N2/… slots
//
// Subtypes:
//   'standard'    → .go-deeper-block with optional header label
//   'highlighted' → .go-deeper-block wrapping a .go-deeper-highlight callout
//
// Tab structure: Intro tab (if intro present) + one numbered tab per chapter.
// If only one tab exists (intro-only or single chapter, no intro), no tab bar
// is rendered — content is shown directly.
//
// Multilingual: shares window._activeStudyLang with chapter pages and
// Leaders' Notes. A lang bar is shown when two or more languages are available.
// clearStudyUiLangOverride() is intentionally NOT called here.

const GODEEPER_TABS = []; // populated dynamically — see renderGoDeeper

async function renderGoDeeper(tabId) {
  closeMenu();
  _resetNonChapterPageState();
  isNonChapterPage = true;
  window.activeTabPage = 'godeeper';
  restoreStudyTheme();

  const content = document.getElementById('mainContent');
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.parentElement.style.display = 'none';
  document.getElementById('progressBar').style.width = '0%';

  const d = window.goDeeperData;
  if (!d) return; // guard: nothing to render if data absent

  // ── Language resolution ───────────────────────────────────────────────────
  const availableLangs = detectAvailableLangs();
  const activeLang     = getActiveLang(availableLangs) || 'en';
  const langMap        = buildLangMap(window.studyMetadata || {});

  // ── Resolve page title (used in header and nav bar) ───────────────────────
  const pageTitle = resolveMetaField(d, 'titleMenuHeading', activeLang, langMap)
    || d.titleMenuHeading || '';
  document.getElementById('header-title').innerText = pageTitle;

  // ── Lang bar HTML (hidden for mono-lingual studies) ───────────────────────
  const langBarHtml = (() => {
    if (availableLangs.length < 2) return '';

    const flagCounts = {};
    availableLangs.forEach(code => {
      const f = LANGUAGE_MAP[code]?.flag;
      if (f) flagCounts[f] = (flagCounts[f] || 0) + 1;
    });

    const buttons = availableLangs.map(code => {
      const entry      = LANGUAGE_MAP[code];
      const label      = entry?.label || code.toUpperCase();
      const flagShared = entry && flagCounts[entry.flag] > 1;
      const display    = ((flagShared || entry?.alwaysBadge) && entry?.badge)
        ? renderLangBadge(entry)
        : (entry?.flag || '🌐');
      return `<button class="lib-lang-btn${activeLang === code ? ' active' : ''}"
                       onclick="setPageStudyLang('${code}', () => { Router.replaceState({ page: 'godeeper', tabId: window.activeTabId }); renderGoDeeper(window.activeTabId); })"
                       aria-label="${label}"
                       title="${label}">${display}</button>`;
    }).join('');

    return `<div class="leaders-lang-bar">${buttons}</div>`;
  })();

  // ── Resolve intro — { header, body } object (or null if absent) ───────────
  // Multilingual: intro1/intro2/… slots; mono-lingual: intro (unnumbered).
  // body may be a string or an array of paragraph strings.
  const rawIntro     = resolveMetaField(d, 'intro', activeLang, langMap);
  const hasIntro     = !!(rawIntro && typeof rawIntro === 'object' && (rawIntro.header || rawIntro.body));
  const introHeader  = hasIntro ? (rawIntro.header || pageTitle) : '';

  // ── Build tab definitions and cache on the constant for navigateTab() ─────
  GODEEPER_TABS.length = 0;
  if (hasIntro) GODEEPER_TABS.push({ id: 'intro', label: introHeader });
  (d.chapters || []).forEach(ch =>
    GODEEPER_TABS.push({ id: `ch_${ch.chapterNumber}`, label: String(ch.chapterNumber) })
  );

  const activeTab = tabId || (GODEEPER_TABS[0] && GODEEPER_TABS[0].id) || 'intro';
  window.activeTabId = activeTab;

  // ── Tab bar (omitted when only one tab exists) ────────────────────────────
  const showTabBar  = GODEEPER_TABS.length > 1;
  const tabBarHtml  = showTabBar ? `
    <div class="howto-tab-bar" id="goDeepTabBar">
      ${GODEEPER_TABS.map(tab => `
        <button
          class="howto-tab${tab.id === activeTab ? ' active' : ''}"
          onclick="Router.replaceState({ page: 'godeeper', tabId: '${tab.id}' }); renderGoDeeper('${tab.id}')"
        >${tab.label}</button>`).join('')}
    </div>` : '';

  // ── Tab content ───────────────────────────────────────────────────────────
  let tabContent = '';

  if (activeTab === 'intro' && hasIntro) {
    // body: string or array of strings; rendered via format-text.js helpers.
    const rawBody  = rawIntro.body;
    const bodyHtml = Array.isArray(rawBody)
      ? renderFormattedArray(rawBody, d.format)
      : renderFormatted(rawBody || '', d.format);

    tabContent = `
      <div class="go-deeper-intro" style="margin: 20px 16px;">
        ${bodyHtml}
      </div>`;

  } else {
    // Chapter tab
    const chNum = activeTab.startsWith('ch_') ? parseInt(activeTab.slice(3), 10) : null;
    const ch    = (d.chapters || []).find(c => c.chapterNumber === chNum);

    if (ch) {
      // Resolve the chapter title for the active language.
      const chapterTitle = resolveMetaField(ch, 'title', activeLang, langMap) || '';

      // ── Discover content field base names in JSON insertion order ──────────
      // Strip trailing digits, deduplicate (first-seen order), skip structural fields.
      const SKIP = new Set(['chapterNumber', 'format', 'title', 'footnotes']);
      const seen = new Set();
      const contentFields = [];
      for (const key of Object.keys(ch)) {
        const base = key.replace(/\d+$/, '');
        if (!SKIP.has(base) && !seen.has(base)) {
          seen.add(base);
          contentFields.push(base);
        }
      }

      // ── Render each content field ──────────────────────────────────────────
      // resolveMetaField returns the object at the resolved slot:
      //   { subtype: 'standard' | 'highlighted', header: string, body: string }
      //
      // subtype 'standard'    → .go-deeper-block with optional header label
      // subtype 'highlighted' → .go-deeper-block wrapping .go-deeper-highlight
      //
      // Body text is rendered via renderFormatted(), using the chapter-level format
      // with a fallback to the top-level goDeeperData format.
      const blockFormat = ch.format || d.format;
      const blocksHtml = contentFields.map(field => {
        const resolved = resolveMetaField(ch, field, activeLang, langMap);
        if (!resolved || typeof resolved !== 'object') return '';

        const { subtype, header, body } = resolved;

        if (subtype === 'highlighted') {
          if (!body) return '';
          const headerHtml = header
            ? `<div class="go-deeper-block-label">${header}</div>`
            : '';
          return `
          <div class="go-deeper-block">
            ${headerHtml}
            <div class="go-deeper-highlight">${renderFormatted(body, blockFormat, ch.footnotes)}</div>
          </div>`;
        }

        // Default: 'standard' (or any unrecognised subtype)
        const headerHtml = header
          ? `<div class="go-deeper-block-label">${header}</div>`
          : '';
        return `
          <div class="go-deeper-block">
            ${headerHtml}
            ${renderFormatted(body, blockFormat, ch.footnotes)}
          </div>`;
      }).join('\n');

      tabContent = `
        <div class="go-deeper-chapter" style="margin-top: 16px;">
          <div class="leaders-chapter-header">
            <span class="leaders-chapter-number">${t('renderpages_leaders_chapter_label', { number: ch.chapterNumber })}</span>
            <span class="leaders-chapter-title">${chapterTitle}</span>
          </div>
          <div class="go-deeper-chapter-body">
            ${blocksHtml}
          </div>
        </div>`;
    }
  }

  // ── Full page render ───────────────────────────────────────────────────────
  content.innerHTML = `
    <div class="go-deeper-page">
      <div class="howto-header">
        <div class="howto-eyebrow">${t('renderpages_leaders_eyebrow')}</div>
        <div class="howto-title">${pageTitle}</div>
      </div>

      ${langBarHtml}

      ${tabBarHtml}

      <div id="goDeeperTabContent">
        ${tabContent}
      </div>

      <div class="page-close-bar">
        <button class="page-close-btn" onclick="Router.back()"><span>${ICONS.close}</span> ${t('renderpages_close_btn')}</button>
      </div>
      <div style="height: 40px;"></div>
    </div>
  `;
  window.scrollTo(0, 0);
}



