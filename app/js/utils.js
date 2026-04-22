// ── BOOKMARKS / LAST POSITION ─────────────────────────────────────────────────
// Persists and restores the user's reading position (chapter index + scroll Y)
// in localStorage. Called by openSearch(), openLibrary(), and other functions
// that navigate away from a chapter, so the user can return to where they were.
//
// Dependencies (all available as globals before this file loads):
//   currentChapter, isNonChapterPage – main.js STATE section
//   goToChapter                      – main.js NAVIGATION section (runtime only)

// Returns the localStorage key for the current study's last position.
// Falls back to 'lastPosition' if no study is active (should not normally happen).
function _lastPositionKey() {
  return window.activeStudyId ? `lastPosition_${window.activeStudyId}` : 'lastPosition';
}

// Saves the current chapter index and scroll position to localStorage.
// Guarded by isNonChapterPage so positions on settings/progress pages are not saved.
function saveLastPosition() {
  if (isNonChapterPage) return;
  const pos = {
    chapterIdx: currentChapter,
    scrollY: window.scrollY
  };
  localStorage.setItem(_lastPositionKey(), JSON.stringify(pos));
}

// Removes the saved position for the current study from localStorage.
// Called after clearing all answers, since the position would point into a
// now-empty chapter and cause a confusing restore on next launch.
function clearLastPosition() {
  localStorage.removeItem(_lastPositionKey());
}

// Retrieves the saved position object ({ chapterIdx, scrollY }) for the current study.
// Returns null if none exists or if the stored JSON is malformed.
function getLastPosition() {
  try {
    const saved = localStorage.getItem(_lastPositionKey());
    return saved ? JSON.parse(saved) : null;
  } catch(e) {
    return null;
  }
}

// Navigates to the last saved chapter and restores the scroll position.
// The 100ms timeout allows renderChapter() to complete its DOM writes
// before scrollTo() is called.
function returnToLastPosition() {
  const pos = getLastPosition();
  if (!pos) return;
  goToChapter(pos.chapterIdx);
  setTimeout(() => window.scrollTo(0, pos.scrollY), 100);
}

// ── showToast TO SHOW TOASTS ──────────────────────────────────────────────────
/**
 * showToast(options)
 *
 * options:
 *   message    {string}  – text or HTML to display. Default: current toast text (no change).
 *   isHtml     {boolean} – if true, sets innerHTML instead of textContent. Default: false.
 *   isManual   {boolean} – if false, only shows when appSettings.autoSaveToast is on. Default: true.
 *   duration   {number}  – display time in ms. Default: auto-calculated from message length.
 *   elementId  {string}  – ID of the toast element to use. Default: 'toast'.
 *   resetText  {string}  – text to restore after hiding. Default: '✓ Answers saved'.
 */
function showToast({
  message    = null,
  isHtml     = false,
  isManual   = true,
  duration   = null,
  elementId  = 'toast',
  resetText  = t('utils_answers_saved')
} = {}) {
  if (!isManual && !appSettings.autoSaveToast) return;

  const toast = document.getElementById(elementId);
  if (!toast) return;

  if (message !== null) {
    if (isHtml) toast.innerHTML = message;
    else        toast.textContent = message;
  }

  const text     = toast.textContent;
  const auto     = Math.min(3500 + Math.max(0, text.length - 30) * 20, 10000);
  const ms       = duration ?? auto;

  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
    if (message !== null) {
      setTimeout(() => { toast.textContent = resetText; }, 300);
    }
  }, ms);
}

function showCelebrationToast(ch) {
  const flag = `bsr_${window.activeStudyId}_ch${ch.chapterNumber}_celebrated`;
  if (localStorage.getItem(flag)) return;
  localStorage.setItem(flag, '1');

  showToast({
    message:   `⭐ ${ch.chapterTitle} ⭐<br><span class="celebration-toast-sub">${t('utils_celebration_sub', { number: ch.chapterNumber })}</span><br><button class="celebration-toast-share" onclick="shareAnswers(); document.getElementById('celebrationToast').classList.remove('show')">${t('utils_celebration_share')} ${ICONS.share}</button>`,
    isHtml:    true,
    duration:  10000,
    elementId: 'celebrationToast',
    resetText: ''   // celebration toast has no default text to restore
  });
}

// ── LONG PRESS TO COPY ANSWER ─────────────────────────────────────────────────
// Detects a long press (600ms hold) on any answer field and copies its text to
// the clipboard, with brief visual feedback. Works alongside normal tap/scroll
// behaviour: touchmove cancels the timer so scrolling never triggers a copy.
//
// Dependencies: none (uses only DOM APIs and showCopyFeedback / copyToClipboard
// defined below; showToast was in save.js, but now in utils.js, & is loaded before main.js).

// Timer handle for the long-press detection.
let longPressTimer = null;
// Duration (ms) the user must hold before the copy action fires.
const LONG_PRESS_DURATION = 600; // ms

// Attaches touchstart / touchend / touchmove listeners to the document.
// Call once from the startup block — it listens on every answer field via
// event delegation (no need to re-attach when new fields are rendered).
function initLongPressCopy() {
  document.addEventListener('touchstart', e => {
    const field = e.target.closest('.answer-field');
    if (!field) return;
    longPressTimer = setTimeout(() => {
      const text = field.value.trim();
      if (!text) return;
      copyToClipboard(text);
      showCopyFeedback(field);
    }, LONG_PRESS_DURATION);
  }, { passive: true });

  document.addEventListener('touchend', () => {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  });

  document.addEventListener('touchmove', () => {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  });
}

// Copies text to the clipboard using the modern Clipboard API where available,
// falling back to the legacy execCommand approach via fallbackCopy().
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

// Legacy clipboard copy using a temporarily appended off-screen textarea.
// Used when navigator.clipboard is unavailable (e.g. non-HTTPS or older WebViews).
// NOTE: document.execCommand('copy') is deprecated but remains the most reliable
// fallback across older Android WebViews. Replace with navigator.clipboard
// everywhere once minimum WebView version supports it.
function fallbackCopy(text) {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed; top:-9999px; left:-9999px;';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}

// Provides visual feedback after a long-press copy: briefly turns the field
// border green and shows "✓ Answer copied" in the toast, then restores both.
//function showCopyFeedback(field) {
//  const original = field.style.borderColor;
//  field.style.transition = 'border-color 0.1s';
//  field.style.borderColor = 'var(--success)';
//
//  showToast({ message: '✓ Answer copied', duration: 3000 });
//  field.style.borderColor = original; 
//}

function showCopyFeedback(field) {
  const original = field.style.borderColor;
  field.style.transition = 'border-color 0.1s';
  field.style.borderColor = 'var(--success)';
  setTimeout(() => { field.style.borderColor = original; }, 1200);

  Swal.fire({
    toast: true,
    position: 'bottom',
    icon: 'success',
    title: t('utils_answer_copied'),
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true,
  });
}