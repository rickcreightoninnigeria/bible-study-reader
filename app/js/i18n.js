// ── i18n.js ───────────────────────────────────────────────────────────────────
// Language resolution, DOM application, and the t() function.
// Must load before app-init.js.
//
// Functions defined here:
//   resolveLanguage()               – returns the active language code
//   applyLanguageToDom(langCode)    – sets lang + dir on <html>
//   setLanguage(langCode)           – saves preference and triggers re-render
//   t(key, vars)                    – translates a UI string key
//   renderLangBadge(entry)          – returns badge <span> or flag for a LANGUAGE_MAP entry
//   currentLangFlag()               – returns the flag emoji for the active UI language
//
// Functions expected from app-init.js (available after DOMContentLoaded):
//   reloadLocaleAndRerender(lang)   – reloads locale files and re-renders


// ── LANGUAGE MAP ──────────────────────────────────────────────────────────────
// Single source of truth for all supported content and UI languages.
// flag:  the flag emoji shown in the tab label and on each language button.
// label: the language name written in that language (never translated).
// group: used to render regional dividers in the language picker.
// badge: optional { letter, bg } — used instead of flag when multiple languages
//        share the same national flag (e.g. Nigerian languages). Any language
//        entry can carry a badge; renderLangBadge() handles the fallback.

const LANGUAGE_MAP = {
  am:      { flag: '🇪🇹', label: 'አማርኛ (Amharic)',                                           group: 'africa' },
  ar:      { flag: '🇸🇦', label: 'العربية (Arabic)',            group: 'asia'   },
  az:      { flag: '🇦🇿', label: 'Azərbaycan (Azerbaijani)',    group: 'asia'   },
  bg:      { flag: '🇧🇬', label: 'Български (Bulgarian)',       group: 'europe' },
  bho:     { flag: '🇮🇳', label: 'भोजपुरी (Bhojpuri)',                                         group: 'asia',   badge: { letter: 'Bh', bg: '#FF9933' } },
  bo:      { flag: '🇨🇳', label: 'བོད་སྐད་ (Tibetan)',              group: 'asia',   badge: { letter: 'Bo', bg: '#DE2910' } },
  bs:      { flag: '🇧🇦', label: 'Bosanski (Bosnian)',          group: 'europe' },
  ceb:     { flag: '🇵🇭', label: 'Cebuano',                     group: 'asia',   badge: { letter: 'Ce', bg: '#0038A8' } },
  cs:      { flag: '🇨🇿', label: 'Čeština (Czech)',             group: 'europe' },
  cy:      { flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', label: 'Cymraeg (Welsh)',             group: 'europe' },
  da:      { flag: '🇩🇰', label: 'Dansk (Danish)',              group: 'europe' },
  de:      { flag: '🇩🇪', label: 'Deutsch (German)',            group: 'europe' },
  el:      { flag: '🇬🇷', label: 'Ελληνικά (Greek)',            group: 'europe' },
  en:      { flag: '🇬🇧', label: 'English',                     group: 'europe', badge: { letter: 'En', bg: '#1A56A0' }, alwaysBadge: true },
  es:      { flag: '🇪🇸', label: 'Español',                     group: 'europe' },
  et:      { flag: '🇪🇪', label: 'Eesti (Estonian)',            group: 'europe' },
  fa:      { flag: '🇮🇷', label: 'فارسی (Persian)',             group: 'asia'   },
  ff:      { flag: '🇳🇬', label: 'Fulfulde',                    group: 'africa', badge: { letter: 'Ff', bg: '#008751' } },
  fi:      { flag: '🇫🇮', label: 'Suomi (Finnish)',             group: 'europe' },
  fr:      { flag: '🇫🇷', label: 'Français',                    group: 'europe' },
  'fr-CA': { flag: '🇨🇦', label: 'Français (Canada)',           group: 'americas' },
  ga:      { flag: '🇮🇪', label: 'Gaeilge (Irish)',             group: 'europe' },
  gu:      { flag: '🇮🇳', label: 'ગુજરાતી (Gujarati)',                                      group: 'asia',   badge: { letter: 'Gu', bg: '#FF9933' } },
  ha:      { flag: '🇳🇬', label: 'Hausa',                       group: 'africa', badge: { letter: 'Ha', bg: '#008751' } },
  he:      { flag: '🇮🇱', label: 'עברית (Hebrew)',              group: 'asia'   },
  hi:      { flag: '🇮🇳', label: 'हिन्दी (Hindi)',                                                     group: 'asia',   badge: { letter: 'Hi', bg: '#FF9933' } },
  hr:      { flag: '🇭🇷', label: 'Hrvatski (Croatian)',         group: 'europe' },
  hu:      { flag: '🇭🇺', label: 'Magyar (Hungarian)',          group: 'europe' },
  hy:      { flag: '🇦🇲', label: 'Հայերեն (Armenian)',          group: 'asia'   },
  id:      { flag: '🇮🇩', label: 'Bahasa Indonesia',            group: 'asia',   badge: { letter: 'Id', bg: '#CE2028' } },
  ig:      { flag: '🇳🇬', label: 'Igbo',                        group: 'africa', badge: { letter: 'Ig', bg: '#008751' } },
  it:      { flag: '🇮🇹', label: 'Italiano (Italian)',          group: 'europe' },
  ja:      { flag: '🇯🇵', label: '日本語 (Japanese)',            group: 'asia'   },
  ka:      { flag: '🇬🇪', label: 'ქართული (Georgian)',          group: 'asia'   },
  kn:      { flag: '🇮🇳', label: 'ಕನ್ನಡ (Kannada)',                                             group: 'asia',   badge: { letter: 'Kn', bg: '#FF9933' } },
  ko:      { flag: '🇰🇷', label: '한국어 (Korean)',                 group: 'asia'   },
  kok:     { flag: '🇮🇳', label: 'कोंकणी (Konkani)',                                           group: 'asia',   badge: { letter: 'Ko', bg: '#FF9933' } },
  ks:      { flag: '🇮🇳', label: 'कॉशुर (Kashmiri)',                                           group: 'asia',   badge: { letter: 'Ks', bg: '#FF9933' } },
  lg:      { flag: '🇺🇬', label: 'Luganda',                     group: 'africa' },
  lt:      { flag: '🇱🇹', label: 'Lietuvių (Lithuanian)',       group: 'europe' },
  lv:      { flag: '🇱🇻', label: 'Latviešu (Latvian)',          group: 'europe' },
  mai:     { flag: '🇮🇳', label: 'मैथिली (Maithili)',                                          group: 'asia',   badge: { letter: 'Ma', bg: '#FF9933' } },
  mg:      { flag: '🇲🇬', label: 'Malagasy',                    group: 'africa' },
  mk:      { flag: '🇲🇰', label: 'Македонски (Macedonian)',     group: 'europe' },
  ml:      { flag: '🇮🇳', label: 'മലയാളം (Malayalam)',                               group: 'asia',   badge: { letter: 'Ml', bg: '#FF9933' } },
  mr:      { flag: '🇮🇳', label: 'मराठी (Marathi)',                                              group: 'asia',   badge: { letter: 'Mr', bg: '#FF9933' } },
  ms:      { flag: '🇲🇾', label: 'Bahasa Melayu',               group: 'asia'   },
  my:      { flag: '🇲🇲', label: 'မြန်မာစာ (Burmese)',            group: 'asia'   },
  ne:      { flag: '🇳🇵', label: 'नेपाली (Nepali)',                                                group: 'asia'   },
  nl:      { flag: '🇳🇱', label: 'Nederlands (Dutch)',          group: 'europe' },
  no:      { flag: '🇳🇴', label: 'Norsk (Norwegian)',           group: 'europe' },
  or:      { flag: '🇮🇳', label: 'ଓଡ଼ିଆ (Odia)',                                                     group: 'asia',   badge: { letter: 'Or', bg: '#FF9933' } },
  pa:      { flag: '🇮🇳', label: 'ਪੰਜਾਬੀ (Panjabi)',                                            group: 'asia',   badge: { letter: 'Pa', bg: '#FF9933' } },
  pl:      { flag: '🇵🇱', label: 'Polski (Polish)',             group: 'europe' },
  ps:      { flag: '🇦🇫', label: 'پښتو (Pashto)',               group: 'asia'   },
  pt:      { flag: '🇵🇹', label: 'Português',                   group: 'europe' },
  'pt-BR': { flag: '🇧🇷', label: 'Português (Brasil)',          group: 'americas' },
  ro:      { flag: '🇷🇴', label: 'Română (Romanian)',           group: 'europe', badge: { letter: 'Ro', bg: '#002B7F' } },
  rom:     { flag: '🇷🇴', label: 'Romani',                      group: 'europe', badge: { letter: 'Rm', bg: '#002B7F' } },
  ru:      { flag: '🇷🇺', label: 'Русский (Russian)',           group: 'europe' },
  sa:      { flag: '🇮🇳', label: 'संस्कृतम् (Sanskrit)',                                       group: 'asia',   badge: { letter: 'Sa', bg: '#FF9933' } },
  sd:      { flag: '🇵🇰', label: 'سنڌي (Sindhi)',               group: 'asia',   badge: { letter: 'Sd', bg: '#01411C' } },
  skr:     { flag: '🇵🇰', label: 'سرائیکی (Saraiki)',           group: 'asia',   badge: { letter: 'Sk', bg: '#01411C' } },
  sl:      { flag: '🇸🇮', label: 'Slovenščina (Slovenian)',     group: 'europe' },
  sr:      { flag: '🇷🇸', label: 'Српски (Serbian)',            group: 'europe' },
  su:      { flag: '🇮🇩', label: 'Basa Sunda (Sundanese)',      group: 'asia',   badge: { letter: 'Su', bg: '#CE2028' } },
  sv:      { flag: '🇸🇪', label: 'Svenska (Swedish)',           group: 'europe' },
  sw:      { flag: '🇰🇪', label: 'Kiswahili',                   group: 'africa' },
  ta:      { flag: '🇮🇳', label: 'தமிழ் (Tamil)',                                                   group: 'asia',   badge: { letter: 'Ta', bg: '#FF9933' } },
  te:      { flag: '🇮🇳', label: 'తెలుగు (Telugu)',                                 group: 'asia',   badge: { letter: 'Te', bg: '#FF9933' } },
  th:      { flag: '🇹🇭', label: 'ไทย (Thai)',                                                         group: 'asia'   },
  tk:      { flag: '🇹🇲', label: 'Türkmen (Turkmen)',           group: 'asia'   },
  tl:      { flag: '🇵🇭', label: 'Tagalog',                     group: 'asia',   badge: { letter: 'Tl', bg: '#0038A8' } },
  to:      { flag: '🇹🇴', label: 'Lea Faka-Tonga (Tongan)',     group: 'asia'   },
  uk:      { flag: '🇺🇦', label: 'Українська (Ukrainian)',      group: 'europe' },
  ur:      { flag: '🇵🇰', label: 'اردو (Urdu)',                 group: 'asia',   badge: { letter: 'Ur', bg: '#01411C' } },
  uz:      { flag: '🇺🇿', label: 'Oʻzbek (Uzbek)',              group: 'asia'   },
  vi:      { flag: '🇻🇳', label: 'Tiếng Việt (Vietnamese)',     group: 'asia'   },
  vmw:     { flag: '🇲🇿', label: 'Makhuwa',                     group: 'africa' },
  wo:      { flag: '🇸🇳', label: 'Wolof',                       group: 'africa' },
  xh:      { flag: '🇿🇦', label: 'isiXhosa (Xhosa)',            group: 'africa', badge: { letter: 'Xh', bg: '#007A4D' } },
  yo:      { flag: '🇳🇬', label: 'Yorùbá',                      group: 'africa', badge: { letter: 'Yo', bg: '#008751' } },
  'zh-CN': { flag: '🇨🇳', label: '简体中文 (Chinese simplified)', group: 'asia',   badge: { letter: 'Zh', bg: '#DE2910' } },
  zu:      { flag: '🇿🇦', label: 'isiZulu (Zulu)',              group: 'africa', badge: { letter: 'Zu', bg: '#007A4D' } },
};

// Derived from LANGUAGE_MAP so there is no separate list to maintain.
const SUPPORTED_LANGUAGES = Object.keys(LANGUAGE_MAP);

// RTL script languages — used by applyLanguageToDom() to set dir="rtl".
const RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur'];


// ── LANGUAGE HELPERS ──────────────────────────────────────────────────────────

// Returns a letter-badge <span> when the LANGUAGE_MAP entry has a badge
// property, otherwise returns the raw flag value (emoji or SVG string).
// Badge shape matches a flag: rectangular, coloured background, white letter.
// NOTE: the Settings page always uses the raw flag — the language name there
// is sufficient to distinguish same-flag languages. Use this only where space
// is tight and same-flag languages may appear together (e.g. library lang bar).
function renderLangBadge(entry) {
  if (entry && entry.badge) {
    return `<span class="lang-badge" style="--badge-bg:${entry.badge.bg}">${entry.badge.letter}</span>`;
  }
  return (entry && entry.flag) || '🌐';
}

// Returns the flag emoji for the currently active UI language, falling back
// to 🌐. Returns a badge for languages with alwaysBadge set, otherwise the raw flag.
// used in the Settings tab label where the language name alongside it is sufficient
// to distinguish same-flag languages.
function currentLangFlag() {
  const lang  = window.appLocale || resolveLanguage();
  const entry = LANGUAGE_MAP[lang];
  if (entry && entry.alwaysBadge) return renderLangBadge(entry);
  return (entry && entry.flag) || '🌐';
}


// ── LANGUAGE RESOLUTION ───────────────────────────────────────────────────────

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
