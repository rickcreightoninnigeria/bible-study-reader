// ── ONBOARDING & SLIDE OVERLAY ENGINE ────────────────────────────────────────
// Single source of truth for all slide-based overlays in the app:
//   • App-level onboarding   (showAppOnboardingIfNeeded, showAppOnboarding)
//   • Study-level onboarding (showOnboardingIfNeeded, showOnboarding)
//   • Feature tutorials      (showFeatureTutorial)
//
// All three are thin wrappers around the single core engine: showSlideOverlay().
//
// Dependencies (all available as globals before this file loads):
//   FONT_MAX, ICONS           – state.js / icons.js
//   appSettings               – settings.js
//   studyOnboardingSlides     – loaded from the .estudy file (main.js STATE section)
//   openLibrary               – study-loader.js
//   showOnboardingIfNeeded    – this file (called from dismissal fade-out)
//   renderTitlePage, renderHowToUse, renderSettings,
//   closeNonChapterPage, renderProgressOverview, openSearch – runtime globals


// ══════════════════════════════════════════════════════════════════════════════
// APP ONBOARDING SLIDES
// Shown once globally on first launch, before any study is loaded.
// localStorage key: 'app_onboarding_complete'
// On complete: openLibrary(). On skip: openLibrary().
// ══════════════════════════════════════════════════════════════════════════════

function getAppOnboardingSlides() {
 return [
   {
     icon:    '📖',
     eyebrow: t('onboarding_app_slide1_eyebrow'),
     heading: t('onboarding_app_slide1_heading'),
     body:    t('onboarding_app_slide1_body'),
   },
   {
     icon:    '📚',
     eyebrow: t('onboarding_app_slide2_eyebrow'),
     heading: t('onboarding_app_slide2_heading'),
     body:    t('onboarding_app_slide2_body'),
   },
   {
     icon:    '❓',
     eyebrow: t('onboarding_app_slide3_eyebrow'),
     heading: t('onboarding_app_slide3_heading'),
     body:    t('onboarding_app_slide3_body'),
   },
  ];
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE TUTORIALS
// On-demand slide sets triggered from the HowTo and Settings pages.
// Each key is the tutorial id passed to showFeatureTutorial(id).
// markSeen: true causes the engine to write featureSeen_[id] to localStorage
// so trigger buttons can switch between ICONS.triggerSlidesNew and
// ICONS.triggerSlides once the tutorial has been viewed.
// ══════════════════════════════════════════════════════════════════════════════

function getFeatureTutorials() {
  return {

  'starring-questions': {
    markSeen: true,
    slides: [
      {
        icon:    '⭐',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_starring_slide1_heading'),
        body:    t('onboarding_starring_slide1_body'),
      },
      {
        icon:    '📋',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_starring_slide2_heading'),
        body:    t('onboarding_starring_slide2_body'),
      },
    ],
  },

  'search': {
    markSeen: true,
    slides: [
      {
        icon:    '🔍',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_search_slide1_heading'),
        body:    t('onboarding_search_slide1_body'),
      },
      {
        icon:    '🎯',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_search_slide2_heading'),
        body:    t('onboarding_search_slide2_body'),
      },
    ],
  },

  'sharing': {
    markSeen: true,
    slides: [
      {
        icon:    '📤',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_sharing_slide1_heading'),
        body:    t('onboarding_sharing_slide1_body'),
      },
      {
        icon:    '📦',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_sharing_slide2_heading'),
        body:    t('onboarding_sharing_slide2_body'),
      },
      {
        icon:    '⚙️',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_sharing_slide3_heading'),
        body:    t('onboarding_sharing_slide3_body'),
      },
    ],
  },

  'my-progress': {
    markSeen: true,
    slides: [
      {
        icon:    '📊',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_myprogress_slide1_heading'),
        body:    t('onboarding_myprogress_slide1_body'),
      },
      {
        icon:    '⭐',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_myprogress_slide2_heading'),
        body:    t('onboarding_myprogress_slide2_body'),
      },
    ],
  },

  'voice-input': {
    markSeen: true,
    slides: [
      {
        icon:    '🎤',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_voiceinput_slide1_heading'),
        body:    t('onboarding_voiceinput_slide1_body'),
      },
      {
        icon:    '✏️',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_voiceinput_slide2_heading'),
        body:    t('onboarding_voiceinput_slide2_body'),
      },
    ],
  },

  'read-aloud': {
    markSeen: true,
    slides: [
      {
        icon:    '🔊',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_readaloud_slide1_heading'),
        body:    t('onboarding_readaloud_slide1_body'),
      },
      {
        icon:    '⚙️',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_readaloud_slide2_heading'),
        body:    t('onboarding_readaloud_slide2_body'),
        action:  {
          label: t('onboarding_action_go_to_settings'),
          fn:    () => renderSettings('app'),
        },
      },
    ],
  },

  'bible-popups': {
    markSeen: true,
    slides: [
      {
        icon:    'ℹ️',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_biblepopups_slide1_heading'),
        body:    t('onboarding_biblepopups_slide1_body'),
      },
    ],
  },

  'notes-area': {
    markSeen: true,
    slides: [
      {
        icon:    '📝',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_notesarea_slide1_heading'),
        body:    t('onboarding_notesarea_slide1_body'),
      },
      {
        icon:    '📤',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_notesarea_slide2_heading'),
        body:    t('onboarding_notesarea_slide2_body'),
      },
    ],
  },

  'auto-save': {
    markSeen: true,
    slides: [
      {
        icon:    '💾',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_autosave_slide1_heading'),
        body:    t('onboarding_autosave_slide1_body'),
      },
    ],
  },

  'interface-mode': {
    markSeen: true,
    slides: [
      {
        icon:    '🎛️',
        eyebrow: t('onboarding_eyebrow_settings'),
        heading: t('onboarding_interfacemode_slide1_heading'),
        body:    t('onboarding_interfacemode_slide1_body'),
      },
      {
        icon:    '➕',
        eyebrow: t('onboarding_eyebrow_settings'),
        heading: t('onboarding_interfacemode_slide2_heading'),
        body:    t('onboarding_interfacemode_slide2_body'),
      },
      {
        icon:    '⚡',
        eyebrow: t('onboarding_eyebrow_settings'),
        heading: t('onboarding_interfacemode_slide3_heading'),
        body:    t('onboarding_interfacemode_slide3_body'),
        action:  {
          label: t('onboarding_action_go_to_settings'),
          fn:    () => renderSettings('app'),
        },
      },
    ],
  },

  'library': {
    markSeen: true,
    slides: [
      {
        icon:    '📚',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_library_slide1_heading'),
        body:    t('onboarding_library_slide1_body'),
      },
      {
        icon:    '📥',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_library_slide2_heading'),
        body:    t('onboarding_library_slide2_body'),
      },
      {
        icon:    '🗑️',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_library_slide3_heading'),
        body:    t('onboarding_library_slide3_body'),
      },
    ],
  },

  'progress-bar': {
    markSeen: true,
    slides: [
      {
        icon:    '▬',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_progressbar_slide1_heading'),
        body:    t('onboarding_progressbar_slide1_body'),
      },
    ],
  },

  'swipe-navigation': {
    markSeen: true,
    slides: [
      {
        icon:    '👆',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_swipenav_slide1_heading'),
        body:    t('onboarding_swipenav_slide1_body'),
      },
      {
        icon:    '⚙️',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_swipenav_slide2_heading'),
        body:    t('onboarding_swipenav_slide2_body'),
        action:  {
          label: t('onboarding_action_go_to_settings'),
          fn:    () => renderSettings('app'),
        },
      },
    ],
  },

  'remember-position': {
    markSeen: true,
    slides: [
      {
        icon:    '📍',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_rememberpos_slide1_heading'),
        body:    t('onboarding_rememberpos_slide1_body'),
        action:  {
          label: t('onboarding_action_go_to_settings'),
          fn:    () => renderSettings('app'),
        },
      },
    ],
  },

  'leaders-notes': {
    markSeen: true,
    slides: [
      {
        icon:    '👥',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_leadersnotes_slide1_heading'),
        body:    t('onboarding_leadersnotes_slide1_body'),
      },
      {
        icon:    '⚙️',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_leadersnotes_slide2_heading'),
        body:    t('onboarding_leadersnotes_slide2_body'),
        action:  {
          label: t('onboarding_action_go_to_settings'),
          fn:    () => renderSettings('app'),
        },
      },
    ],
  },

  'answer-check': {
    markSeen: true,
    slides: [
      {
        icon:    '✅',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_answercheck_slide1_heading'),
        body:    t('onboarding_answercheck_slide1_body'),
      },
      {
        icon:    '🖐️',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_answercheck_slide2_heading'),
        body:    t('onboarding_answercheck_slide2_body'),
      },
      {
        icon:    '⚡',
        eyebrow: t('onboarding_eyebrow_feature'),
        heading: t('onboarding_answercheck_slide3_heading'),
        body:    t('onboarding_answercheck_slide3_body'),
        action:  {
          label: t('onboarding_action_go_to_settings'),
          fn:    () => renderSettings('app'),
        },
      },
    ],
  },

 };
}  // end FEATURE_TUTORIALS


// ══════════════════════════════════════════════════════════════════════════════
// CORE ENGINE — showSlideOverlay(config)
// ══════════════════════════════════════════════════════════════════════════════
//
// config {
//   id            {string}   Required. Unique id — used for the overlay DOM element
//                            id ('slideOverlay_[id]') and, when markSeen is true,
//                            as the localStorage seen-key ('featureSeen_[id]').
//   slides        {Array}    Required. Array of slide objects (see format below).
//   skipLabel     {string}   Optional. Label for the skip/close button.
//                            Default: t('onboarding_skip_label').
//   finalLabel    {string}   Optional. Label for the Next button on the last slide.
//                            Default: t('onboarding_final_label').
//   onComplete    {Function} Optional. Called when user taps the final Next button.
//                            If supplied, the engine calls dismiss(true) then
//                            onComplete(), so onComplete controls navigation.
//   onSkip        {Function} Optional. Called when user taps Skip/Close. If
//                            omitted, falls back to onComplete behaviour.
//   returnTo      {Function} Optional. Called on dismiss when no onComplete/onSkip
//                            override is active. The engine auto-restores scroll
//                            position after calling this (unless restoreScroll:false).
//   restoreScroll {boolean}  Optional. Default true. Set false to suppress the
//                            automatic scroll restoration after returnTo().
//   markSeen      {boolean}  Optional. Default false. If true, writes
//                            'featureSeen_[id]' to localStorage on dismiss and
//                            calls refreshTutorialTriggers(id) to swap the icon
//                            on any visible trigger buttons for this tutorial.
//   fadeOut       {boolean}  Optional. Default false. If true, the overlay fades
//                            out over 300ms before being removed from the DOM and
//                            before any post-dismiss callbacks run. Used by app
//                            onboarding to give a polished first-launch feel.
// }
//
// Slide object format:
// {
//   icon      {string}  Emoji or short text displayed large at the top.
//   eyebrow   {string}  Small uppercase label above the heading.
//   heading   {string}  Main slide title.
//   body      {string}  Body copy. \n is converted to <br><br>. HTML is allowed
//                       (e.g. <ul><li>…</li></ul>, <b>bold</b>).
//   action    {object}  Optional. { label: string, fn: Function }
//                       Renders a button on the slide. fn() is called then the
//                       overlay is dismissed with stayPut = true.
//   bodyAfter {string}  Optional. Additional HTML rendered below the action button.
//   layout    {string}  Optional. Reserved for future layout variants.
// }

function showSlideOverlay(config) {
  const {
    id,
    slides,
    skipLabel     = t('onboarding_skip_label'),
    finalLabel    = t('onboarding_final_label'),
    onComplete    = null,
    onSkip        = null,
    returnTo      = null,
    restoreScroll = true,
    markSeen      = false,
    fadeOut       = false,
  } = config;

  if (!slides || !slides.length) return;

  // Snapshot scroll position before building the overlay so we can restore it
  // after returnTo() re-renders the originating page.
  const savedScrollY = window.scrollY;

  // ── Remove any existing overlay with this id ───────────────────────────────
  const existing = document.getElementById('slideOverlay_' + id);
  if (existing) existing.remove();

  // ── Build overlay shell ────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'onboarding-overlay';
  overlay.id = 'slideOverlay_' + id;

  // ── Build slides strip ─────────────────────────────────────────────────────
  const slidesEl = document.createElement('div');
  slidesEl.className = 'onboarding-slides';

  slides.forEach((s) => {
    const slide = document.createElement('div');
    slide.className = 'onboarding-slide';

    const iconEl = document.createElement('div');
    iconEl.className = 'onboarding-icon';
    iconEl.textContent = s.icon || '';

    const eyebrowEl = document.createElement('div');
    eyebrowEl.className = 'onboarding-eyebrow';
    eyebrowEl.textContent = s.eyebrow || '';

    const headingEl = document.createElement('div');
    headingEl.className = 'onboarding-heading';
    headingEl.textContent = s.heading || '';

    const bodyEl = document.createElement('div');
    bodyEl.className = 'onboarding-body';
    // \n → <br><br>; HTML in body (e.g. <ul>) is preserved as-is.
    bodyEl.innerHTML = (s.body || '').replace(/\n/g, '<br><br>');

    slide.appendChild(iconEl);
    slide.appendChild(eyebrowEl);
    slide.appendChild(headingEl);
    slide.appendChild(bodyEl);

    // Optional action button on this slide
    if (s.action) {
      const actionLabel = s.action.label || '';
      const btn = document.createElement('button');
      btn.textContent = actionLabel;

      const isSettingsBtn = actionLabel.toLowerCase().includes('settings');
      if (isSettingsBtn) {
        btn.style.cssText = `margin-top:20px; background:var(--accent); border:none;
          color:var(--surface); border-radius:8px; padding:16px;
          font-family:var(--main-font-family); font-size:${FONT_MAX}px;
          font-weight:600; cursor:pointer; width:100%;`;
      } else {
        btn.style.cssText = `margin-top:20px; background:none;
          border:1px solid rgba(184,146,42,0.5); color:var(--accent-light);
          border-radius:8px; padding:10px 16px;
          font-family:'DM Mono',monospace; font-size:11px;
          letter-spacing:0.08em; cursor:pointer; width:100%;`;
      }

      btn.onclick = function () {
        if (typeof s.action.fn === 'function') s.action.fn();
        dismiss(true); // action has already navigated; stay put
      };
      // Only append the button if there's a label to show.
      if (actionLabel) slide.appendChild(btn);
    }

    // Optional extra body below the action button
    if (s.bodyAfter) {
      const afterEl = document.createElement('div');
      afterEl.className = 'onboarding-body';
      afterEl.style.marginTop = '16px';
      afterEl.innerHTML = (s.bodyAfter || '').replace(/\n/g, '<br><br>');
      slide.appendChild(afterEl);
    }

    slidesEl.appendChild(slide);
  });

  // ── Build footer (dots + Next + Skip) ─────────────────────────────────────
  const footer = document.createElement('div');
  footer.className = 'onboarding-footer';

  const dotsEl = document.createElement('div');
  dotsEl.className = 'onboarding-dots';

  slides.forEach((_, i) => {
    const dot = document.createElement('div');
    dot.className = 'onboarding-dot' + (i === 0 ? ' active' : '');
    dot.onclick = () => goTo(i);
    dotsEl.appendChild(dot);
  });

  const nextBtn = document.createElement('button');
  nextBtn.className = 'onboarding-next-btn';
  nextBtn.textContent = t('onboarding_next_btn');
  nextBtn.onclick = next;

  const skipBtn = document.createElement('button');
  skipBtn.className = 'onboarding-skip-btn';
  skipBtn.textContent = skipLabel;
  skipBtn.onclick = skip;

  footer.appendChild(dotsEl);
  footer.appendChild(nextBtn);
  footer.appendChild(skipBtn);

  overlay.appendChild(slidesEl);
  overlay.appendChild(footer);

  // ── Swipe gesture navigation ───────────────────────────────────────────────
  let touchStartX = 0;
  let touchStartY = 0;

  overlay.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }, { passive: true });

  overlay.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].screenX - touchStartX;
    const dy = e.changedTouches[0].screenY - touchStartY;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0 && current < slides.length - 1) { current++; sync(); }
    else if (dx > 0 && current > 0)            { current--; sync(); }
  }, { passive: true });

  // ── State ──────────────────────────────────────────────────────────────────
  let current = 0;

  document.body.appendChild(overlay);
  sync(); // initial render

  // ── Internal helpers ───────────────────────────────────────────────────────

  function sync() {
    slidesEl.style.transform = `translateX(-${current * 100}%)`;
    dotsEl.querySelectorAll('.onboarding-dot').forEach((d, i) => {
      d.classList.toggle('active', i === current);
    });
    nextBtn.textContent = current === slides.length - 1 ? finalLabel : t('onboarding_next_btn');
  }

  function goTo(idx) { current = idx; sync(); }

  function next() {
    if (current < slides.length - 1) { current++; sync(); }
    else complete();
  }

  function skip() {
    if (typeof onSkip === 'function') {
      dismiss(true);
      onSkip();
    } else {
      // No specific skip handler — treat as complete.
      complete();
    }
  }

  function complete() {
    if (typeof onComplete === 'function') {
      dismiss(true);
      onComplete();
    } else {
      dismiss(false);
    }
  }

  // Core dismiss. stayPut = true means a callback or action button has already
  // navigated; don't also call returnTo.
  function dismiss(stayPut = false) {
    if (markSeen) {
      localStorage.setItem('featureSeen_' + id, 'true');
      refreshTutorialTriggers(id);
    }

    if (fadeOut) {
      overlay.style.transition = 'opacity 0.3s ease';
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.remove();
        if (!stayPut) _afterDismiss();
      }, 300);
    } else {
      overlay.style.display = 'none';
      if (!stayPut) _afterDismiss();
    }
  }

  function _afterDismiss() {
    if (typeof returnTo === 'function') {
      returnTo();
      if (restoreScroll) {
        setTimeout(() => window.scrollTo(0, savedScrollY), 0);
      }
    }
    // If no returnTo and not stayPut, leave the page as-is.
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// TRIGGER BUTTON HELPERS
// ══════════════════════════════════════════════════════════════════════════════

// Returns the correct icon HTML for a tutorial trigger button, based on whether
// the tutorial has been seen before.
// Usage in a template literal: ${tutorialIcon('starring-questions')}
function tutorialIcon(id) {
  const seen = localStorage.getItem('featureSeen_' + id) === 'true';
  return seen ? ICONS.triggerSlides : ICONS.triggerSlidesNew;
}

// After a tutorial is dismissed, find any visible trigger buttons for that id
// and swap their icon from New → Seen, without re-rendering the whole page.
// Requires: data-tutorial-id="[id]" and a child .tutorial-trigger-icon span
// on every trigger button.
function refreshTutorialTriggers(id) {
  document.querySelectorAll(`[data-tutorial-id="${id}"]`).forEach(btn => {
    const iconEl = btn.querySelector('.tutorial-trigger-icon');
    if (iconEl) iconEl.innerHTML = ICONS.triggerSlides;
  });
}


// ══════════════════════════════════════════════════════════════════════════════
// WRAPPER — App onboarding
// ══════════════════════════════════════════════════════════════════════════════
//
// showAppOnboardingIfNeeded():
//   Guard wrapper. Returns true if onboarding was shown (so the startup
//   sequence in app-init.js can suppress study onboarding until after the
//   app onboarding fade-out chain completes).
//
// showAppOnboarding():
//   Unconditional. Called directly from the Case 4 startup branch in app-init.js
//   (very first run) as well as from the HowTo "View App slides again" button.
//
// localStorage key: 'app_onboarding_complete'
// On complete / skip: openLibrary() — consistent with original app-init.js behaviour.
// fadeOut: true — preserves the 300ms fade transition from the original.
// Post-dismiss: the fade callback in dismiss() calls showOnboardingIfNeeded()
//   automatically, replicating the original dismissAppOnboarding() chain.

function showAppOnboardingIfNeeded() {
  if (localStorage.getItem('app_onboarding_complete')) return false;
  showAppOnboarding();
  return true;
}

function showAppOnboarding() {
  showSlideOverlay({
    id:           'appOnboarding',
    slides:       getAppOnboardingSlides(),
    skipLabel:    t('onboarding_skip_intro'),
    finalLabel:   t('onboarding_get_started'),
    fadeOut:      true,
    restoreScroll: false,
    onComplete: () => {
      localStorage.setItem('app_onboarding_complete', 'true');
      window._libActiveTab = 'all';
      openLibrary();
      showOnboardingIfNeeded();
    },
    onSkip: () => {
      localStorage.setItem('app_onboarding_complete', 'true');
      window._libActiveTab = 'all';
      openLibrary();
      showOnboardingIfNeeded();
    },
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// WRAPPER — Study onboarding
// ══════════════════════════════════════════════════════════════════════════════
//
// showOnboardingIfNeeded():
//   Guard wrapper. Called by initApp() after a study loads, and by the app
//   onboarding dismiss chain above.
//   localStorage key: 'onboardingComplete' (existing convention preserved).
//
// showOnboarding():
//   Unconditional. Called from the HowTo "View study slides again" button.
//
// Slides come from the studyOnboardingSlides global (loaded from the .estudy file).

function showOnboardingIfNeeded() {
  if (localStorage.getItem(`onboardingComplete_${window.activeStudyId}`)) return;
  if (!studyOnboardingSlides || !studyOnboardingSlides.length) return;
  showSlideOverlay({
    id:           'studyOnboarding',
    slides:       studyOnboardingSlides,
    skipLabel:    t('onboarding_skip_intro'),
    restoreScroll: false,
    onComplete: () => {
      localStorage.setItem(`onboardingComplete_${window.activeStudyId}`, 'true');
      renderTitlePage();
    },
    onSkip: () => {
      localStorage.setItem(`onboardingComplete_${window.activeStudyId}`, 'true');
      renderTitlePage();
    },
  });
}

// Called from HowTo "View study slides again" button — no guard.
function showOnboarding() {
  if (!studyOnboardingSlides || !studyOnboardingSlides.length) return;
  showSlideOverlay({
    id:           'studyOnboarding',
    slides:       studyOnboardingSlides,
    skipLabel:    t('onboarding_close'),
    restoreScroll: true,
    returnTo:     () => renderHowToUse('study'),
  });
}

// Called from HowTo "View App slides again" button — no guard.
// Returns to HowTo after closing rather than going to Library.
function showAppOnboardingFromHowTo() {
  showSlideOverlay({
    id:           'appOnboarding',
    slides:       getAppOnboardingSlides(),
    skipLabel:    t('onboarding_close'),
    finalLabel:   t('onboarding_close'),
    restoreScroll: true,
    returnTo:     () => renderHowToUse('study'),
  });
}


// ══════════════════════════════════════════════════════════════════════════════
// WRAPPER — Feature tutorials
// ══════════════════════════════════════════════════════════════════════════════
//
// On-demand: no guard. Called from HowTo and Settings trigger buttons.
// Always returns the user to the page they came from (via returnTo callback),
// with scroll position restored.
//
// id:       key into FEATURE_TUTORIALS
// returnTo: render function for the originating page, e.g.:
//             () => renderHowToUse('chapters')
//             () => renderSettings('app')

function showFeatureTutorial(id, returnTo) {
  const tutorial = getFeatureTutorials()[id];
  if (!tutorial) {
    console.warn('showFeatureTutorial: unknown id "' + id + '"');
    return;
  }
  showSlideOverlay({
    id:           id,
    slides:       tutorial.slides,
    skipLabel:    t('onboarding_close'),
    markSeen:     tutorial.markSeen ?? true,
    restoreScroll: true,
    returnTo:     returnTo || null,
  });
}


// ══════════════════════════════════════════════════════════════════════════════
// NAV BUTTON VISIBILITY
// ══════════════════════════════════════════════════════════════════════════════
// Called by applyAllSettings() whenever settings change, so nav buttons stay
// in sync without a full page re-render.

function updateNavButtons() {
  const progressBtn = document.getElementById('navProgressBtn');
  const howtoBtn    = document.getElementById('navHowtoBtn');
  if (progressBtn) progressBtn.style.display = appSettings.showPageProgress ? '' : 'none';
  if (howtoBtn)    howtoBtn.style.display     = appSettings.showPageHowToUse ? '' : 'none';
}


// ══════════════════════════════════════════════════════════════════════════════
// NAV CLICK HANDLERS
// ══════════════════════════════════════════════════════════════════════════════

function navLibClick() {
  if (window.activeTabPage === 'library') { closeNonChapterPage(); } else { openLibrary(); }
}
function navSearchClick()   { openSearch(); }
function navProgressClick() {
  if (window.activeTabPage === 'progress') { closeNonChapterPage(); } else { renderProgressOverview(); }
}
function navHowtoClick() {
  if (window.activeTabPage === 'howto') { closeNonChapterPage(); } else { renderHowToUse(); }
}
function navSettingsClick() {
  if (window.activeTabPage === 'settings') { closeNonChapterPage(); } else { renderSettings(); }
}
