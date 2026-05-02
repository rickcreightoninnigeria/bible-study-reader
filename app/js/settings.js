// ── SETTINGS ──────────────────────────────────────────────────────────────────

// Default values for all settings. Any key not found in localStorage falls back
// to this object. Add new settings here with their default value.
const SETTINGS_DEFAULTS = {
  answerFieldSize    :'medium',
  autoSaveToast      :true,
  darkMode           :false,
  fontSize           :16,
  iconStyle          :'rounded',
  interfaceMode      :'basic',
  libShowEmptyAmount :'none',
  libShowPathsAmount :'few',
  libShowPathsTab    :'on',
  libShowRecent      :'>5',
  libShowShelvesTab  :'on',
  localValidateMode  :'auto',
  rememberPosition   :true,
  shareFormat        :'formatted',
  showCheckAnswerBtn :false,
  showLibraryPaths   :false,
  showNavButtons     :true,
  showPageAbout      :true,
  showPageHowToUse   :true,
  showPageLeaders    :false,
  showPageNotes      :false,
  showPageProgress   :true,
  showProgressBar    :true,
  swipeSensitivity   :'low',
  ttsMode            :'always',
  useSansSerif       :true,
};

// Defaults that are applied the FIRST TIME a user moves from Basic → Intermediate.
// These differ from SETTINGS_DEFAULTS (which are used for clean installs only).
// On a clean install these values are already correct, so this object only matters
// when an existing Basic user upgrades — we nudge specific settings to better
// Intermediate defaults without overwriting anything else they may have changed.
const INTERMEDIATE_FIRST_DEFAULTS = {
  showPageProgress: true,
};

// Live settings object — always a merged copy of defaults + whatever is in localStorage.
let appSettings = { ...SETTINGS_DEFAULTS };

function initSettings() {
  const saved = localStorage.getItem('appSettings');
  if (saved) {
    try {
      appSettings = { ...SETTINGS_DEFAULTS, ...JSON.parse(saved) };
    } catch(e) {
      appSettings = { ...SETTINGS_DEFAULTS };
    }
  }
  applyAllSettings();
  applyIconTheme(appSettings.iconStyle);
}

function saveSetting(key, value) {
  appSettings[key] = value;
  localStorage.setItem('appSettings', JSON.stringify(appSettings));
  applyAllSettings();
  if (key === 'iconStyle') applyIconTheme(value);
  updateSettingControl(key, value);
  updateSettingsControls();
}

// Sets the Interface Mode (basic / intermediate / advanced).
// On the first-ever transition from basic → intermediate, applies
// INTERMEDIATE_FIRST_DEFAULTS for any settings not yet explicitly set by the user.
// "Not yet explicitly set" means the stored value still matches the Basic-era default.
function setInterfaceMode(newMode) {
  const previousMode = appSettings.interfaceMode || 'basic';

  // First-ever Basic → Intermediate promotion: nudge selected defaults.
  if (previousMode === 'basic' && newMode === 'intermediate') {
    const alreadyPromoted = localStorage.getItem('intermediateDefaultsApplied');
    if (!alreadyPromoted) {
      // Only override settings that are still at their Basic-era default value,
      // so we don't clobber anything the user deliberately changed.
      Object.entries(INTERMEDIATE_FIRST_DEFAULTS).forEach(([key, newDefault]) => {
        if (appSettings[key] === SETTINGS_DEFAULTS[key]) {
          appSettings[key] = newDefault;
        }
      });
      localStorage.setItem('intermediateDefaultsApplied', '1');
    }
  }

  saveSetting('interfaceMode', newMode);
}

// Convenience getter — use this throughout the codebase instead of
// reading appSettings.interfaceMode directly, for clarity.
function getInterfaceMode() {
  return appSettings.interfaceMode || 'basic';
}

function updateSettingControl(key, value) {
  // Toggles: match by data-setting-key attribute
  document.querySelectorAll(`.settings-toggle[data-setting-key="${key}"]`).forEach(toggle => {
    toggle.classList.toggle('on', !!value);
  });

  // Segmented buttons: match by data-setting-key, activate by data-setting-value
  document.querySelectorAll(`.settings-seg-btn[data-setting-key="${key}"]`).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.settingValue === String(value));
  });
}

// Applies all current appSettings values to the DOM: font size on <html>,
// dark-mode class on <body>, progress bar visibility, and answer field height.
// Also injects a dynamic <style> tag so future-rendered answer fields
// inherit the correct min-height without needing JS to run on each one.

function applyAllSettings() {
  // 1. Font Family (The "One-Place" Fix)
  const fontChoice = appSettings.useSansSerif ? 'var(--font-stack-sans)' : 'var(--font-stack-serif)';
  document.documentElement.style.setProperty('--main-font-family', fontChoice);

  // 2. Font size
  // Font size
  document.documentElement.style.fontSize = appSettings.fontSize + 'px';

  // 3. Dark mode
  document.body.classList.toggle('dark-mode', appSettings.darkMode);

  // 4. Progress bar
  const pb = document.getElementById('progressBar');
  if (pb) pb.style.display = appSettings.showProgressBar ? '' : 'none';
  
  // 5. Answer field height
  const answerFields = document.querySelectorAll('.answer-field');
  answerFields.forEach(f => f.style.minHeight = getAnswerFieldMinHeight());

  // Also inject a dynamic style rule for future-rendered fields
  let dynStyle = document.getElementById('dynamic-settings-style');
  if (!dynStyle) {
    dynStyle = document.createElement('style');
    dynStyle.id = 'dynamic-settings-style';
    document.head.appendChild(dynStyle);
  }
  dynStyle.textContent = `.answer-field { min-height: ${getAnswerFieldMinHeight()} !important; } #globalNotesField { min-height: 450px !important; }`;
  updateNavButtons(null);  // show/hide Progress and HowTo buttons per settings

  // 6. Check-answer button visibility
  applyCheckAnswerBtnVisibility();
}

// Clamps px to [FONT_MIN, FONT_MAX] and saves it as the fontSize setting.
function setFontSize(px) {
  const clamped = Math.min(FONT_MAX, Math.max(FONT_MIN, px));
  saveSetting('fontSize', clamped);
  
  // Apply to the whole app immediately
  document.documentElement.style.fontSize = clamped + 'px'; 
  
  // If the settings page is open, update the label and dots
  const label = document.getElementById('settings-size-label');
  if (label) label.textContent = clamped + 'px';
  
  updateSettingsControls(); 
}

// Returns the minimum swipe distance (px) required to trigger chapter navigation,
// based on the current swipeSensitivity setting (low/medium/high).
function getSwipeThreshold() {
  const map = { low: 160, medium: 100, high: 55 };
  return map[appSettings.swipeSensitivity] || 100;
}

// Refreshes the font size controls on the Settings page: updates the preview
// text size, the size label, enables/disables the +/- buttons at the limits,
// and highlights the active dot on the size track.
function updateSettingsControls() {
  const preview = document.getElementById('settings-preview');
  const label = document.getElementById('settings-size-label');
  const minBtn = document.getElementById('settings-btn-minus');
  const maxBtn = document.getElementById('settings-btn-plus');
  const dots = document.querySelectorAll('.settings-size-dot');

  if (preview) preview.style.fontSize = appSettings.fontSize + 'px';
  if (label) label.textContent = appSettings.fontSize + 'px';
  if (minBtn) minBtn.disabled = appSettings.fontSize <= FONT_MIN;
  if (maxBtn) maxBtn.disabled = appSettings.fontSize >= FONT_MAX;

  const steps = (FONT_MAX - FONT_MIN) / FONT_STEP;
  const currentStep = (appSettings.fontSize - FONT_MIN) / FONT_STEP;
  dots.forEach((dot, i) => dot.classList.toggle('active', i === currentStep));
}

// Shows a custom confirmation dialog before clearing all saved answers.
// Uses a dynamically created overlay rather than the native confirm() dialog,
// which is blocked on some mobile WebViews and cannot be styled.
// On confirmation, deletes all localStorage keys with the 'bsr_' prefix,
// resets the onboarding flag so the intro plays again on next launch,
// and immediately shows the onboarding overlay.

function confirmClearAnswers() {
  Swal.fire({
    title:             t('settings_clear_answers_title'),
    text:              t('settings_clear_answers_body'),
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: t('settings_clear_answers_confirm'),
    cancelButtonText:  t('settings_clear_answers_cancel'),
    reverseButtons: true,
  }).then(result => {
    if (!result.isConfirmed) return;
    const keysToDelete = [];
    const currentStudyId = window.activeStudyId;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`bsr_${currentStudyId}_`)) keysToDelete.push(key);
    }
    keysToDelete.forEach(k => localStorage.removeItem(k));
    clearLastPosition();
    currentChapter = 0;
    showToast({ message: t('settings_clear_answers_toast'), isManual: true });
    renderMenu();
    Router.navigate({ page: 'title' });
  });
}

function resetToDefaults() {
  Swal.fire({
    title:             t('settings_reset_title'),
    html:              t('settings_reset_body'),
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: t('settings_reset_confirm'),
    cancelButtonText:  t('settings_reset_cancel'),
    reverseButtons: true,
  }).then(result => {
    if (!result.isConfirmed) return;
    appSettings = { ...SETTINGS_DEFAULTS };
    localStorage.setItem('appSettings', JSON.stringify(appSettings));
    localStorage.removeItem('intermediateDefaultsApplied');
    applyAllSettings();
    localStorage.removeItem('onboardingComplete');
    localStorage.removeItem('app_onboarding_complete');
    showToast({ message: t('settings_reset_toast'), isManual: true });
    Router.replaceState({ page: 'settings', tabId: window.activeTabId });
    renderSettings(window.activeTabId);
  });
}

async function resetAllData() {
  // Two-step confirmation — the second prompt requires typing to proceed.
  const step1 = await Swal.fire({
    title:             t('settings_resetall_title'),
    html:              t('settings_resetall_body'),
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: t('settings_resetall_confirm'),
    cancelButtonText:  t('settings_resetall_cancel'),
    reverseButtons: true,
  });
  if (!step1.isConfirmed) return;

  const step2 = await Swal.fire({
    title:             t('settings_resetall_confirm2_title'),
    html:              t('settings_resetall_confirm2_body'),
    input: 'text',
    inputPlaceholder:  t('settings_resetall_confirm2_placeholder'),
    inputAttributes: { autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off' },
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: t('settings_resetall_confirm2_btn'),
    cancelButtonText:  t('settings_resetall_cancel'),
    reverseButtons: true,
    preConfirm: (val) => {
      if (val.trim().toLowerCase() !== t('settings_resetall_confirm2_keyword').toLowerCase()) {
        Swal.showValidationMessage(t('settings_resetall_confirm2_mismatch'));
        return false;
      }
      return true;
    },
  });
  if (!step2.isConfirmed) return;

  // 1. Wipe all localStorage
  localStorage.clear();

  // 2. Wipe all IndexedDB stores
  try {
    await StudyIDB.clearAll();
  } catch (e) {
    // IDB unavailable or already empty — not fatal, continue
    console.warn('resetAllData: IDB clear failed', e);
  }

  // 3. Reload the app fresh — no state to restore
  window.location.reload();
}

// Returns the CSS min-height string for answer textareas based on
// the answerFieldSize setting (small/medium/large).
function getAnswerFieldMinHeight() {
  const map = { small: '50px', medium: '100px', large: '200px' };
  return map[appSettings.answerFieldSize] || '80px';
}

// Returns true if the checkAnswer (AI tutor) button should be rendered on
// question cards. Controlled by the showCheckAnswerBtn setting, which is
// only exposed in the Settings UI when interfaceMode === 'advanced'.
function showCheckAnswerButton() {
  return !!appSettings.showCheckAnswerBtn;
}

// Shows or hides all .check-answer-btn elements currently in the DOM,
// matching the showCheckAnswerBtn setting. Called by applyAllSettings()
// so that toggling the setting from the Settings page takes effect
// immediately without a re-render.
function applyCheckAnswerBtnVisibility() {
  const visible = appSettings.showCheckAnswerBtn;
  document.querySelectorAll('.check-answer-btn').forEach(btn => {
    btn.style.display = visible ? '' : 'none';
  });
}

// Expands a textarea to fit its content by temporarily collapsing it to 'auto'
// then growing it to scrollHeight. Called on every input event (oninput handler).
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
