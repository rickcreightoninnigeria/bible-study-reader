// ── GESTURES ──────────────────────────────────────────────────────────────────
// Horizontal swipe gesture navigation between chapters and tabs.
// Also contains the scroll and visibilitychange listeners that keep the last
// reading position and answer fields in sync when the app backgrounds.
//
// Dependencies (all available as globals before this file loads):
//   appSettings, getSwipeThreshold – settings.js
//   chapters, currentChapter,
//   isNonChapterPage               – state.js
//   storageKey                     – state.js
//   saveLastPosition               – utils.js
//   Router                         – router.js
//   navigateTab                    – render-pages.js (runtime call only)
//   window.activeTabPage           – state.js

// touchstartX and touchendX are globals so navigation.js can neutralise an
// in-flight swipe when closing a non-chapter page (_resetNonChapterPageState).
let touchstartX = null;
let touchendX   = 0;

// Determines swipe direction and triggers navigation if the delta exceeds
// getSwipeThreshold(). On tabbed pages (Settings, How To), swipes move between
// tabs. On chapter pages, swipes move between chapters; swiping right on the
// first chapter returns to the title page.
function handleGesture() {
  if (touchstartX === null) return;
  // Block swipe navigation while any modal or popup overlay is visible.
  // Covers both .open-class overlays and dynamically appended overlays.
  const hasOpenClassOverlay = document.querySelector(
    '.modal-overlay, #qaModalOverlay.open, #deeperModalOverlay.open, ' +
    '#verseModalOverlay.open, #likertPopupOverlay.open, #searchOverlay.open, ' +
    '#onboardingOverlay, #appOnboardingOverlay, #libPathPopupOverlay, ' +
    '#versionWarningOverlay'
  );
  if (hasOpenClassOverlay) return;

  const swipeThreshold = getSwipeThreshold();
  const delta = touchendX - touchstartX;

  // ── Tab swipe on Settings or How To ────────────────────────────────────────
  if (isNonChapterPage && window.activeTabPage) {
    if (Math.abs(delta) > swipeThreshold) {
      // Swipe left (delta < 0) → next tab (+1); swipe right → prev tab (-1)
      navigateTab(window.activeTabPage, delta < 0 ? 1 : -1);
    }
    return;
  }

  // ── Chapter swipe ──────────────────────────────────────────────────────────
  if (isNonChapterPage) return;

  if (delta < -swipeThreshold) {
    if (typeof currentChapter !== 'undefined' && currentChapter < chapters.length - 1) {
      Router.navigate({ page: 'chapter', idx: currentChapter + 1 });
      window.scrollTo(0, 0);
    }
  }

  if (delta > swipeThreshold) {
    if (typeof currentChapter !== 'undefined' && currentChapter > 0) {
      Router.navigate({ page: 'chapter', idx: currentChapter - 1 });
      window.scrollTo(0, 0);
    } else if (currentChapter === 0) {
      Router.navigate({ page: 'title' });
      window.scrollTo(0, 0);
    }
  }
}

document.addEventListener('touchstart', e => {
  touchstartX = e.changedTouches[0].screenX;
});

document.addEventListener('touchend', e => {
  // Ignore swipes that start on a textarea or answer field — the user is
  // scrolling or selecting text inside the field, not navigating chapters.
  const isTyping = e.target.tagName === 'TEXTAREA'
    || e.target.tagName === 'INPUT'
    || e.target.classList.contains('answer-field');
  if (isTyping) return;

  // Ignore swipes that originate inside a scrollable tab bar (the library's
  // main tab bar or language filter bar). Uses closest() so taps on child
  // buttons are caught too. Checked here at touchend rather than via a shared
  // flag so the test runs before handleGesture() regardless of listener order.
  if (e.target.closest('.lib-tab-bar, .lib-lang-bar')) return;

  touchendX = e.changedTouches[0].screenX;
  handleGesture();
});

document.addEventListener('touchcancel', () => {
  touchstartX = null;
});

// ── SCROLL / VISIBILITY ───────────────────────────────────────────────────────

// Save scroll position continuously while reading a chapter.
// { passive: true } tells the browser this listener won't call preventDefault(),
// allowing it to optimise scroll performance on mobile.
// The rAF guard caps localStorage writes to at most one per frame (~16ms at
// 60fps) without any perceptible change in position-save accuracy.
let _scrollRafPending = false;
document.addEventListener('scroll', () => {
  if (!isNonChapterPage && appSettings.rememberPosition && !_scrollRafPending) {
    _scrollRafPending = true;
    requestAnimationFrame(() => {
      saveLastPosition();
      _scrollRafPending = false;
    });
  }
}, { passive: true });

// Save position and answers when the app goes to background (e.g. user switches apps).
// visibilitychange fires more reliably than beforeunload on mobile WebViews.
// Answers are saved silently (no toast, no UI update) — the priority is writing
// to localStorage before the OS kills the process, which is the highest-risk
// data-loss scenario on iOS WebView. The ch guard handles backgrounding on the
// title page where currentChapter may be undefined.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    const ch = chapters[currentChapter];
    if (ch) {
      document.querySelectorAll('.answer-field').forEach(field => {
        safeSetItem(
          storageKey(ch.chapterNumber, field.dataset.type, field.dataset.index),
          field.value
        );
      });
    }
    saveLastPosition();
  }
});