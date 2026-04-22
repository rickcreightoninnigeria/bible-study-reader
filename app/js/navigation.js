// ── NAVIGATION ────────────────────────────────────────────────────────────────
// Core navigation functions: moving between chapters, opening/closing the menu
// drawer, and returning from non-chapter pages (settings, progress, etc.).
//
// Dependencies (all available as globals before this file loads):
//   ICONS              – icons.js
//   appSettings        – settings.js
//   currentChapter, isNonChapterPage, menuOpen – main.js STATE section
//   touchstartX, touchendX – share-print.js (neutralised on page close)
//   window.activeTabPage, window.activeTabId,
//   window._titleBeforeMenu – state.js
//   renderChapter, renderTitlePage,
//   renderMenu         – main.js RENDER section (runtime calls only)
//   saveLastPosition, getLastPosition – utils.js
//   closeSearch        – search.js (runtime call only)
//   navProgressClick, navHowtoClick,
//   navSettingsClick, navLibClick – onboarding.js (runtime calls only)

// Navigates to the chapter at idx: closes the menu, renders the chapter,
// refreshes the menu checkmarks, and saves the position if that setting is on.
async function goToChapter(idx, scrollY = 0) {
  currentChapter = idx;
  closeMenu();
  _resetNonChapterPageState();
  await renderChapter(idx, scrollY);
  renderMenu();
  if (appSettings.rememberPosition) saveLastPosition();
}

// Resets the nav button and state flags for whichever non-chapter page is
// currently active (if any). Does NOT navigate anywhere — purely a cleanup
// helper called by goToChapter() and closeNonChapterPage().
// Also neutralises any in-flight swipe from the closing gesture by equalising
// touchstartX and touchendX so handleGesture() computes a delta of zero.
function _resetNonChapterPageState() {
  const page = window.activeTabPage;
  if (page === 'progress') {
    const btn = document.getElementById('navProgressBtn');
    if (btn) { btn.innerHTML = ICONS.progress; btn.onclick = () => navProgressClick(); }
  } else if (page === 'howto') {
    const btn = document.getElementById('navHowtoBtn');
    if (btn) { btn.innerHTML = ICONS.howto; btn.onclick = () => navHowtoClick(); }
  } else if (page === 'settings') {
    const btn = document.getElementById('navSettingsBtn');
    if (btn) { btn.innerHTML = ICONS.settings; btn.onclick = () => navSettingsClick(); }
  } else if (page === 'library') {
    const btn = document.getElementById('navLibBtn');
    if (btn) { btn.innerHTML = ICONS.library; btn.onclick = () => navLibClick(); }
  } else if (page === 'leaders' || page === 'about') {
    // no dedicated nav button — nothing to reset
  }
  window.activeTabPage = null;
  window.activeTabId   = null;
  isNonChapterPage     = false;
  touchstartX = touchendX; // neutralise any in-flight swipe from the closing gesture
}

// Closes the menu drawer and renders the title page.
function goToTitlePage() {
  closeMenu();
  renderTitlePage();
}

// Closes the menu drawer and renders the copyright/licence page.
function goToCopyright() {
  closeMenu();
  renderAbout('copyright');
}

// Toggles the chapter menu drawer open/closed and updates the hamburger button.
// Re-renders the menu list each time it opens to refresh progress checkmarks.
// Closes the search overlay first if it happens to be open.
function toggleMenu() {
  // If opening Contents, close Search first (resets its icon to normal)
  if (!menuOpen) {
    const so = document.getElementById('searchOverlay');
    if (so && so.classList.contains('open')) closeSearch();
  }
  menuOpen = !menuOpen;
  document.getElementById('chapterMenu').classList.toggle('open', menuOpen);
  document.getElementById('menuBtn').innerHTML = menuOpen ? ICONS.close : ICONS.contents;
  if (menuOpen) {
    window._titleBeforeMenu = document.getElementById('header-title').innerText;
    document.getElementById('header-title').innerText = t('navigation_menu_title');
    renderMenu();
  } else {
    if (window._titleBeforeMenu) {
      document.getElementById('header-title').innerText = window._titleBeforeMenu;
      window._titleBeforeMenu = null;
    }
  }
}

// Closes the chapter menu drawer and resets the hamburger button label.
function closeMenu() {
  menuOpen = false;
  document.getElementById('chapterMenu').classList.remove('open');
  document.getElementById('menuBtn').innerHTML = ICONS.contents;
  if (window._titleBeforeMenu) {
    document.getElementById('header-title').innerText = window._titleBeforeMenu;
    window._titleBeforeMenu = null;
  }
}

// Handles the ✕ Close button on non-chapter pages (settings, progress, library, etc.).
// If a last position exists and rememberPosition is on, returns to that chapter
// and scroll position. Otherwise falls back to the title page.
function closeNonChapterPage() {
  // If Search is open on top, close it cleanly (resets its own button)
  const so = document.getElementById('searchOverlay');
  if (so && so.classList.contains('open')) closeSearch();
  closeMenu();
  _resetNonChapterPageState();

  const pos = getLastPosition();
  if (pos && appSettings.rememberPosition) {
    goToChapter(pos.chapterIdx, pos.scrollY);
    setTimeout(() => window.scrollTo(0, pos.scrollY), 100);
  } else {
    goToTitlePage();
  }
}
