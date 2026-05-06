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


// ── MODAL INTERCEPT ─────────────────────────────────────────────────────────
// Closes the topmost open modal/popup, if any.
// Called by the popstate listener when Back is pressed and a modal is open.
// The listener calls history.forward() after this to undo the navigation,
// since this WebView reports the destination state in e.state rather than the
// popped entry's state — making sentinel-based detection unreliable.
// Returns true if a modal was closed, false if nothing was open.
// Kept as a named function so it can also be wired to a keyboard Escape handler.
function _closeAnyOpenModal() {
  const modals = [
    { id: 'verseModalOverlay',  close: () => closeVerseModal() },
    { id: 'qaModalOverlay',     close: () => closeQaModal() },
    { id: 'deeperModalOverlay', close: () => closeDeeperModal() },
    { id: 'likertPopupOverlay', close: () => closeLikertPopup() },
    { id: 'info-modal-overlay', close: () => closeInfoModal() },
  ];
  for (const { id, close } of modals) {
    if (document.getElementById(id)?.classList.contains('open')) {
      close();
      return true;
    }
  }
  return false;
}

const Router = (() => {

  // ── Internal state ──────────────────────────────────────────────────────────

  // Tracks the last page name we pushed so _applyNavigation can decide slide
  // direction even when called from popstate (which only knows the new state).
  let _lastPage = null;

  // Prevent re-entrant navigation (e.g. a popstate firing while an async
  // render is still in progress).
  let _navigating = false;

  // ── Shadow stack (debug) ─────────────────────────────────────────────────────
  // The History API only exposes the current entry — there is no way to read
  // the full stack. We maintain a parallel JS array so logStack() can print it
  // without touching history.go() (which Chrome throttles aggressively).
  // Invariant: _shadowStack[_shadowIdx] always mirrors history.state.
  let _shadowStack = [];
  let _shadowIdx   = -1;

  function _shadowPush(state) {
    _shadowStack = _shadowStack.slice(0, _shadowIdx + 1);
    _shadowStack.push(state);
    _shadowIdx = _shadowStack.length - 1;
  }
  function _shadowReplace(state) {
    if (_shadowIdx < 0) { _shadowPush(state); return; }
    _shadowStack[_shadowIdx] = state;
  }
  function _shadowPop(poppedState) {
    for (let i = _shadowIdx - 1; i >= 0; i--) {
      const s = _shadowStack[i];
      if (s && s.page === poppedState.page
            && s.idx   === poppedState.idx
            && s.tabId === poppedState.tabId) { _shadowIdx = i; return; }
    }
    for (let i = _shadowIdx + 1; i < _shadowStack.length; i++) {
      const s = _shadowStack[i];
      if (s && s.page === poppedState.page
            && s.idx   === poppedState.idx
            && s.tabId === poppedState.tabId) { _shadowIdx = i; return; }
    }
    _shadowStack = [poppedState];
    _shadowIdx   = 0;
  }

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
  //   studyId: string | null   (the active study when this entry was pushed,
  //                             restored before rendering on popstate so Back
  //                             always returns to the correct study's content)
  // }

  function _makeState(destination) {
    return {
      page:    destination.page,
      idx:     destination.idx     ?? null,
      tabId:   destination.tabId   ?? null,
      scrollY: destination.scrollY ?? 0,
      studyId: destination.studyId ?? window.activeStudyId ?? null,
    };
  }

  // ── Core: apply a navigation state to the DOM ───────────────────────────────

  async function _applyNavigation(state, isPop = false) {
    if (_navigating) return;
    _navigating = true;

    try {
      const { page, idx, tabId, scrollY, studyId } = state;

      // On a back/forward navigation, restore the study that was active when
      // this history entry was created — before calling any render function.
      // Only needed on popstate (isPop=true); forward navigation is intentional
      // so we leave the current study alone.
      if (isPop && studyId && studyId !== window.activeStudyId) {
        // Load the study data silently (no version dialogs, no onboarding)
        // and apply it. applyStudyData re-initialises window.chapters and all
        // derived state so the subsequent render calls work on the right study.
        try {
          const data = await StudyIDB.get(`study_content_${studyId}`);
          if (data) {
            window.activeStudyId = studyId;
            localStorage.setItem('bsr_last_active_study', studyId);
            await applyStudyData(data, { isStudySwitch: true, silent: true });
          }
        } catch (err) {
          console.warn('[Router] Could not restore study', studyId, err);
        }
      }

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
    // If the search overlay is open, close it and undo the navigation —
    // the overlay closing is not a navigation, just a UI dismiss.
    const searchOverlay = document.getElementById('searchOverlay');
    if (searchOverlay?.classList.contains('open')) {
      closeSearch();
      history.forward();
      _shadowIdx = Math.min(_shadowIdx + 1, _shadowStack.length - 1);
      return;
    }

    // If a modal is open, Back should close it rather than navigate.
    // history.forward() undoes the popstate navigation; _shadowIdx is
    // incremented to keep the shadow stack in sync with the real history.
    // We cannot rely on e.state?.page === '_modal' because this WebView
    // reports the destination state in e.state, not the popped entry's state.
    if (_closeAnyOpenModal()) {
      history.forward();
      _shadowIdx = Math.min(_shadowIdx + 1, _shadowStack.length - 1);
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

    _shadowPop(e.state);
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
    _shadowPush(state);
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
    _shadowReplace(state);
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
    _shadowReplace(state);
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
    _shadowPush(state);
    _lastPage = state.page;
  }

  // ── Debug ───────────────────────────────────────────────────────────────────

  /**
   * Router.logStack()
   * Print the full history stack to the console — synchronous, instant.
   * Reads from the internal shadow stack; no history.go() calls.
   * Usage: evaluate this Expression in console:
   *     Router.logStack()
   */
  function logStack() {
    const n   = _shadowStack.length;
    const cur = _shadowIdx;
    const label = s => {
      if (!s) return '(null)';
      const parts = [`page=${s.page}`];
      if (s.idx    != null) parts.push(`idx=${s.idx}`);
      if (s.tabId  != null) parts.push(`tabId=${s.tabId}`);
      if (s.scrollY)        parts.push(`scrollY=${s.scrollY}`);
      if (s.studyId)        parts.push(`study=${s.studyId}`);
      return parts.join('  ');
    };
    if (n === 0) {
      console.log('%c[Router stack — empty (boot not yet called)]', 'color:#f0c040');
      return;
    }
    console.group(
      `%c[Router stack — ${n} entr${n === 1 ? 'y' : 'ies'}, current=${cur}]`,
      'font-weight:bold; color:#4a9eff'
    );
    _shadowStack.forEach((s, i) => {
      const here  = i === cur ? '  ◀ YOU ARE HERE' : '';
      const style = i === cur ? 'color:#f0c040; font-weight:bold' : 'color:inherit';
      console.log(`%c  [${i}] ${label(s)}${here}`, style);
    });
    console.groupEnd();
  }

  return { navigate, back, boot, replaceState, pushWithoutRender, logStack };

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
