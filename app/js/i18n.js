// ── i18n.js ───────────────────────────────────────────────────────────────────
// Language resolution, DOM application, and the t() function.
// Must load before app-init.js.
//
// Functions defined here:
//   resolveLanguage()               – returns the active language code
//   applyLanguageToDom(langCode)    – sets lang + dir on <html>
//   setLanguage(langCode)           – saves preference and triggers re-render
//   t(key, vars)                    – translates a UI string key
//
// Functions expected from app-init.js (available after DOMContentLoaded):
//   reloadLocaleAndRerender(lang)   – reloads locale files and re-renders

const SUPPORTED_LANGUAGES = ['en', 'fr', 'es', 'pt', 'ha', 'ff', 'sw', 'ig', 'ms', 'yo', 'ne', 'am', 'ar'];
const RTL_LANGUAGES        = ['ar', 'he', 'fa', 'ur'];

function resolveLanguage() {
  // 1. User's saved preference
  const saved = localStorage.getItem('app_language');
  if (saved && SUPPORTED_LANGUAGES.includes(saved)) return saved;

  // 2. Browser/device language
  const browser = (navigator.language || 'en').split('-')[0].toLowerCase();
  if (SUPPORTED_LANGUAGES.includes(browser)) return browser;

  // 3. Default
  return 'en';
}

function applyLanguageToDom(langCode) {
  document.documentElement.setAttribute('lang', langCode);
  document.documentElement.setAttribute('dir',
    RTL_LANGUAGES.includes(langCode) ? 'rtl' : 'ltr'
  );
}

// Called from Settings when the user changes language.
// Saves the preference, then reloads locale files and re-renders the current
// view. Does NOT repeat one-time startup tasks (onboarding, registry clean…).
// reloadLocaleAndRerender() is defined in app-init.js.
function setLanguage(langCode) {
  localStorage.setItem('app_language', langCode);
  reloadLocaleAndRerender(langCode);
}

// ── t() ───────────────────────────────────────────────────────────────────────
// Looks up a UI string by key, with {placeholder} interpolation.
// Falls back to the key name if the string is missing — visible in the UI,
// which makes missing translations easy to spot during development.
//
// Usage:
//   t('delete_study')
//   t('orphan_warning', { count: 3 })
//   t('version_file', { version: 2 })

function t(key, vars) {
  const strings = window.appStrings || {};
  let str = strings[key];

  if (str === undefined) {
    console.warn(`[i18n] Missing translation key: "${key}" for lang: ${window.appLocale}`);
    return key; // key name shown in UI — easy to spot during development
  }

  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      str = str.replaceAll(`{${k}}`, v);
    });
  }

  return str;
}
