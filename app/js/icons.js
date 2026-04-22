// ── SVG ICONS ─────────────────────────────────────────────────────────────────
// This file contains all icon definitions and the theming machinery.
//
// ── HOW IT WORKS ──────────────────────────────────────────────────────────────
// 1. Named theme sets (ICONS_ROUNDED, ICONS_BOLD, ICONS_SOLID) each define the
//    complete set of icons in that visual style.
// 2. ICONS is the single live object used throughout the app. It is never
//    edited directly — it is populated by applyIconTheme() at boot, and
//    re-populated whenever the user changes their icon style in Settings.
// 3. applyIconTheme(name) copies the chosen set into ICONS, validates it,
//    then re-applies the static nav bar icons immediately. Dynamic (render-time)
//    icons take effect at the next natural navigation — no forced re-render.
// 4. The chosen theme is stored in appSettings.iconStyle and persisted to
//    localStorage alongside all other settings.
//
// ── ICON KEYS (canonical list — all theme sets must define every one) ─────────
//
//  NAV BAR (static; set once by initIcons(), re-set by applyIconTheme())
//    library, search, progress, howto, settings, contents, close
//
//  AUDIO / INPUT (injected at render time)
//    mic, micStop, speak, speakStop
//
//  LEARNING PATHWAY (toggled at runtime by libPathSetActive())
//    pathwayOff, pathwayOn
//
//  CONTENT / CHAPTER (injected at render time)
//    triggerInfo   – ⓘ info/popup trigger (verse modal, notes, go deeper)
//    externalLink  – ↗  opens an external URL (reserved for future use)
//    starEmpty     – ☆  unstarred state on question cards
//    starFilled    – ⭐ starred state on question cards & counts
//    chevronDown   – ▾  collapsible-panel open/close indicator
//    save          –    Save button (chapter save bar)
//    print         –    Print button (chapter save bar)
//    share         –    Share button (chapter save bar)
//    triggerSlides –    Triggers onboarding/tutorial slides (stacked-slides))
//    triggerSlidesNew – Same as triggerSlides, but with starburst top right; for tutorial slides that haven't been shown yet
//    checkAnswer   –    Triggers AI Tutor
//    localValidate –    Triggers local validation of answers to Bible-reference+Question
//
//  LIBRARY / STUDY MANAGEMENT (injected at render time)
//    download      –    Download study to device
//    upload        –    Load study from device
//    pin           –    Pin study (unpinned state)
//    pinFilled     –    Pin study (pinned state)
//    trash         –    Delete study from library
//    chevronRight  – ›  Study-row "go" indicator
//    triangleRight – ▶  Shelf / section expand toggle; path accordion
//    arrowUp       – ▲  Reorder-up button
//    arrowDown     – ▼  Reorder-down button
//
//  LANGUAGES / LOCALES
//    hausa         –    Arewa Knot
//    igbo          –    Isi Agu (Lion)
//    yoruba        –    Talking Drum
//    fulfulde      –    Fula Hat
//
// ── WHY iconsToMap DOESN'T COVER ALL ICONS ────────────────────────────────────
// initIcons() is only for the six *static* top-nav buttons that exist in the
// HTML shell and are set once on boot (or on theme change). All other icons are
// *dynamic* — written into innerHTML strings during renderChapter(),
// renderLibrary(), etc. each time a view rebuilds. Those read from ICONS.xxx
// directly and pick up the current theme at their next natural render.


// ══════════════════════════════════════════════════════════════════════════════
// THEME: ROUNDED
// The default theme. Lucide-style: 2 px stroke, round line-caps and joins,
// no fill. Friendly and modern.
// ══════════════════════════════════════════════════════════════════════════════

const ICONS_ROUNDED = {

  // ── Nav bar ───────────────────────────────────────────────────────────────
  library:      `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="m16 6 4 14M12 6v14M8 8v12M4 4v16"></path></svg>`,
  search:       `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
  progress:     `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>`,
  howto:        `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
  settings:     `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
  contents:     `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>`,
  close:        `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,

  // ── Audio / voice input ───────────────────────────────────────────────────
  mic:          `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><rect x="9" y="2" width="6" height="11" rx="3"></rect><path d="M19 10a7 7 0 0 1-14 0"></path><line x1="12" y1="19" x2="12" y2="22"></line><line x1="8" y1="22" x2="16" y2="22"></line></svg>`,
  micStop:      `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><rect x="9" y="2" width="6" height="11" rx="3"></rect><path d="M19 10a7 7 0 0 1-14 0"></path><line x1="12" y1="19" x2="12" y2="22"></line><line x1="8" y1="22" x2="16" y2="22"></line><line x1="2" y1="2" x2="22" y2="22"></line></svg>`,
  speak:        `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`,
  speakStop:    `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`,

  // ── Learning pathway toggle ───────────────────────────────────────────────
  pathwayOff:   `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>`,
  pathwayOn:    `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3" fill="white" stroke="white"></circle></svg>`,

  // ── Chapter content ───────────────────────────────────────────────────────
  triggerInfo:  `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="8"></line><line x1="12" y1="12" x2="12" y2="16"></line></svg>`,
  externalLink: `<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>`,
  starEmpty:    `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`,
  starFilled:   `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`,
  chevronDown:  `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polyline points="6 9 12 15 18 9"></polyline></svg>`,
  save:         `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`,
  print:        `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>`,
  share:        `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>`,
  checkAnswer:  `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path><polyline points="9 11 11 13 15 9"></polyline></svg>`,
  localValidate:`<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M12 3L4 6v5c0 4.42 3.36 8.56 8 9.56 4.64-1 8-5.14 8-9.56V6L12 3z"></path><polyline points="9 12 11 14 15 10"></polyline></svg>`,
  triggerSlides:`<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><rect x="2" y="7" width="14" height="14" rx="2" ry="2"></rect><path d="M17 15h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v2"></path></svg>`,
  triggerSlidesNew:`<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><rect x="2" y="7" width="14" height="14" rx="2" ry="2"></rect><path d="M17 15h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v2"></path><circle cx="19" cy="5" r="3" fill="currentColor" stroke="none"></circle></svg>`,

  // ── Library / study management ────────────────────────────────────────────
  download:     `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
  upload:       `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`,
  pin:          `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>`,
  pinFilled:    `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="12" y1="17" x2="12" y2="22" stroke="currentColor" fill="none"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>`,
  trash:        `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`,
  chevronRight: `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polyline points="9 18 15 12 9 6"></polyline></svg>`,
  triangleRight:`<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="currentColor" stroke-width="0" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`,
  arrowUp:      `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>`,
  arrowDown:    `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>`,

  // ── Languages / Locales ───────────────────────────────────────────────────

  // Hausa: The Arewa Knot (Interlaced diamond style)
  hausa:       `<svg viewBox="0 0 24 24" width="25" height="25" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M12 2l3 3h4v4l3 3-3 3v4h-4l-3 3-3-3H5v-4l-3-3 3-3V5h4l3-3z"></path><path d="M9 9l6 6M15 9l-6 6"></path></svg>`,
  // Igbo: Isi Agu (Simplified Lion head with mane detail)
  igbo:        `<svg viewBox="0 0 24 24" width="25" height="25" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M12 5c-4 0-7 2-7 6 0 3 2 5.5 5 6.5V20h4v-2.5c3-1 5-3.5 5-6.5 0-4-3-6-7-6z"></path><path d="M9 11h.01M15 11h.01M11 14h2M7 5L5 3M17 5l2-2"></path></svg>`,
  // Yorùbá: Gangan (Talking Drum with tension cords)
  yoruba:      `<svg viewBox="0 0 24 24" width="25" height="25" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M7 4h10M7 20h10"></path><path d="M7 4c2 4 2 12 0 16M17 4c-2 4-2 12 0 16"></path><path d="M12 4v16M9 5v14M15 5v14"></path></svg>`,
  // Fulfulde: Noopile (Fula conical hat with top knob and brim detail)
  fulfulde:    `<svg viewBox="0 0 24 24" width="25" height="25" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M12 3s8 8 8 14H4S12 3 12 3z"></path><path d="M4 17h16M12 3v-1M8 17s1-3 4-3 4 3 4 3"></path></svg>`,

};


// ══════════════════════════════════════════════════════════════════════════════
// THEME: BOLD  (placeholder — to be designed)
// 2.5 px stroke, round line-caps and joins, no fill.
// Heavier weight for higher contrast and a stronger visual presence.
// ══════════════════════════════════════════════════════════════════════════════

const ICONS_BOLD = {

  // ── Nav bar ───────────────────────────────────────────────────────────────
  library:      `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="m16 6 4 14M12 6v14M8 8v12M4 4v16"></path></svg>`,
  search:       `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
  progress:     `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>`,
  howto:        `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
  settings:     `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
  contents:     `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>`,
  close:        `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,

  // ── Audio / voice input ───────────────────────────────────────────────────
  mic:          `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><rect x="9" y="2" width="6" height="11" rx="3"></rect><path d="M19 10a7 7 0 0 1-14 0"></path><line x1="12" y1="19" x2="12" y2="22"></line><line x1="8" y1="22" x2="16" y2="22"></line></svg>`,
  micStop:      `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><rect x="9" y="2" width="6" height="11" rx="3"></rect><path d="M19 10a7 7 0 0 1-14 0"></path><line x1="12" y1="19" x2="12" y2="22"></line><line x1="8" y1="22" x2="16" y2="22"></line><line x1="2" y1="2" x2="22" y2="22"></line></svg>`,
  speak:        `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`,
  speakStop:    `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`,

  // ── Learning pathway toggle ───────────────────────────────────────────────
  pathwayOff:   `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>`,
  pathwayOn:    `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3" fill="white" stroke="white"></circle></svg>`,

  // ── Chapter content ───────────────────────────────────────────────────────
  triggerInfo:  `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="8"></line><line x1="12" y1="12" x2="12" y2="16"></line></svg>`,
  externalLink: `<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>`,
  starEmpty:    `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`,
  starFilled:   `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`,
  chevronDown:  `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polyline points="6 9 12 15 18 9"></polyline></svg>`,
  save:         `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`,
  print:        `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>`,
  share:        `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>`,
  checkAnswer:  `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path><polyline points="9 11 11 13 15 9"></polyline></svg>`,
  localValidate:`<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M12 3L4 6v5c0 4.42 3.36 8.56 8 9.56 4.64-1 8-5.14 8-9.56V6L12 3z"></path><polyline points="9 12 11 14 15 10"></polyline></svg>`,
  triggerSlides:`<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><rect x="2" y="7" width="14" height="14" rx="2" ry="2"></rect><path d="M17 15h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v2"></path></svg>`,
  triggerSlidesNew:`<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><rect x="2" y="7" width="14" height="14" rx="2" ry="2"></rect><path d="M17 15h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v2"></path><circle cx="19" cy="5" r="3" fill="currentColor" stroke="none"></circle></svg>`,

  // ── Library / study management ────────────────────────────────────────────
  download:     `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
  upload:       `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`,
  pin:          `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>`,
  pinFilled:    `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="12" y1="17" x2="12" y2="22" stroke="currentColor" fill="none"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>`,
  trash:        `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`,
  chevronRight: `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polyline points="9 18 15 12 9 6"></polyline></svg>`,
  triangleRight:`<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="currentColor" stroke-width="0" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`,
  arrowUp:      `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>`,
  arrowDown:    `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>`,

  // ── Languages / Locales ───────────────────────────────────────────────────
  // Hausa: Arewa Knot - simplified to a bold geometric interlocking diamond
  hausa: `<svg viewBox="0 0 24 24" width="25" height="25" stroke="currentColor" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M12 3l4 4h3v3l3 3-3 3v3h-3l-4 4-4-4H5v-3l-3-3 3-3V7h3l4-4z"></path></svg>`,
  // Igbo: Isi Agu - simplified to the distinct silhouette of the lion head
  igbo: `<svg viewBox="0 0 24 24" width="25" height="25" stroke="currentColor" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M12 6c-3 0-5 2-5 5 0 2 1 4 3 5v3h4v-3c2-1 3-3 3-5 0-3-2-5-5-5z"></path><path d="M9 11h.01M15 11h.01M7 6L5 4M17 6l2-2"></path></svg>`,
  // Yorùbá: Gangan - focused on the hourglass frame and central tension line
  yoruba: `<svg viewBox="0 0 24 24" width="25" height="25" stroke="currentColor" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M8 5h8M8 19h8"></path><path d="M8 5c1.5 3 1.5 11 0 14M16 5c-1.5 3-1.5 11 0 14"></path><line x1="12" y1="5" x2="12" y2="19"></line></svg>`,
  // Fulfulde: Noopile - simplified conical hat with a bold base
  fulfulde: `<svg viewBox="0 0 24 24" width="25" height="25" stroke="currentColor" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M12 4s7 7 7 13H5s7-13 7-13z"></path><line x1="8" y1="17" x2="16" y2="17"></line></svg>`,

};

// ══════════════════════════════════════════════════════════════════════════════
// THEME: SOLID  (placeholder — to be designed)
// Filled icons throughout. Genuinely different path designs where needed
// (e.g. settings gear, library stack, mic). High contrast, flat aesthetic.
// ══════════════════════════════════════════════════════════════════════════════

const ICONS_SOLID = {

  // ── Nav bar ───────────────────────────────────────────────────────────────
  // library: three filled vertical bars of increasing height
  library:      `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="display:inline-block; vertical-align:middle;"><rect x="3" y="3" width="4" height="18" rx="1"></rect><rect x="10" y="6" width="4" height="15" rx="1"></rect><rect x="17" y="9" width="4" height="12" rx="1"></rect></svg>`,
  // search: filled circle with filled handle
  search:       `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M10.5 2a8.5 8.5 0 1 0 5.37 15.08l3.77 3.77a1.5 1.5 0 0 0 2.12-2.12l-3.77-3.77A8.5 8.5 0 0 0 10.5 2zm0 3a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z"></path></svg>`,
  // progress: filled heartbeat / pulse waveform
  progress:     `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M2 12h3.5l2.5-7 3 14 3-9 2 4H22v-2h-4.5l-1.5-3-3 9-3-14-2.5 7H2v2z"></path></svg>`,
  // howto: filled circle with solid ? mark
  howto:        `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm1.07-7.75l-.9.92C12.45 10.9 12 11.5 12 13h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H9c0-1.66 1.34-3 3-3s3 1.34 3 3c0 .66-.27 1.26-.69 1.69l-.24.31z"></path></svg>`,
  // settings: filled gear using a clip-path approach — outer filled circle minus inner circle, with filled teeth
  settings:     `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a6.93 6.93 0 0 0-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.07.63-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"></path></svg>`,
  // contents: three filled horizontal bars (hamburger)
  contents:     `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="display:inline-block; vertical-align:middle;"><rect x="3" y="5" width="18" height="2.5" rx="1.25"></rect><rect x="3" y="10.75" width="18" height="2.5" rx="1.25"></rect><rect x="3" y="16.5" width="18" height="2.5" rx="1.25"></rect></svg>`,
  // close: two filled rounded rectangles crossing diagonally
  close:        `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"></path></svg>`,

  // ── Audio / voice input ───────────────────────────────────────────────────
  // mic: filled capsule body + filled arc base
  mic:          `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4zm-6.5 9A1 1 0 0 0 4.5 11a7.5 7.5 0 0 0 7 7.45V20H9.5a1 1 0 0 0 0 2h5a1 1 0 0 0 0-2H13v-1.55A7.5 7.5 0 0 0 19.5 11a1 1 0 0 0-2 0 5.5 5.5 0 0 1-11 0 1 1 0 0 0-1-1z"></path></svg>`,
  // micStop: same filled mic + filled diagonal slash
  micStop:      `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4zm-6.5 9A1 1 0 0 0 4.5 11a7.5 7.5 0 0 0 7 7.45V20H9.5a1 1 0 0 0 0 2h5a1 1 0 0 0 0-2H13v-1.55A7.5 7.5 0 0 0 19.5 11a1 1 0 0 0-2 0 5.5 5.5 0 0 1-11 0 1 1 0 0 0-1-1z"></path><path d="M3.41 1.59a1 1 0 0 0-1.41 1.41l18 18a1 1 0 0 0 1.41-1.41l-18-18z"></path></svg>`,
  // speak: filled speaker cone + two filled arcs for sound waves
  speak:        `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z"></path><path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77 0-4.28-2.99-7.86-7-8.77z"></path></svg>`,
  // speakStop: filled speaker cone + filled X
  speakStop:    `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M3 9v6h4l5 5V4L7 9H3zm14.59 3L21 8.59 19.59 7.17 16.17 10.6l-3.41-3.43L11.34 8.6l3.41 3.4-3.41 3.42 1.42 1.41 3.41-3.41 3.42 3.41L21 15.41 17.59 12z"></path></svg>`,

  // ── Learning pathway toggle ───────────────────────────────────────────────
  // pathwayOff: filled map-pin outline (filled border, hollow inside)
  pathwayOff:   `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"></path></svg>`,
  // pathwayOn: fully filled map-pin — same shape, inner dot also filled white
  pathwayOn:    `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" fill="currentColor"></path><circle cx="12" cy="9" r="2.5" fill="white"></circle></svg>`,

  // ── Chapter content ───────────────────────────────────────────────────────
  // triggerInfo: fully filled circle with white i
  triggerInfo:  `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"></path></svg>`,
  // externalLink: filled arrow-in-box
  externalLink: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"></path></svg>`,
  // starEmpty: filled star outline (ring of star shape, hollow centre via even-odd)
  starEmpty:    `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path fill-rule="evenodd" d="M12 2l2.65 5.86 6.35.93-4.6 4.5 1.09 6.34L12 16.77l-5.49 2.86 1.09-6.34L3 8.79l6.35-.93L12 2zm0 3.24L10.02 9.6l-4.38.64 3.17 3.1-.75 4.37L12 15.5l3.94 2.1-.75-4.36 3.17-3.1-4.38-.64L12 5.24z"></path></svg>`,
  // starFilled: fully filled star
  starFilled:   `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M12 2l2.65 5.86 6.35.93-4.6 4.5 1.09 6.34L12 16.77l-5.49 2.86 1.09-6.34L3 8.79l6.35-.93L12 2z"></path></svg>`,
  // chevronDown: filled downward-pointing chevron (solid wedge)
  chevronDown:  `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"></path></svg>`,
  // save: filled floppy disk
  save:         `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z"></path></svg>`,
  // print: filled printer body
  print:        `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm-1-9H6v4h12V3z"></path></svg>`,
  // share: filled share/network dots-and-lines
  share:        `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 0 0 18 8a3 3 0 1 0-3-3c0 .24.04.47.09.7L8.04 9.81A3 3 0 0 0 6 9a3 3 0 1 0 3 3c0-.24-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 0 0 18 16.08z"></path><circle cx="18" cy="5" r="2"></circle><circle cx="6" cy="12" r="2"></circle><circle cx="18" cy="19" r="2"></circle></svg>`,
  // checkAnswer: filled speech bubble with a white checkmark
  checkAnswer:  `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-5.3 9.71l-3 3a1 1 0 0 1-1.42 0l-1.5-1.5a1 1 0 1 1 1.42-1.42l.79.79 2.29-2.29a1 1 0 0 1 1.42 1.42z"></path></svg>`,
  // localValidate – Triggers local (offline) answer validation
  localValidate: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M12 2L3 6v5.5C3 16.52 6.96 21.2 12 22c5.04-.8 9-5.48 9-10.5V6L12 2zm-1 13.41l-3.5-3.5 1.41-1.41L11 12.59l4.59-4.58L17 9.42l-6 6z"></path></svg>`,
  // triggerSlides: fill card x3
  triggerSlides:`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M2 9a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9z"></path><path d="M8 5V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-2V9a3 3 0 0 0-3-3H8z"></path></svg>`,
  // triggerSlidesNew: same filled slides + filled 4-pointed star top-right, signalling the tutorial has never been played. Once played, triggerSlides is used.
  triggerSlidesNew:`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M2 9a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9z"></path><path d="M8 5V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-2V9a3 3 0 0 0-3-3H8z"></path><circle cx="19" cy="5" r="3"></circle></svg>`,

  // ── Library / study management ────────────────────────────────────────────
  // download: filled tray with filled down-arrow
  download:     `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M19 9h-4V3H9v6H5l7 7 7-7zm-8 10v2h2v-2h-2zm0-4v2h2v-2h-2zM5 19h14v2H5v-2z"></path></svg>`,
  // upload: filled tray with filled up-arrow
  upload:       `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"></path></svg>`,
  // pin: filled pin/pushpin shape
  pin:          `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M16 9V4h1a1 1 0 0 0 0-2H7a1 1 0 0 0 0 2h1v5l-2 3h12l-2-3zM11 21v-7h2v7a1 1 0 0 1-2 0z"></path></svg>`,
  // pinFilled: same shape but with accent treatment — visually distinct from pin
  pinFilled:    `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M16 9V4h1a1 1 0 0 0 0-2H7a1 1 0 0 0 0 2h1v5l-2 3h12l-2-3zM11 21v-7h2v7a1 1 0 0 1-2 0z"></path><circle cx="12" cy="9" r="2.5" fill="white"></circle></svg>`,
  // trash: filled bin with lid
  trash:        `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"></path></svg>`,
  // chevronRight: filled rightward wedge
  chevronRight: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6-6-6z"></path></svg>`,
  // triangleRight: filled solid triangle (same as rounded — already filled)
  triangleRight:`<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="display:inline-block; vertical-align:middle;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`,
  // arrowUp: filled upward arrow (solid shaft + head)
  arrowUp:      `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"></path></svg>`,
  // arrowDown: filled downward arrow
  arrowDown:    `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z"></path></svg>`,

  // ── Languages / Locales ───────────────────────────────────────────────────
  // Hausa: Arewa Knot - Bold interlocking silhouette
  hausa: `<svg viewBox="0 0 24 24" width="25" height="25" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path fill-rule="evenodd" d="M12 2l3 3h4v4l3 3-3 3v4h-4l-3 3-3-3H5v-4l-3-3 3-3V5h4l3-3zm0 7.5L14.5 12 12 14.5 9.5 12 12 9.5z"></path></svg>`,
  // Igbo: Isi Agu - Strong lion silhouette with stylized features
  igbo: `<svg viewBox="0 0 24 24" width="25" height="25" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M12 2C7.58 2 4 5.58 4 10c0 2.5 1.5 4.5 3.5 5.5V19c0 1.1.9 2 2 2h5c1.1 0 2-.9 2-2v-3.5c2-.9 3.5-3 3.5-5.5 0-4.42-3.58-8-8-8zm-2 9H8V9h2v2zm6 0h-2V9h2v2zm-3 4h-2v-2h2v2z"></path></svg>`,
  // Yorùbá: Gangan - Solid hourglass silhouette with central division
  yoruba: `<svg viewBox="0 0 24 24" width="25" height="25" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M17 4H7v2c2 3 2 9 0 12v2h10v-2c-2-3-2-9 0-12V4zm-4 14h-2V6h2v12z"></path></svg>`,
  // Fulfulde: Noopile - Classic conical hat silhouette with internal band
  fulfulde: `<svg viewBox="0 0 24 24" width="25" height="25" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path fill-rule="evenodd" d="M12 2L4 16c0 3 4 4 8 4s8-1 8-4L12 2zm0 15c-2.5 0-4.5-.5-5.5-1.25L12 6.5l5.5 9.25c-1 .75-3 1.25-5.5 1.25z"></path></svg>`,
};

// ══════════════════════════════════════════════════════════════════════════════
// CANONICAL KEY LIST
// Derived once from ICONS_ROUNDED (the complete reference set).
// Used by validateIconTheme() to catch missing keys in other themes.
// ══════════════════════════════════════════════════════════════════════════════

const ICON_KEYS = Object.keys(ICONS_ROUNDED);


// ══════════════════════════════════════════════════════════════════════════════
// THEME REGISTRY
// Maps the string stored in appSettings.iconStyle to its theme object.
// Add new themes here when they are ready.
// ══════════════════════════════════════════════════════════════════════════════

const ICON_THEMES = {
  rounded: ICONS_ROUNDED,
  bold:    ICONS_BOLD,
  solid:   ICONS_SOLID,
};

// Human-readable labels for the Settings UI.
const ICON_THEME_LABELS = [
  { value: 'rounded', label: 'Rounded' },
  { value: 'bold',    label: 'Bold'    },
  { value: 'solid',   label: 'Solid'   },
];


// ══════════════════════════════════════════════════════════════════════════════
// VALIDATION
// Checks that a theme set contains every key defined in ICONS_ROUNDED.
// Logs a warning for each missing key. Returns true if the set is complete.
// Called by applyIconTheme() before applying, so a broken theme never silently
// leaves blank buttons in the UI.
// ══════════════════════════════════════════════════════════════════════════════

function validateIconTheme(name, themeObj) {
  const missing = ICON_KEYS.filter(k => !themeObj[k]);
  if (missing.length === 0) return true;
  console.warn(
    `[icons] Theme "${name}" is missing ${missing.length} key(s): ${missing.join(', ')}. ` +
    `Falling back to "rounded" for missing icons.`
  );
  return false;
}


// ══════════════════════════════════════════════════════════════════════════════
// LIVE ICONS OBJECT
// The single object referenced throughout the app. Populated by
// applyIconTheme() — never edited directly.
// ══════════════════════════════════════════════════════════════════════════════

const ICONS = {};


// ══════════════════════════════════════════════════════════════════════════════
// applyIconTheme(name)
// Copies the named theme into ICONS, falling back key-by-key to ICONS_ROUNDED
// for any missing entries (so incomplete in-progress themes never break the UI).
// Then re-applies the static nav bar icons immediately via initIcons().
// Dynamic icons take effect at the next natural navigation.
// ══════════════════════════════════════════════════════════════════════════════

function applyIconTheme(name) {
  const theme = ICON_THEMES[name] || ICONS_ROUNDED;

  // Validate first (logs warnings but does not block)
  if (theme !== ICONS_ROUNDED) {
    validateIconTheme(name, theme);
  }

  // Copy chosen theme into ICONS, falling back to ICONS_ROUNDED per key
  ICON_KEYS.forEach(k => {
    ICONS[k] = theme[k] || ICONS_ROUNDED[k];
  });

  // Re-apply static nav bar icons immediately
  initIcons();
}


// ══════════════════════════════════════════════════════════════════════════════
// initIcons()
// Sets the six static top-nav button icons from the current ICONS object.
// Called by applyIconTheme() at boot and on every theme change.
// Only nav buttons belong here — all other icons are dynamic and are read
// from ICONS.xxx directly each time their view rebuilds.
// ══════════════════════════════════════════════════════════════════════════════

function initIcons() {
  const iconsToMap = [
    { id: 'navLibBtn',      icon: ICONS.library  },
    { id: 'navSearchBtn',   icon: ICONS.search   },
    { id: 'navProgressBtn', icon: ICONS.progress },
    { id: 'navHowtoBtn',    icon: ICONS.howto    },
    { id: 'navSettingsBtn', icon: ICONS.settings },
    { id: 'menuBtn',        icon: ICONS.contents },
  ];
  iconsToMap.forEach(item => {
    const el = document.getElementById(item.id);
    if (el) el.innerHTML = item.icon;
  });
}
