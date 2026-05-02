// ── ROUTER ────────────────────────────────────────────────────────────────────
// History-API-backed navigation router.
//
// PROBLEM SOLVED
// --------------
// Previously every page transition called render functions directly with no
// involvement of the browser History API. On Android WebView the hardware /
// gesture back button fires a `popstate` event; with no listener, the WebView
// either did nothing or closed the app without warning.
//
// HOW IT WORKS
// ------------
// Every navigation now goes through navigate(destination). That function:
//   1. Serialises the destination into a history state object.
//   2. Calls history.pushState() so the browser stack grows.
//   3. Calls _applyNavigation() to actually render the new view.
//
// The single `popstate` listener calls _applyNavigation() with the state that
// was popped — so back always restores the correct view, tab, and scroll
// position without any per-page knowledge.
//
// EXIT GUARD
// ----------
// When the history stack is exhausted (state === null) the user is trying to
// leave the app. Instead of an abrupt WebView close, _handleExitIntent()
// shows a Swal confirmation and, if confirmed, calls the platform exit API.
//
// SLIDE DIRECTION
// ---------------
// _applyNavigation() receives an `isPop` flag. When true (back navigation)
// the content container gets the CSS class `nav-slide-left`; when false
// (forward) it gets `nav-slide-right`. Add those keyframe animations in your
// stylesheet — see the CSS block at the bottom of this file.
//
// WIRING EXISTING CODE
// --------------------
// The public API surface is small. Replace direct render-function calls:
//
//   Before → goToChapter(2)
//   After  → navigate({ page: 'chapter', idx: 2 })
//
//   Before → openLibrary()
//   After  → navigate({ page: 'library' })
//
//   Before → renderSettings('app')
//   After  → navigate({ page: 'settings', tabId: 'app' })
//
// The existing render functions (goToChapter, openLibrary, renderSettings …)
// are NOT removed — _applyNavigation() still calls them internally. This means
// any path that bypasses navigate() (e.g. internal feature-tutorial callbacks)
// continues to work, just without pushing a history entry. Fix those call sites
// incrementally.
//
// BOOT
// ----
// Call Router.boot() once, after the DOM and all scripts are ready (end of
// initApp() is a good place). boot() replaces the current history entry with
// the initial view state so there is always at least one entry on the stack.
//
// Dependencies (globals expected before this file loads):
//   currentChapter, isNonChapterPage          – state.js
//   goToChapter, closeNonChapterPage,
//   closeMenu, _resetNonChapterPageState       – navigation.js
//   openLibrary                               – study-loader.js
//   renderTitlePage, renderSettings,
//   renderHowToUse, renderLeadersNotes,
//   renderAbout, renderProgressOverview,
//   renderNotesPage                           – render-pages.js / render-progress.js
//   appSettings, getLastPosition              – settings.js / utils.js
//   Swal                                      – sweetalert2.all.min.js
//   t()                                       – i18n.js

const Router = (() => {

  // ── Internal state ──────────────────────────────────────────────────────────

  // Tracks the last page name we pushed so _applyNavigation can decide slide
  // direction even when called from popstate (which only knows the new state).
  let _lastPage = null;

  // Prevent re-entrant navigation (e.g. a popstate firing while an async
  // render is still in progress).
  let _navigating = false;

  // ── Page ordering for slide-direction heuristic ─────────────────────────────
  // Pages later in this list slide in from the right (forward); earlier pages
  // slide in from the left (back). Non-chapter pages are treated as "deeper"
  // than the title page but shallower than chapters.
  const PAGE_ORDER = ['title', 'library', 'progress', 'howto', 'settings',
                      'leaders', 'about', 'notes', 'chapter'];

  function _pageDepth(page) {
    const i = PAGE_ORDER.indexOf(page);
    return i === -1 ? 0 : i;
  }

  // ── history state shape ─────────────────────────────────────────────────────
  // {
  //   page:    'chapter' | 'title' | 'library' | 'settings' | 'howto' |
  //            'progress' | 'leaders' | 'about' | 'notes' | '_exit_guard'
  //   idx:     number          (chapter only)
  //   tabId:   string | null   (settings / howto / leaders / about)
  //   scrollY: number
  // }

  function _makeState(destination) {
    return {
      page:    destination.page,
      idx:     destination.idx    ?? null,
      tabId:   destination.tabId  ?? null,
      scrollY: destination.scrollY ?? 0,
    };
  }

  // ── Core: apply a navigation state to the DOM ───────────────────────────────

  async function _applyNavigation(state, isPop = false) {
    if (_navigating) return;
    _navigating = true;

    try {
      const { page, idx, tabId, scrollY } = state;

      // Determine slide direction from page depth comparison.
      // On a pop we invert: popping to a shallower page slides left.
      const fromDepth = _pageDepth(_lastPage);
      const toDepth   = _pageDepth(page);
      let slideClass  = '';
      if (_lastPage && _lastPage !== page) {
        if (isPop) {
          slideClass = 'nav-slide-left';
        } else {
          slideClass = toDepth >= fromDepth ? 'nav-slide-right' : 'nav-slide-left';
        }
      }

      // Apply slide animation to the content container.
      const content = document.getElementById('mainContent');
      if (content && slideClass) {
        content.classList.remove('nav-slide-left', 'nav-slide-right');
        // Trigger reflow so removing + re-adding the class restarts the animation.
        void content.offsetWidth;
        content.classList.add(slideClass);
        // Remove the class once the animation finishes. Leaving it in place
        // would cause the animation to create a stacking context that confines
        // position:fixed children (lang bar, save bar) to #mainContent rather
        // than the viewport — making them appear stuck mid-page.
        setTimeout(() => content.classList.remove(slideClass), 220);
      }

      // Dispatch to the existing render functions.
      switch (page) {

        case 'title':
          renderTitlePage();
          break;

        case 'chapter':
          await goToChapter(idx ?? 0, scrollY ?? 0);
          if (scrollY) setTimeout(() => window.scrollTo(0, scrollY), 100);
          break;

        case 'library':
          await openLibrary();
          break;

        case 'progress':
          renderProgressOverview();
          break;

        case 'howto':
          renderHowToUse(tabId ?? undefined);
          break;

        case 'settings':
          await renderSettings(tabId ?? undefined);
          break;

        case 'leaders':
          await renderLeadersNotes(tabId ?? undefined);
          break;

        case 'about':
          await renderAbout(tabId ?? undefined);
          break;

        case 'notes':
          renderNotesPage();
          break;

        case '_exit_guard':
          // Synthetic sentinel — nothing to render.
          break;

        default:
          console.warn('[Router] Unknown page:', page);
      }

      _lastPage = page;

    } finally {
      _navigating = false;
    }
  }

  // ── Exit intent (hardware back at bottom of stack) ──────────────────────────

  function _handleExitIntent() {
    // Re-push a sentinel so the user isn't stranded with an empty stack
    // if they dismiss the dialog.
    history.pushState(_makeState({ page: '_exit_guard' }), '');

    Swal.fire({
      title:             t('router_exit_title'),   // e.g. "Leave the app?"
      text:              t('router_exit_body'),    // e.g. "Your answers are saved."
      icon:              'question',
      showCancelButton:  true,
      confirmButtonText: t('router_exit_confirm'), // e.g. "Exit"
      cancelButtonText:  t('router_exit_cancel'),  // e.g. "Stay"
      reverseButtons:    true,
    }).then(result => {
      if (!result.isConfirmed) return;

      // Android WebView bridge (plain WebView — no Capacitor/Cordova)
      if (window.Android?.exitApp) {
        window.Android.exitApp();
      }

      // Attempt Capacitor exit first, then Cordova, then no-op.
      // In a plain browser context neither will be defined and the dialog
      // simply closes — correct behaviour for desktop testing.
      else if (window.Capacitor?.Plugins?.App?.exitApp) {
        window.Capacitor.Plugins.App.exitApp();
      }
      else if (window.navigator?.app?.exitApp) {
        window.navigator.app.exitApp();
      }
    });
  }

  // ── popstate listener ───────────────────────────────────────────────────────

  window.addEventListener('popstate', async (e) => {
    // If the search overlay is open, close it and re-push the state we just
    // popped — the overlay closing is not a navigation, just a UI dismiss.
    const searchOverlay = document.getElementById('searchOverlay');
    if (searchOverlay?.classList.contains('open')) {
      closeSearch();
      history.pushState(e.state, '');  // restore the entry we just popped
      return;
    }

    if (!e.state || e.state.page === null) {
      // Stack is exhausted — user pressed back past the first entry.
      _handleExitIntent();
      return;
    }

    if (e.state.page === '_exit_guard') {
      // The sentinel was popped (user pressed back again after dismissing the
      // exit dialog). Show the dialog again.
      _handleExitIntent();
      return;
    }

    await _applyNavigation(e.state, /* isPop = */ true);
  });

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * navigate(destination)
   *
   * The single entry point for all navigation. Push a new history entry and
   * render the target view.
   *
   * destination shape:
   *   { page: 'chapter',  idx: 2,          scrollY: 0 }
   *   { page: 'title' }
   *   { page: 'library' }
   *   { page: 'progress' }
   *   { page: 'howto',    tabId: 'study' }
   *   { page: 'settings', tabId: 'app' }
   *   { page: 'leaders',  tabId: null }
   *   { page: 'about',    tabId: 'publisher' }
   *   { page: 'notes' }
   */
  async function navigate(destination) {
    const state = _makeState(destination);
    history.pushState(state, '');
    await _applyNavigation(state, /* isPop = */ false);
  }

  /**
   * back()
   *
   * Programmatic back — equivalent to the hardware back button.
   * Use this for the ✕ close buttons on non-chapter pages instead of
   * calling closeNonChapterPage() directly, so the history stack stays in sync.
   */
  function back() {
    history.back();
  }

  /**
   * boot()
   *
   * Call once at the end of initApp(), after the initial view has been
   * rendered. Replaces the current (empty) history entry with a proper state
   * object so popstate always has a valid state to restore.
   *
   * If the app launched into a chapter, pass { page:'chapter', idx, scrollY }.
   * If it launched into the title page, pass { page:'title' }.
   */
  function boot(initialState) {
    const state = _makeState(initialState);
    history.replaceState(state, '');
    _lastPage = state.page;
  }

  /**
   * replaceState(destination)
   *
   * Replace the current history entry without pushing a new one.
   * Useful for tab switches within a page (settings tabs, howto tabs) that
   * should not add a back-stack entry of their own.
   */
  function replaceState(destination) {
    const state = _makeState(destination);
    history.replaceState(state, '');
    // Update lastPage so slide direction is computed correctly on the next push.
    _lastPage = state.page;
  }

  /**
   * pushWithoutRender(destination)
   *
   * Pushes a history entry WITHOUT calling _applyNavigation().
   * Use when the view has already been rendered by direct calls (e.g. initApp
   * on a study switch), and you only need the history stack updated.
   * Updates _lastPage so slide direction tracking stays consistent, and the
   * _navigating guard is never touched — so no spurious popstate re-renders.
   */
  function pushWithoutRender(destination) {
    const state = _makeState(destination);
    history.pushState(state, '');
    _lastPage = state.page;
  }

  return { navigate, back, boot, replaceState, pushWithoutRender };

})();


// ── UPDATED nav click handlers (replace the versions in onboarding.js) ────────
//
// The toggle logic is now:
//   - If already on the page → history.back() (keeps the stack clean)
//   - Otherwise → Router.navigate(...)
//
// These are reassigned here so they overwrite the originals once router.js
// loads. Place router.js AFTER onboarding.js in your script load order.

function navLibClick() {
  if (window.activeTabPage === 'library') { Router.back(); }
  else { Router.navigate({ page: 'library' }); }
}

function navProgressClick() {
  if (window.activeTabPage === 'progress') { Router.back(); }
  else { Router.navigate({ page: 'progress' }); }
}

function navHowtoClick() {
  if (window.activeTabPage === 'howto') { Router.back(); }
  else { Router.navigate({ page: 'howto' }); }
}

function navSettingsClick() {
  if (window.activeTabPage === 'settings') { Router.back(); }
  else { Router.navigate({ page: 'settings' }); }
}
