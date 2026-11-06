// ── WEB APP SUPPORT ───────────────────────────────────────────────────────────
// What only the web build needs: the service worker that lets it work offline
// (sw.js, written by py/build_web.py), a request for durable storage once the
// app is installed, and a one-time "Add to Home Screen" hint for iPhone and
// iPad browsers.
//
// None of it runs in the Android app (window.Android), on a page opened from
// file://, or on localhost. A dev server must never serve scripts from a
// cache, so on localhost the service worker is opt-in: run
//     localStorage.setItem('bsr_dev_sw', '1')
// in the console, reload, and remove the key (and unregister the worker in
// DevTools → Application) when finished.
//
// Updates are silent. A new build installs in the background and takes over
// the next time every window of the app has been closed, so old and new files
// are never mixed in one session. See ARCHITECTURE.md, "Web build".
//
// Dependencies (runtime only, all globals by the time anything here runs):
//   t                      – i18n.js
//   Swal                   – sweetalert2.all.min.js
//   safeSetItem            – state.js / settings.js
//   window._appReady       – app-init.js (set once strings are loaded)

const SERVICE_WORKER_URL   = 'sw.js';
const A2HS_HINT_SEEN_KEY   = 'a2hs_hint_seen';
const A2HS_HINT_DELAY_MS   = 3000;
const A2HS_HINT_RETRY_MS   = 3000;
const A2HS_HINT_MAX_TRIES  = 20;
const APP_READY_POLL_MS    = 500;
const APP_READY_MAX_POLLS  = 20;

function _isLocalHost() {
  return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.hostname.endsWith('.localhost');
}

// True where the web-app features may run (see the header comment).
function webAppFeaturesEnabled() {
  if (window.Android) return false;
  if (location.protocol !== 'https:' && location.protocol !== 'http:') return false;
  if (_isLocalHost()) {
    try { return localStorage.getItem('bsr_dev_sw') === '1'; } catch (e) { return false; }
  }
  return true;
}

// Opened from the Home Screen (iOS sets navigator.standalone; other browsers
// report display-mode).
function isStandaloneWebApp() {
  if (window.navigator.standalone === true) return true;
  return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

// iPhone, iPod or iPad. Since iPadOS 13 an iPad's Safari reports a Mac, so it
// is told apart by being a "Mac" with a touch screen.
function isIosBrowser() {
  const nav = window.navigator;
  if (/iP(hone|ad|od)/.test(nav.userAgent)) return true;
  return nav.platform === 'MacIntel' && nav.maxTouchPoints > 1;
}

function registerServiceWorker() {
  if (!webAppFeaturesEnabled() || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(SERVICE_WORKER_URL).catch(err => {
    // Not fatal: the app works online without it.
    console.info('[web-app] service worker not registered:', err && err.message);
  });
}

// An installed app is the one case where asking is not a nuisance: Firefox
// shows a permission prompt for this request, but cannot install apps.
function requestPersistentStorage() {
  if (!webAppFeaturesEnabled() || !isStandaloneWebApp()) return;
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
}

// Whether the hint belongs on this device at all: an iPhone or iPad browser
// (not the installed app), after the first-run slides, and not shown before.
function addToHomeScreenHintApplies() {
  if (!webAppFeaturesEnabled() || !isIosBrowser() || isStandaloneWebApp()) return false;
  try {
    if (!localStorage.getItem('app_onboarding_complete')) return false;
    if (localStorage.getItem(A2HS_HINT_SEEN_KEY)) return false;
  } catch (e) { return false; }
  return true;
}

// Nothing else is asking for the reader's attention (the "What's New" slides,
// a dialog).
function screenIsFreeForHint() {
  if (document.querySelector('.onboarding-overlay')) return false;
  if (typeof Swal !== 'undefined' && Swal.isVisible()) return false;
  return true;
}

function showAddToHomeScreenHint() {
  safeSetItem(A2HS_HINT_SEEN_KEY, '1');
  Swal.fire({
    title: t('a2hs_title'),
    html: `<p>${t('a2hs_body')}</p>`,
    confirmButtonText: t('a2hs_ok'),
  });
}

// Offer the hint once. If the "What's New" slides or a dialog are up (they are
// on the second launch), keep checking for a minute, so the hint is not pushed
// back to a later launch.
function scheduleAddToHomeScreenHint(attempt = 0) {
  if (!addToHomeScreenHintApplies()) return;
  if (screenIsFreeForHint()) return showAddToHomeScreenHint();
  if (attempt < A2HS_HINT_MAX_TRIES) setTimeout(() => scheduleAddToHomeScreenHint(attempt + 1), A2HS_HINT_RETRY_MS);
}

// Strings are loaded a moment after the page; wait for them rather than show
// a hint made of keys.
function _whenAppReady(fn, polls = 0) {
  if (window._appReady) return fn();
  if (polls >= APP_READY_MAX_POLLS) return;
  setTimeout(() => _whenAppReady(fn, polls + 1), APP_READY_POLL_MS);
}

function initWebApp() {
  registerServiceWorker();
  requestPersistentStorage();
  _whenAppReady(() => setTimeout(scheduleAddToHomeScreenHint, A2HS_HINT_DELAY_MS));
}

window.addEventListener('load', initWebApp);
