// ── LIBRARY ───────────────────────────────────────────────────────────────────
// Library history helpers (recent/pinned lists), reorder mode, and the full
// renderLibrary() function with all its tab builders (Load, All, Recent,
// Shelves, Paths) and associated toggle/mode helpers.
//
// Dependencies (all available as globals before this file loads):
//   StudyIDB              – idb.js
//   ICONS                 – icons.js
//   appSettings           – settings.js
//   showToast             – utils.js
//   window.appAboutData, window._libActiveTab, window._libShowPaths,
//   window._libTabs, window.activeTabId – state.js
//   activateStudy, deleteStudy,
//   handleFileSelect, openDriveStudyFolder,
//   showVersionWarning    – study-loader.js (runtime calls only)

// ── LIBRARY HISTORY HELPERS ──────────────────────────────────────────────────
// Recently installed: list of studyIds in install order (newest first), max 4.
// Recently opened:    list of studyIds in open order (newest first), max 7.
// Pinned:             array of studyIds pinned to the top of the Recent tab.
// All stored in localStorage as JSON arrays.

const RECENT_INSTALLED_KEY = 'lib_recent_installed'; // newest-first, max 4
const RECENT_OPENED_KEY    = 'lib_recent_opened';    // newest-first, max 7
const PINNED_KEY           = 'lib_pinned';           // ordered array
const PINNED_ALL_KEY       = 'lib_pinned_all';       // ordered array (All tab)

// ── COVER IMAGE CACHE ────────────────────────────────────────────────────────
// Caches a blob URL for each study's cover image so that IDB reads only happen
// once per session. Blob URLs are ~33% smaller in memory than base64 data URLs
// and keep the large encoded string out of the DOM.
//
// Keyed by studyId. invalidateCoverCache() revokes the blob URL before removing
// the cache entry — skipping revocation would leak the handle for the lifetime
// of the page, which is worse than the base64 approach on memory-constrained
// Android WebViews.
//
// Call invalidateCoverCache(id) when a study is deleted or its cover changes.
const _coverCache = new Map();

function invalidateCoverCache(id) {
  if (id) {
    // Revoke the blob URL before evicting so the handle is not leaked.
    const existing = _coverCache.get(id);
    if (existing) URL.revokeObjectURL(existing);
    _coverCache.delete(id);
  } else {
    // Full clear: revoke every cached blob URL first.
    _coverCache.forEach(url => { if (url) URL.revokeObjectURL(url); });
    _coverCache.clear();
  }
}

function getRecentInstalled() {
  try { return JSON.parse(localStorage.getItem(RECENT_INSTALLED_KEY) || '[]'); }
  catch(_) { return []; }
}
function getRecentOpened() {
  try { return JSON.parse(localStorage.getItem(RECENT_OPENED_KEY) || '[]'); }
  catch(_) { return []; }
}
function getPinned() {
  try { return JSON.parse(localStorage.getItem(PINNED_KEY) || '[]'); }
  catch(_) { return []; }
}
function savePinned(arr)        { safeSetItem(PINNED_KEY,            JSON.stringify(arr)); }
function saveRecentOpened(arr)  { safeSetItem(RECENT_OPENED_KEY,     JSON.stringify(arr)); }
function saveRecentInstalled(arr){ safeSetItem(RECENT_INSTALLED_KEY, JSON.stringify(arr)); }

function getPinnedAll() {
  try { return JSON.parse(localStorage.getItem(PINNED_ALL_KEY) || '[]'); }
  catch(_) { return []; }
}
function savePinnedAll(arr) { safeSetItem(PINNED_ALL_KEY, JSON.stringify(arr)); }

function togglePinAll(id) {
  const pinned = getPinnedAll();
  const idx = pinned.indexOf(id);
  if (idx === -1) { pinned.push(id); } else { pinned.splice(idx, 1); }
  savePinnedAll(pinned);
  renderLibrary();
}

// Record a study as recently installed (called after successful load/download).
function recordStudyInstalled(id) {
  let list = getRecentInstalled().filter(x => x !== id);
  list.unshift(id);
  saveRecentInstalled(list.slice(0, 4));
}

// Record a study as recently opened (called when activateStudy runs).
function recordStudyOpened(id) {
  let list = getRecentOpened().filter(x => x !== id);
  list.unshift(id);
  // Keep max 7 non-pinned, but never drop pinned studies from the list.
  // A hard ceiling of Math.max(20, pinned.length) prevents unbounded growth
  // when many studies are pinned (all pinned studies are always retained).
  const pinned = getPinned();
  const cap     = Math.max(20, pinned.length);
  const trimmed = list.filter(x => pinned.includes(x) || list.indexOf(x) < 7).slice(0, cap);
  saveRecentOpened(trimmed);
}

// Remove a study from all history lists when deleted.
function removeStudyFromHistory(id) {
  saveRecentInstalled(getRecentInstalled().filter(x => x !== id));
  saveRecentOpened(getRecentOpened().filter(x => x !== id));
  savePinned(getPinned().filter(x => x !== id));
}

// Toggle pin state for a study in the Recent tab.
function togglePin(id) {
  const pinned = getPinned();
  const idx = pinned.indexOf(id);
  if (idx === -1) {
    pinned.push(id);
  } else {
    pinned.splice(idx, 1);
  }
  savePinned(pinned);
  renderLibrary();
}

// Move a study within the Recent list (direction: -1=up, +1=down).
// Pinned studies can only be reordered among other pinned studies;
// unpinned among other unpinned studies.
function moveRecentStudy(id, direction) {
  const pinned    = getPinned();
  const isPinned  = pinned.includes(id);
  const allOpened = getRecentOpened();

  // Build the sub-list of studies in the same section (pinned or unpinned)
  const subList = allOpened.filter(x => isPinned ? pinned.includes(x) : !pinned.includes(x));
  const idx = subList.indexOf(id);
  if (idx === -1) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= subList.length) return;

  // Swap within sub-list
  [subList[idx], subList[newIdx]] = [subList[newIdx], subList[idx]];

  // Reconstruct the full recent list with corrected relative order
  let si = 0;
  const newOpened = allOpened.map(x => {
    const xPinned = pinned.includes(x);
    if (xPinned === isPinned) return subList[si++];
    return x;
  });
  saveRecentOpened(newOpened);
  renderLibrary();
}

// ── LANGUAGE FILTER ──────────────────────────────────────────────────────────
// window.libLangFilter: 'all' | a lang code e.g. 'en'
// Persists for the library session; reset to 'all' by openLibrary() each time
// the library is freshly opened (see study-loader.js patch).
// Only affects the All, Shelves, and Paths tabs.

// Returns true when a studyCache entry should be shown under the current filter.
// For multilingual studies (entry.langs array), the study matches if any of its
// languages match the filter. For mono-lingual studies entry.lang is checked.
// Studies with no language field only appear when the filter is 'all'.
function studyMatchesLangFilter(entry) {
  const filter = window.libLangFilter || 'all';
  if (filter === 'all') return true;
  // Multilingual: match if any of the study's languages equals the filter.
  if (entry?.langs?.length > 0) return entry.langs.includes(filter);
  // Mono-lingual fallback.
  return entry?.lang === filter;
}

// Populates #libLangBar with flag buttons for the languages present in the
// library. Hides the bar entirely when all studies share one language.
// langs: array of lang codes (in LANGUAGE_MAP order) present across all studies.
function renderLangBar(langs) {
  const bar = document.getElementById('libLangBar');
  if (!bar) return;

  if (langs.length < 2) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  const active = window.libLangFilter || 'all';

  // Determine which flag emojis appear more than once among the present langs.
  // When two or more present languages share a flag, use their badges instead
  // so the user can tell them apart. If only one language from a flag group is
  // present, the flag alone is unambiguous and looks better than a badge.
  const flagCounts = {};
  langs.forEach(code => {
    const f = LANGUAGE_MAP[code]?.flag;
    if (f) flagCounts[f] = (flagCounts[f] || 0) + 1;
  });

  const buttons = [
    `<button class="lib-lang-btn${active === 'all' ? ' active' : ''}"
             onclick="setLibLangFilter('all')"
             aria-label="All languages"
             title="All languages"><span class="lang-badge" style="--badge-bg:#555">all</span></button>`,
    ...langs.map(code => {
      const entry = LANGUAGE_MAP[code];
      if (!entry) return '';
      const label      = entry.label;
      const flagShared = flagCounts[entry.flag] > 1;
      const display    = ((flagShared || entry.alwaysBadge) && entry.badge)
        ? renderLangBadge(entry)   // badge: always for alwaysBadge; shared-flag otherwise
        : entry.flag;              // flag: unambiguous when alone or no badge defined
      return `<button class="lib-lang-btn${active === code ? ' active' : ''}"
                       onclick="setLibLangFilter('${code}')"
                       aria-label="${label}"
                       title="${label}">${display}</button>`;
    }),
  ].join('');

  bar.innerHTML = buttons;
}

// Called by lang filter button onclick. Updates the filter and re-renders
// the current tab so the new filter is applied immediately.
function setLibLangFilter(langCode) {
  window.libLangFilter = langCode;
  switchLibTab(window.activeTabId);
}

// ── LIBRARY REORDER (Load tab) ────────────────────────────────────────────────
//
// Long-pressing a study card enters reorder mode for that card. Two arrow
// icons (▲ / ▼) replace the delete button; tapping either moves the study
// one position in the registry and re-renders. Tapping anywhere outside the
// active card exits reorder mode without moving anything.
//
// reorderActiveId  – the id of the card currently in reorder mode, or null.
// cardLongPressTimer – per-card timer handle (separate from the answer-field
//                      longPressTimer used by initLongPressCopy).

let reorderActiveId = null;
let cardLongPressTimer = null;

// Swap study at position idx with its neighbour (direction: -1=up, +1=down),
// persist to localStorage, and re-render the library.
function moveStudy(id, direction) {
  const registry = JSON.parse(localStorage.getItem('study_registry') || '[]');
  const idx = registry.indexOf(id);
  if (idx === -1) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= registry.length) return;
  [registry[idx], registry[newIdx]] = [registry[newIdx], registry[idx]];
  safeSetItem('study_registry', JSON.stringify(registry));
  renderLibrary(); // re-render; enterReorderMode called inside to keep state
}

// Enter reorder mode for the card with the given id. If another card is
// already active, exit it first. Re-renders the library so the correct card
// shows arrows and the active border.
function enterReorderMode(id) {
  reorderActiveId = id;
  renderLibrary();
  // Dismiss reorder mode if the user taps anywhere outside a reorder button
  // or the active card itself. We add the listener after a short delay so the
  // triggering touchend that activated the long-press doesn't immediately
  // dismiss the mode on the same event loop tick.
  setTimeout(() => {
    document.addEventListener('touchstart', _reorderOutsideTap, { passive: true, once: true });
    document.addEventListener('mousedown',  _reorderOutsideTap, { once: true });
  }, 50);
}

// Handler that exits reorder mode when the user taps outside the active card.
function _reorderOutsideTap(e) {
  const activeCard = document.querySelector('.study-card--reorder-active');
  if (activeCard && activeCard.contains(e.target)) {
    // Tapped inside the active card — re-attach so the next outside tap exits.
    setTimeout(() => {
      document.addEventListener('touchstart', _reorderOutsideTap, { passive: true, once: true });
      document.addEventListener('mousedown',  _reorderOutsideTap, { once: true });
    }, 50);
    return;
  }
  exitReorderMode();
}

// Exit reorder mode and re-render the library to restore normal card state.
function exitReorderMode() {
  if (!reorderActiveId) return;
  reorderActiveId = null;
  renderLibrary();
}

// Attach a long-press listener to a study card DOM element.
// On long-press (600 ms), enters reorder mode for that study id.
// touchmove cancels the timer so normal list-scrolling is unaffected.
function attachCardLongPress(card, id) {
  card.addEventListener('touchstart', e => {
    clearTimeout(cardLongPressTimer);
    cardLongPressTimer = setTimeout(() => {
      // Prevent the touchend from triggering onclick (activateStudy)
      card._suppressNextClick = true;
      enterReorderMode(id);
    }, LONG_PRESS_DURATION);
  }, { passive: true });

  card.addEventListener('touchend', () => {
    clearTimeout(cardLongPressTimer);
    cardLongPressTimer = null;
  }, { passive: true });

  card.addEventListener('touchmove', () => {
    clearTimeout(cardLongPressTimer);
    cardLongPressTimer = null;
  }, { passive: true });
}

async function renderLibrary() {
  // ── Define popup helper immediately so shelf/section info buttons rendered
  // below can call it safely, regardless of which tab's HTML is built first. ──
  window.libPathOpenPopup = function(title, descHtml, event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    descHtml = descHtml.replace(/\{\{ICONS\.(\w+)\}\}/g, (_, key) => ICONS[key] || '');
    const existing = document.getElementById('libPathPopupOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'lib-path-popup-overlay';
    overlay.id = 'libPathPopupOverlay';
    overlay.innerHTML = `
      <div class="lib-path-popup">
        <div class="lib-path-popup-header">
          <div class="lib-path-popup-title">${title}</div>
          <button class="lib-path-popup-close" onclick="document.getElementById('libPathPopupOverlay').remove()">${t('renderlib_popup_close')}</button>
        </div>
        <div class="lib-path-popup-body">${descHtml}</div>
      </div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  };

  // ── Resolve which tab should be active ──────────────────────────────────────
  const registry      = JSON.parse(localStorage.getItem('study_registry') || '[]');
  const studyCount    = registry.length;

  const libShowRecent      = appSettings.libShowRecent      || '>5';
  const libShowShelvesTab  = appSettings.libShowShelvesTab  || '>8';
  const libShowPathsTab    = appSettings.libShowPathsTab    || '>2';
  const libShowPathsAmount = appSettings.libShowPathsAmount || 'few';

  const showRecent  = libShowRecent     === 'on' || (libShowRecent     === '>5' && studyCount > 5);
  const showShelves = libShowShelvesTab === 'on' || (libShowShelvesTab === '>8' && studyCount > 8);
  const showPaths   = libShowPathsTab   === 'on' || (libShowPathsTab   === '>2' && studyCount > 2);

  // If the stored tab is no longer visible, fall back to 'all'.
  let activeTab = window._libActiveTab || 'all';
  if (activeTab === 'recent'  && !showRecent)  activeTab = 'all';
  if (activeTab === 'shelves' && !showShelves) activeTab = 'all';
  if (activeTab === 'paths'   && !showPaths)   activeTab = 'all';
  window._libActiveTab = activeTab;

  // Expose libShowPathsAmount for the Paths tab renderer to read
  window._libShowPaths = libShowPathsAmount;

  // ── Build a lookup of all study data ────────────────────────────────────────
  // We load everything once so tab renderers can reference it cheaply.
  // For multilingual studies, title/subtitle are resolved to the active language
  // (window._activeStudyLang), falling back to slot 1 if the active language is
  // not one of this study's languages. Mono-lingual studies use plain fields.
  const studyCache = {};
  for (const id of registry) {
    const data = await StudyIDB.get(`study_content_${id}`);
    if (!data) continue;
    let coverSrc = '';
    if (_coverCache.has(id)) {
      coverSrc = _coverCache.get(id);
    } else {
      const coverBlob = await StudyIDB.getImage(`${id}_cover`);
      if (coverBlob) {
        // URL.createObjectURL() is used instead of FileReader.readAsDataURL()
        // throughout: blob URLs avoid the ~33% base64 inflation and keep the
        // encoded string out of the DOM. The blob URL is revoked in
        // invalidateCoverCache() when the study is deleted or the cache cleared.
        coverSrc = URL.createObjectURL(coverBlob);
        _coverCache.set(id, coverSrc);
      } else {
        // No cover blob — cache the empty string so we don't hit IDB again.
        _coverCache.set(id, '');
      }
    }

    const meta = data.studyMetadata || {};

    // Build the slot map for this study: { ha: 1, ff: 2, en: 3 }
    const _sm = {};
    for (let i = 1; ; i++) {
      const code = meta[`language${i}`];
      if (!code) break;
      _sm[code] = i;
    }
    const _isML = Object.keys(_sm).length > 0;

    // Determine the display slot: active lang if it's in this study, else slot 1.
    const _activeLang = window._activeStudyLang || '';
    const _slot = (_isML && _sm[_activeLang]) ? _sm[_activeLang] : 1;

    // Resolve a metadata field to a display string for the current slot.
    // Priority: slotN → slot1 → unnumbered → fallback.
    function _res(field, fb = '') {
      if (_isML) return meta[`${field}${_slot}`] || meta[`${field}1`] || meta[field] || fb;
      return meta[field] || fb;
    }

    // Collect all language codes for this study (used by lang filter and badges).
    // Multilingual: language1/language2/…  Mono-lingual: language (unnumbered).
    const _langs = [];
    if (_isML) {
      for (let i = 1; ; i++) {
        const code = meta[`language${i}`];
        if (!code) break;
        _langs.push(code);
      }
    } else if (meta.language) {
      _langs.push(meta.language);
    }

    studyCache[id] = {
      data,
      meta,
      title:    _res('title', 'Untitled Study').trim(),
      subtitle: _res('subtitle', ''),
      shelves:  meta.libraryShelves || null,
      fallback: data.imageData?.cover?.fallback || '📖',
      langs:    _langs,          // ordered array of all language codes for this study
      lang:     _langs[0] || '', // primary language (for legacy single-lang filter)
      coverSrc,
    };
  }

  // ── Helper: small cover image HTML ──────────────────────────────────────────
  function smallCoverHtml(entry, wClass, fbClass) {
    if (!entry) return `<div class="${fbClass}">📖</div>`;
    return entry.coverSrc
      ? `<img class="${wClass}" src="${entry.coverSrc}" alt=""
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
         <div class="${fbClass}" style="display:none">${entry.fallback}</div>`
      : `<div class="${fbClass}">${entry.fallback}</div>`;
  }

  // ── Helper: language badge strip HTML ───────────────────────────────────────
  // Returns a <div class="study-card-langs"> containing one badge per language
  // for multilingual studies, or '' for single-language studies (hidden).
  // Reads language1/language2/... from studyMetadata; falls back to `language`
  // for studies that predate the numbered keys. Uses renderLangBadge() so
  // badge appearance is identical to the library lang-filter bar.
  function studyLangBadgesHtml(meta) {
    if (!meta) return '';

    // Collect numbered languageN keys in order, up to however many exist.
    const codes = [];
    let n = 1;
    while (meta[`language${n}`]) {
      codes.push(meta[`language${n}`]);
      n++;
    }

    // Fall back to the bare `language` key for single-language studies that
    // don't use numbered keys. Deduplicate in case both forms are present.
    if (codes.length === 0 && meta.language) {
      codes.push(meta.language);
    }

    // Only show the row when there are 2 or more languages.
    if (codes.length < 2) return '';

    const badges = codes.map(code => {
      const entry = LANGUAGE_MAP[code];
      if (!entry) return '';
      return `<span title="${entry.label}">${renderLangBadge(entry)}</span>`;
    }).join('');

    return `<div class="study-card-langs">${badges}</div>`;
  }

  // ── TAB: Load ───────────────────────────────────────────────────────────────
  function buildLoadTab() {
    // Recently installed strip (up to 4, auto-generated, no reorder)
    const riIds = getRecentInstalled().filter(id => studyCache[id]);
    let riHtml = '';
    if (riIds.length > 0) {
      const rows = riIds.map(id => {
        const e = studyCache[id];
        const safe = e.title.replace(/'/g, "\\'");
        return `
          <div class="lib-recent-installed-card" onclick="activateStudy('${id}')">
            ${smallCoverHtml(e, 'lib-ri-cover', 'lib-ri-cover-fallback')}
            <div class="lib-ri-text">
              <div class="lib-ri-title">${e.title}</div>
              ${e.subtitle ? `<div class="lib-ri-meta">${e.subtitle}</div>` : ''}
            </div>
            <button class="lib-ri-delete-btn"
              onclick="event.stopPropagation(); deleteStudy('${id}', '${safe}')"
              title="${t('renderlib_delete_title', { title: safe })}"
              aria-label="${t('renderlib_delete_title', { title: safe })}">
              ${ICONS.trash}
            </button>
          </div>`;
      }).join('');
      riHtml = `
        <div class="library-eyebrow">${t('renderlib_recently_installed')}</div>
        <div class="lib-recent-installed-list">${rows}</div>
        <div class="library-divider"></div>`;
    }

    // Version footer
    const appTitle   = window.appAboutData?.appTitle   || '';
    const appVersion = window.appAboutData?.appVersion || '';
    const vFooterText = (appTitle && appVersion) ? `${appTitle} · v${appVersion}` : '';
    const vFooter = `<div class="library-version-footer" id="libraryVersionFooter">${vFooterText}</div>`;

    return `
      ${riHtml}
      <div class="library-eyebrow">${t('renderlib_add_study')}</div>
      <input type="file" id="studyPicker" accept=".estudy,.zip,application/zip,application/octet-stream,*/*" multiple style="display:none" onchange="handleFileSelect(event)">
      <button class="import-btn" onclick="openDriveStudyFolder()">
        ${ICONS.download}&nbsp;${t('renderlib_download_estudy')}
      </button>
      <button class="import-btn import-btn-secondary" onclick="document.getElementById('studyPicker').click()">
        ${ICONS.upload}&nbsp;${t('renderlib_load_estudy_device')}
      </button>

      ${studyCount === 0 ? buildTryThisBlock() : ''}

      ${vFooter}`;
  }

  // ── TAB: All ────────────────────────────────────────────────────────────────
  function buildAllTab() {
    if (registry.length === 0) {
      const el = document.createElement('div');
      el.className = 'library-empty';
      el.innerHTML = `
        <div class="library-empty-icon">${ICONS.library}</div>
        <div class="library-empty-title">${t('renderlib_all_empty_title')}</div>
        <div class="library-empty-body">${t('renderlib_all_empty_body')}</div>

        ${buildTryThisBlock()}

        `;

      return { frag: (() => { const f = document.createDocumentFragment(); f.appendChild(el); return f; })() };

    }

    const pinnedAll   = getPinnedAll();
    const pinnedIds   = registry.filter(id => pinnedAll.includes(id)  && studyCache[id] && studyMatchesLangFilter(studyCache[id]));
    const unpinnedIds = registry.filter(id => !pinnedAll.includes(id) && studyCache[id] && studyMatchesLangFilter(studyCache[id]));

    function buildAllRow(id, listIds, isPinned) {
      const e = studyCache[id];
      const isReorderActive = (reorderActiveId === id);
      const idxInList = listIds.indexOf(id);
      const isFirst = idxInList === 0;
      const isLast  = idxInList === listIds.length - 1;
      const pinClass = isPinned ? 'lib-pin-btn pinned' : 'lib-pin-btn';

      // Reorder arrows (long-press) or delete button
      const reorderHtml = isReorderActive
        ? `<div class="study-card-reorder-btns" onclick="event.stopPropagation()">
             <button class="study-card-reorder-btn"
               ${isFirst ? 'disabled' : ''}
               onclick="event.stopPropagation(); moveStudy('${id}', -1)"
               title="${t('renderlib_move_up')}"
               aria-label="${t('renderlib_move_up')}">${ICONS.arrowUp}</button>
             <button class="study-card-reorder-btn"
               ${isLast ? 'disabled' : ''}
               onclick="event.stopPropagation(); moveStudy('${id}', 1)"
               title="${t('renderlib_move_down')}"
               aria-label="${t('renderlib_move_down')}">${ICONS.arrowDown}</button>
           </div>`
        : `<button class="study-card-delete-btn"
             onclick="event.stopPropagation(); deleteStudy('${id}', '${e.title.replace(/'/g, "\\'")}')"
             style="background:none; border:none; padding:10px; font-size:18px; cursor:pointer; opacity:0.6; z-index:2; margin-left: 4px;">
             ${ICONS.trash}
           </button>`;

      //"bluefish color-coding (6)
      const card = document.createElement('div');
      card.className = 'study-card' + (isReorderActive ? ' study-card--reorder-active' : '');
      card.dataset.studyId = id;

      card.onclick = () => {
        if (card._suppressNextClick) { card._suppressNextClick = false; return; }
        if (isReorderActive) return;
        activateStudy(id);
      };

      const coverHtml = e.coverSrc
        ? `<img class="study-card-cover" src="${e.coverSrc}" alt=""
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
           <div class="study-card-cover-fallback" style="display:none">${e.fallback}</div>`
        : `<div class="study-card-cover-fallback">${e.fallback}</div>`;

      card.innerHTML = `
        <button class="${pinClass}"
          onclick="event.stopPropagation(); togglePinAll('${id}')"
          title="${isPinned ? t('renderlib_unpin') : t('renderlib_pin_to_top')}">${isPinned ? ICONS.pinFilled : ICONS.pin}</button>
        ${coverHtml}

        <div class="study-card-text" style="flex:1;">
          <h3>${e.title}</h3>
          ${e.subtitle ? `<div class="study-card-subtitle">${e.subtitle}</div>` : ''}
          ${studyLangBadgesHtml(e.meta)}
        </div>
        ${reorderHtml}`;

      attachCardLongPress(card, id);
      return card;
    }

    const frag = document.createDocumentFragment();

    if (pinnedIds.length > 0) {
      const label = document.createElement('div');
      label.className = 'lib-recent-section-label pinned-label';
      label.textContent = t('renderlib_pinned');
      frag.appendChild(label);
      const list = document.createElement('div');
      list.className = 'lib-recent-list';
      pinnedIds.forEach(id => list.appendChild(buildAllRow(id, pinnedIds, true)));
      frag.appendChild(list);
    }

    if (unpinnedIds.length > 0) {
      const label = document.createElement('div');
      label.className = 'lib-recent-section-label';
      label.textContent = pinnedIds.length > 0 ? t('renderlib_all_studies') : t('renderlib_all_installed_studies');
      frag.appendChild(label);
      const list = document.createElement('div');
      list.className = 'lib-recent-list';
      unpinnedIds.forEach(id => list.appendChild(buildAllRow(id, unpinnedIds, false)));
      frag.appendChild(list);
    }

    return { frag };
  }

  // ── TAB: Recent ─────────────────────────────────────────────────────────────
  function buildRecentTab() {
    const pinned  = getPinned();
    const opened  = getRecentOpened().filter(id => studyCache[id]);

    if (opened.length === 0) {
      return `
        <div class="library-empty">
          <div class="library-empty-icon">🕐</div>
          <div class="library-empty-title">${t('renderlib_recent_empty_title')}</div>
          <div class="library-empty-body">${t('renderlib_recent_empty_body')}</div>
        </div>`;
    }

    const pinnedIds   = opened.filter(id => pinned.includes(id));
    const unpinnedIds = opened.filter(id => !pinned.includes(id));

    function buildRecentRow(id, listIds, isPinned) {
      const e = studyCache[id];
      const isReorderActive = (reorderActiveId === id);
      const idxInList = listIds.indexOf(id);
      const isFirst = idxInList === 0;
      const isLast  = idxInList === listIds.length - 1;

      const pinClass = isPinned ? 'lib-pin-btn pinned' : 'lib-pin-btn';

      const reorderHtml = isReorderActive
        ? `<div class="study-card-reorder-btns" onclick="event.stopPropagation()">
             <button class="study-card-reorder-btn"
               ${isFirst ? 'disabled' : ''}
               onclick="event.stopPropagation(); moveRecentStudy('${id}', -1)"
               title="${t('renderlib_move_up')}"
               aria-label="${t('renderlib_move_up')}">${ICONS.arrowUp}</button>
             <button class="study-card-reorder-btn"
               ${isLast ? 'disabled' : ''}
               onclick="event.stopPropagation(); moveRecentStudy('${id}', 1)"
               title="${t('renderlib_move_down')}"
               aria-label="${t('renderlib_move_down')}">${ICONS.arrowDown}</button>
           </div>`
        : `<button class="study-card-delete-btn"
             onclick="event.stopPropagation(); deleteStudy('${id}', '${e.title.replace(/'/g, "\\'")}')"
             style="background:none; border:none; padding:10px; font-size:18px; cursor:pointer; opacity:0.6; z-index:2; margin-left: 4px;">
             ${ICONS.trash}
           </button>`;

      //"bluefish color-coding (5)
      const card = document.createElement('div');
      card.className = 'study-card' + (isReorderActive ? ' study-card--reorder-active' : '');
      card.dataset.studyId = id;

      card.onclick = () => {
        if (card._suppressNextClick) { card._suppressNextClick = false; return; }
        if (isReorderActive) return;
        activateStudy(id);
      };

      const coverHtml = e.coverSrc
        ? `<img class="study-card-cover" src="${e.coverSrc}" alt=""
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
           <div class="study-card-cover-fallback" style="display:none">${e.fallback}</div>`
        : `<div class="study-card-cover-fallback">${e.fallback}</div>`;

      card.innerHTML = `
        <button class="${pinClass}"
          onclick="event.stopPropagation(); togglePin('${id}')"
          title="${isPinned ? t('renderlib_unpin') : t('renderlib_pin_to_top')}">${isPinned ? ICONS.pinFilled : ICONS.pin}</button>
        ${coverHtml}

        <div class="study-card-text" style="flex:1;">
          <h3>${e.title}</h3>
          ${e.subtitle ? `<div class="study-card-subtitle">${e.subtitle}</div>` : ''}
          ${studyLangBadgesHtml(e.meta)}
        </div>
        ${reorderHtml}`;

      attachCardLongPress(card, id);
      return card;
    }

    // Build DOM fragment
    const frag = document.createDocumentFragment();

    if (pinnedIds.length > 0) {
      const label = document.createElement('div');
      label.className = 'lib-recent-section-label pinned-label';
      label.textContent = t('renderlib_pinned');
      frag.appendChild(label);
      const list = document.createElement('div');
      list.className = 'lib-recent-list';
      pinnedIds.forEach(id => list.appendChild(buildRecentRow(id, pinnedIds, true)));
      frag.appendChild(list);
    }

    if (unpinnedIds.length > 0) {
      const label = document.createElement('div');
      label.className = 'lib-recent-section-label';
      label.textContent = pinnedIds.length > 0 ? t('renderlib_recent') : t('renderlib_recently_opened');
      frag.appendChild(label);
      const list = document.createElement('div');
      list.className = 'lib-recent-list';
      unpinnedIds.forEach(id => list.appendChild(buildRecentRow(id, unpinnedIds, false)));
      frag.appendChild(list);
    }

    // We return a sentinel; the DOM nodes live in `frag`
    return { frag };
  }

  // ── TAB: Shelves ────────────────────────────────────────────────────────────
  function buildShelvesTab() {
    const structure = (window.appAboutData || {}).libraryShelvesStructure || [];
    const libShowEmpty = appSettings.libShowEmptyAmount || 'none';

    if (registry.length === 0) {
      return `
        <div class="library-empty">
          <div class="library-empty-icon">🗂️</div>
          <div class="library-empty-title">${t('renderlib_shelves_empty_title')}</div>
          <div class="library-empty-body">${t('renderlib_shelves_empty_body')}</div>
        </div>
        ${buildTryThisBlock()}`;
    }

    // Bucket studies into canonical shelves/sections/subsections.
    const buckets = {};
    function bucketKey(shelf, section, subsection) {
      return JSON.stringify([shelf, section || '', subsection || '']);
    }
    function addToBucket(shelf, section, subsection, id) {
      const k = bucketKey(shelf, section, subsection);
      if (!buckets[k]) buckets[k] = [];
      buckets[k].push(id);
    }

    const knownShelfNames   = structure.map(s => s.shelf);
    const knownSectionNames = {};
    structure.forEach(s => {
      knownSectionNames[s.shelf] = s.sections.map(sec => sec.section);
    });

    for (const id of registry) {
      const e = studyCache[id];
      if (!e) continue;
      if (!studyMatchesLangFilter(e)) continue;  // lang filter
      const raw = e.shelves;
      const placements = !raw ? [] : Array.isArray(raw) ? raw : [raw];
      if (placements.length === 0) { addToBucket('Other', '', '', id); continue; }
      let placedSomewhere = false;
      for (const ls of placements) {
        if (!ls || !ls.Shelf) continue;
        addToBucket(ls.Shelf, ls.Section || '', ls.Subsection || '', id);
        placedSomewhere = true;
      }
      if (!placedSomewhere) addToBucket('Other', '', '', id);
    }

    function studyRowHtml(id) {
      const e = studyCache[id];
      if (!e) return '';
      const safe = e.title.replace(/'/g, "\\'");
      return `
        <div class="lib-shelf-study-row" onclick="activateStudy('${id}')">
          ${smallCoverHtml(e, 'lib-shelf-cover', 'lib-shelf-cover-fallback')}
          <span class="lib-shelf-study-title">${e.title}</span>
          <span class="lib-shelf-chevron-sm">${ICONS.chevronRight}</span>
        </div>`;
    }

    let html = '';
    let shelfIdx = 0;

    function renderShelf(shelfName, sections, isEmpty) {
      const sIdx = shelfIdx++;
      const shelfBodyId = `libShelfBody_${sIdx}`;
      const shelfChevId = `libShelfChev_${sIdx}`;

      // Build description lookups from the structure data
      const shelfDesc = (window.appAboutData?.libraryShelvesStructure || [])
        .find(s => s.shelf === shelfName)?.description || '';

      function getSectionDesc(secName) {
        const shelfDef = (window.appAboutData?.libraryShelvesStructure || [])
          .find(s => s.shelf === shelfName);
        return shelfDef?.sections?.find(s => s.section === secName)?.description || '';
      }

      function getSubsectionDesc(secName, subName) {
        const shelfDef = (window.appAboutData?.libraryShelvesStructure || [])
          .find(s => s.shelf === shelfName);
        const secDef = shelfDef?.sections?.find(s => s.section === secName);
        if (!secDef || !Array.isArray(secDef.subsections)) return '';
        const subDef = secDef.subsections.find(s =>
          (typeof s === 'string' ? s : s.name) === subName
        );
        return (subDef && typeof subDef === 'object') ? (subDef.description || '') : '';
      }

      let secIdx = 0;

      // If the whole shelf is empty:
      // - 'many'/'all': expandable, faded, shows empty sections with popups
      // - otherwise: flat non-interactive row with popup only
      if (isEmpty) {
        const safeShelfName = shelfName.replace(/'/g, "\\'");
        const safeShelfDesc = (shelfDesc || '<p>No description available for this shelf yet.</p>').replace(/'/g, "\\'");

        if (libShowEmpty === 'many' || libShowEmpty === 'all') {
          // Build empty section rows for this empty shelf
          const allSections = sections.map(s => s.section || s);
          let emptySecHtml = '';
          for (const secName of allSections) {
            const secDesc = getSectionDesc(secName);
            const safeSecName = secName.replace(/'/g, "\\'");
            const safeSecDesc = (secDesc || '<p>No description available for this section yet.</p>').replace(/'/g, "\\'");

            if (libShowEmpty === 'all') {
              // Build empty subsection rows too
              const secDef = sections.find(s => (s.section || s) === secName);
              const subsectionDefs = (secDef && Array.isArray(secDef.subsections)) ? secDef.subsections : [];
              let emptySubHtml = '';
              for (const subDef of subsectionDefs) {
                const subName = typeof subDef === 'string' ? subDef : subDef.name;
                const subDesc = getSubsectionDesc(secName, subName);
                const safeSub = subName.replace(/'/g, "\\'");
                const safeSubDesc = (subDesc || '<p>No description available yet.</p>').replace(/'/g, "\\'");
                emptySubHtml += `<div class="lib-subsection-label lib-subsection--empty">${subName}<button class="lib-subsection-info-btn" onclick="libPathOpenPopup('${safeSub}','${safeSubDesc}',null)">${ICONS.triggerInfo}</button></div>`;
              }
              const siIdx = secIdx++;
              const secBodyId = `libSecBody_${sIdx}_${siIdx}`;
              const secChevId = `libSecChev_${sIdx}_${siIdx}`;
              emptySecHtml += `
                <div class="lib-section lib-section--empty">
                  <div class="lib-section-header lib-section-header--empty lib-section-header--expandable"
                       onclick="libToggleSection('${secBodyId}','${secChevId}',event)">
                    <span class="lib-section-chevron lib-section-chevron--empty" id="${secChevId}">${ICONS.triangleRight}</span>
                    <span class="lib-section-title">${secName}</span>
                    <button class="lib-shelf-section-info-btn lib-section-empty-info-btn" onclick="libPathOpenPopup('${safeSecName}','${safeSecDesc}',null)">${ICONS.triggerInfo}</button>
                  </div>
                  <div class="lib-section-body open" id="${secBodyId}">
                    ${emptySubHtml}
                  </div>
                </div>`;
            } else {
              // 'many': flat empty section row, popup only
              emptySecHtml += `
                <div class="lib-section lib-section--empty">
                  <div class="lib-section-header lib-section-header--empty">
                    <span class="lib-section-chevron lib-section-chevron--empty">${ICONS.triangleRight}</span>
                    <span class="lib-section-title">${secName}</span>
                    <button class="lib-shelf-section-info-btn lib-section-empty-info-btn" onclick="libPathOpenPopup('${safeSecName}','${safeSecDesc}',null)">${ICONS.triggerInfo}</button>
                  </div>
                </div>`;
            }
          }
          return `
            <div class="lib-shelf lib-shelf--empty">
              <div class="lib-shelf-header lib-shelf-header--empty lib-shelf-header--expandable" id="${shelfChevId}"
                   onclick="libToggleShelf('${shelfBodyId}','${shelfChevId}',event)">
                <span class="lib-shelf-header-icon">${ICONS.triangleRight}</span>
                <span class="lib-shelf-title">${shelfName}</span>
                <button class="lib-shelf-info-btn lib-shelf-empty-info-btn" onclick="libPathOpenPopup('${safeShelfName}','${safeShelfDesc}',null)">${ICONS.triggerInfo}</button>
              </div>
              <div class="lib-shelf-body" id="${shelfBodyId}">
                ${emptySecHtml}
              </div>
            </div>`;
        }

        // 'few' or fallback: flat non-interactive row
        return `
          <div class="lib-shelf lib-shelf--empty">
            <div class="lib-shelf-header lib-shelf-header--empty">
              <span class="lib-shelf-header-icon">${ICONS.triangleRight}</span>
              <span class="lib-shelf-title">${shelfName}</span>
              <button class="lib-shelf-info-btn lib-shelf-empty-info-btn" onclick="libPathOpenPopup('${safeShelfName}','${safeShelfDesc}',null)">${ICONS.triggerInfo}</button>
            </div>
          </div>`;
      }

      const shelfKeys = Object.keys(buckets)
        .filter(k => JSON.parse(k)[0] === shelfName);

      const canonicalSections = sections.map(s => s.section || s);
      const usedSections = [...new Set(shelfKeys.map(k => JSON.parse(k)[1]))];
      const orderedSections = [
        ...canonicalSections.filter(s => usedSections.includes(s)),
        ...usedSections.filter(s => s !== '' && !canonicalSections.includes(s)).sort(),
      ];

      const emptySections = (libShowEmpty === 'few' || libShowEmpty === 'many' || libShowEmpty === 'all')
        ? canonicalSections.filter(s => !usedSections.includes(s))
        : [];

      const hasUnsectioned = usedSections.includes('');

      let sectionsHtml = '';

      // Render populated sections
      for (const secName of orderedSections) {
        const secKeys = shelfKeys.filter(k => JSON.parse(k)[1] === secName);
        if (secKeys.length === 0) continue;

        const siIdx = secIdx++;
        const secBodyId = `libSecBody_${sIdx}_${siIdx}`;
        const secChevId = `libSecChev_${sIdx}_${siIdx}`;

        const subsections = {};
        for (const k of secKeys) {
          const sub = JSON.parse(k)[2];
          if (!subsections[sub]) subsections[sub] = [];
          subsections[sub].push(...buckets[k]);
        }

        const canonicalSubsections = (() => {
          const secDef = (sections || []).find(s => (s.section || s) === secName);
          if (!secDef || !Array.isArray(secDef.subsections)) return [];
          return secDef.subsections.map(s => (typeof s === 'string' ? s : s.name));
        })();
        const usedSubKeys = Object.keys(subsections).filter(s => s !== '');
        const orderedSubKeys = [
          ...canonicalSubsections.filter(s => usedSubKeys.includes(s)),
          ...usedSubKeys.filter(s => !canonicalSubsections.includes(s)).sort(),
        ];

        let secContentHtml = '';
        if (orderedSubKeys.length === 0) {
          secContentHtml = (subsections[''] || []).map(studyRowHtml).join('');
        } else {
          for (const sub of orderedSubKeys) {
            const subDesc = getSubsectionDesc(secName, sub);
            const safeSubDesc = subDesc.replace(/'/g, "\\'");
            const safeSub = sub.replace(/'/g, "\\'");
            const subInfoBtn = subDesc
              ? `<button class="lib-subsection-info-btn" onclick="libPathOpenPopup('${safeSub}','${safeSubDesc}',null)">${ICONS.triggerInfo}</button>`
              : '';
            secContentHtml += `<div class="lib-subsection-label">${sub}${subInfoBtn}</div>
                 ${subsections[sub].map(studyRowHtml).join('')}`;
          }
          if (subsections['']) {
            secContentHtml += subsections[''].map(studyRowHtml).join('');
          }
        }

        const secDesc = getSectionDesc(secName);
        const safeSecDesc = secDesc.replace(/'/g, "\\'");
        const safeSecName = secName.replace(/'/g, "\\'");
        sectionsHtml += `
          <div class="lib-section">
            <div class="lib-section-header"
                 onclick="libToggleSection('${secBodyId}','${secChevId}',event)">
              <span class="lib-section-chevron" id="${secChevId}">${ICONS.triangleRight}</span>
              <span class="lib-section-title">${secName}</span>
              ${secDesc ? `<button class="lib-shelf-section-info-btn" onclick="event.stopPropagation();libPathOpenPopup('${safeSecName}','${safeSecDesc}',event)">${ICONS.triggerInfo}</button>` : ''}
            </div>
            <div class="lib-section-body open" id="${secBodyId}">
              ${secContentHtml}
            </div>
          </div>`;
      }

      // Render empty sections (muted; expandable with subsections in 'all' mode)
      for (const secName of emptySections) {
        const secDesc = getSectionDesc(secName);
        const safeSecName = secName.replace(/'/g, "\\'");
        const safeSecDesc = (secDesc || '<p>No description available for this section yet.</p>').replace(/'/g, "\\'");

        if (libShowEmpty === 'all') {
          const secDef = sections.find(s => (s.section || s) === secName);
          const subsectionDefs = (secDef && Array.isArray(secDef.subsections)) ? secDef.subsections : [];
          let emptySubHtml = '';
          for (const subDef of subsectionDefs) {
            const subName = typeof subDef === 'string' ? subDef : subDef.name;
            const subDesc = getSubsectionDesc(secName, subName);
            const safeSub = subName.replace(/'/g, "\\'");
            const safeSubDesc = (subDesc || '<p>No description available yet.</p>').replace(/'/g, "\\'");
            emptySubHtml += `<div class="lib-subsection-label lib-subsection--empty">${subName}<button class="lib-subsection-info-btn" onclick="libPathOpenPopup('${safeSub}','${safeSubDesc}',null)">${ICONS.triggerInfo}</button></div>`;
          }
          const siIdx = secIdx++;
          const secBodyId = `libSecBody_${sIdx}_${siIdx}`;
          const secChevId = `libSecChev_${sIdx}_${siIdx}`;
          sectionsHtml += `
            <div class="lib-section lib-section--empty">
              <div class="lib-section-header lib-section-header--empty lib-section-header--expandable"
                   onclick="libToggleSection('${secBodyId}','${secChevId}',event)">
                <span class="lib-section-chevron lib-section-chevron--empty" id="${secChevId}">${ICONS.triangleRight}</span>
                <span class="lib-section-title">${secName}</span>
                <button class="lib-shelf-section-info-btn lib-section-empty-info-btn" onclick="libPathOpenPopup('${safeSecName}','${safeSecDesc}',null)">${ICONS.triggerInfo}</button>
              </div>
              <div class="lib-section-body open" id="${secBodyId}">
                ${emptySubHtml}
              </div>
            </div>`;
        } else {
          sectionsHtml += `
            <div class="lib-section lib-section--empty">
              <div class="lib-section-header lib-section-header--empty">
                <span class="lib-section-chevron lib-section-chevron--empty">${ICONS.triangleRight}</span>
                <span class="lib-section-title">${secName}</span>
                <button class="lib-shelf-section-info-btn lib-section-empty-info-btn" onclick="libPathOpenPopup('${safeSecName}','${safeSecDesc}',null)">${ICONS.triggerInfo}</button>
              </div>
            </div>`;
        }
      }

      if (hasUnsectioned) {
        const unsecKeys = shelfKeys.filter(k => JSON.parse(k)[1] === '');
        sectionsHtml += unsecKeys.flatMap(k => buckets[k]).map(studyRowHtml).join('');
      }

      const safeShelfDesc = shelfDesc.replace(/'/g, "\\'");
      const safeShelfName = shelfName.replace(/'/g, "\\'");
      return `
        <div class="lib-shelf">
          <div class="lib-shelf-header open" id="${shelfChevId}" onclick="libToggleShelf('${shelfBodyId}','${shelfChevId}',event)">
            <span class="lib-shelf-header-icon">${ICONS.triangleRight}</span>
            <span class="lib-shelf-title">${shelfName}</span>
            ${shelfDesc ? `<button class="lib-shelf-info-btn" onclick="event.stopPropagation();libPathOpenPopup('${safeShelfName}','${safeShelfDesc}',event)">${ICONS.triggerInfo}</button>` : ''}
          </div>
          <div class="lib-shelf-body" id="${shelfBodyId}">
            ${sectionsHtml}
          </div>
        </div>`;
    }

    // 1. Render canonical shelves in defined order.
    //    When libShowEmpty === 'all', also render empty canonical shelves.
    const canonicalShelfNames = structure.map(s => s.shelf);
    for (const shelfDef of structure) {
      const shelfName = shelfDef.shelf;
      const hasStudies = Object.keys(buckets).some(k => JSON.parse(k)[0] === shelfName);
      if (!hasStudies && libShowEmpty !== 'many' && libShowEmpty !== 'all') continue;
      html += renderShelf(shelfName, shelfDef.sections || [], !hasStudies);
    }

    // 2. Render any unrecognised shelves (always have studies by definition).
    const extraShelfNames = [...new Set(
      Object.keys(buckets)
        .map(k => JSON.parse(k)[0])
        .filter(s => s !== 'Other' && !canonicalShelfNames.includes(s))
    )].sort();
    for (const shelfName of extraShelfNames) {
      html += renderShelf(shelfName, [], false);
    }

    // 3. Render 'Other' last (if it has anything).
    if (Object.keys(buckets).some(k => JSON.parse(k)[0] === 'Other')) {
      html += renderShelf('Other', [], false);
    }

    const controls = `
      <div class="lib-tab-page-header">
        <div class="lib-tab-page-title">${t('renderlib_shelves_title')}</div>
        <p class="lib-tab-page-intro">
          ${t('renderlib_shelves_intro')}
          <button class="lib-tab-page-more-btn" onclick="libShelvesOpenMoreInfo()">${t('renderlib_more_btn')} ${ICONS.triggerInfo}</button>
        </p>
      </div>
      <div class="lib-shelves-controls" style="padding: 0 16px; max-width: 560px; margin: 0 auto 4px;">
        <button class="lib-shelves-ctrl-btn" id="libShelvesCtrlCollapse"
          onclick="libShelvesSetMode('collapse')">${t('renderlib_ctrl_collapse')}</button>
        <button class="lib-shelves-ctrl-btn active" id="libShelvesCtrlSome"
          onclick="libShelvesSetMode('some')">${t('renderlib_ctrl_expand_some')}</button>
        <button class="lib-shelves-ctrl-btn" id="libShelvesCtrlAll"
          onclick="libShelvesSetMode('all')">${t('renderlib_ctrl_expand_all')}</button>
      </div>`;

    return (html
      ? controls + html
      : `<div class="library-empty"><div class="library-empty-body">${t('renderlib_shelves_no_display')}</div></div>`);
  }

  // ── TAB: Paths ──────────────────────────────────────────────────────────────

  function buildPathsTab() {
    const pathways = ((window.appAboutData || {}).learningPathways || {}).learningPathways || [];
    const showMode = window._libShowPaths || 'few'; // 'one' | 'few' | 'many' | 'all'
    // l1Limit: how many L1 groups to show. 'one' = only the first.
    const l1Limit  = showMode === 'one' ? 1 : Infinity;
    // l2Limit: how many L2 items to show per L1 group
    const l2Limit  = showMode === 'all'  ? Infinity
                   : showMode === 'many' ? 2
                   : 1; // 'few' and 'one' both show 1 L2 per L1

    // Build level-3 rows for a given pathway (titleLevel2 item)
    function buildL3Rows(pathway, l1Idx, l2Idx) {
      const studies = pathway.studyTitles || [];
      const installedIds = JSON.parse(localStorage.getItem('study_registry') || '[]');

      const rows = studies.map((s, l3Idx) => {
        const hasDl = s.downloadLocation && s.downloadLocation !== '';
        // Treat a study as installed only if it is in the registry AND passes the
        // current lang filter. A filtered-out study reverts to catalogue-only so
        // the user doesn't see an "open" button for a language they've hidden.
        const inRegistry       = s.studyId && installedIds.includes(s.studyId);
        const passesLangFilter = inRegistry && studyMatchesLangFilter(studyCache[s.studyId]);
        const alreadyInstalled = passesLangFilter;
        const showDlBtn = hasDl && !alreadyInstalled;
        const safeDlUrl = hasDl ? s.downloadLocation.replace(/'/g, "\\'") : '';
        const downloadHintL3 = showDlBtn
          ? `<p style="margin-top:10px; font-size:0.85em; color:var(--text-faint); border-top:1px solid var(--border); padding-top:10px;">${ICONS.download} This study is available to download. Tap the download icon next to <b>${s.titleLevel3}</b> to install it.</p>`
          : alreadyInstalled
          ? ''
          : `<p style="margin-top:10px; font-size:0.85em; color:var(--text-faint); border-top:1px solid var(--border); padding-top:10px;">${t('renderlib_study_not_available')}</p>`;
        const safeDesc = ((s.description || '') + downloadHintL3).replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, ' ');
        const dlBtn = showDlBtn
          ? `<button class="lib-path-l3-info-btn lib-path-l3-dl-btn"
               onclick="event.stopPropagation(); libPathDownload('${safeDlUrl}')"
               title="${t('renderlib_download_study', { title: s.titleLevel3.replace(/'/g, "\\'")})}" aria-label="${t('renderlib_download_study', { title: s.titleLevel3.replace(/'/g, "\\'")})}">
               ${ICONS.download}
             </button>`
          : alreadyInstalled
          ? `<button class="lib-path-l3-info-btn lib-path-l3-installed-btn"
               onclick="event.stopPropagation(); activateStudy('${s.studyId}')"
               title="${t('renderlib_installed_open')}"
               aria-label="${t('renderlib_installed_open')}">
               ${ICONS.chevronRight}
             </button>`
          : '';
        return `
          <div class="lib-path-l3-row${alreadyInstalled ? ' lib-path-l3-row--installed' : ''}">
            <span class="lib-path-l3-title">${s.titleLevel3}</span>
            ${dlBtn}
            <button class="lib-path-l3-info-btn"
              onclick="libPathOpenPopup('${s.titleLevel3.replace(/'/g,"\\'")}','${safeDesc}',event)"
              aria-label="${t('renderlib_pathway_info_btn')}"
              title="${t('renderlib_pathway_info_btn')}">${ICONS.triggerInfo}</button>
          </div>`;
      }).join('');

      return rows;
    }

    // Build level-2 accordion buttons + their children, sliced by l2Limit
    function buildL2Buttons(pathways2, l1Idx) {
      const visible = showMode === 'all' ? pathways2 : pathways2.slice(0, l2Limit);
      const rows = visible.map((p2, l2Idx) => {
        const childrenId = `lp-l2-ch-${l1Idx}-${l2Idx}`;
        const btnId      = `lp-l2-btn-${l1Idx}-${l2Idx}`;
        const installedIds = JSON.parse(localStorage.getItem('study_registry') || '[]');
        const l2HasDl = p2.downloadLocation && p2.downloadLocation !== '';
        const allInstalled = l2HasDl && (p2.studyTitles || [])
          .filter(s => s.studyId)
          .every(s => installedIds.includes(s.studyId) && studyMatchesLangFilter(studyCache[s.studyId]));
        const showL2Dl = l2HasDl && !allInstalled;
        const pathwayHint = `<p style="margin-top:12px; font-size:0.85em; color:var(--text-faint); border-top:1px solid var(--border); padding-top:10px;">Click the ${ICONS.pathwayOff} icon next to <b>${p2.titleLevel2}</b> to activate this pathway. Your progress across all its studies will then appear in a new tab on the My Progress page.</p>`;
        const downloadHintL2 = showL2Dl
          ? `<p style="margin-top:10px; font-size:0.85em; color:var(--text-faint); border-top:1px solid var(--border); padding-top:10px;">${ICONS.download} This bundle is available to download. Tap the download icon next to <b>${p2.titleLevel2}</b> to install all its studies at once.</p>`
          : `<p style="margin-top:10px; font-size:0.85em; color:var(--text-faint); border-top:1px solid var(--border); padding-top:10px;">${t('renderlib_pathway_not_available')}</p>`;
        const fullDesc2  = (p2.description || '') + pathwayHint + downloadHintL2;
        const safeDesc = fullDesc2.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const safeName   = (p2.titleLevel2 || '').replace(/'/g, "\\'");
        const pathwayKey    = `${l1Idx}_${l2Idx}`;
        const isSetActive   = localStorage.getItem('bsr_activePathwayId') === pathwayKey;
        const safeL2DlUrl = l2HasDl ? p2.downloadLocation.replace(/'/g, "\\'") : '';
        const l2DlBtn = showL2Dl
          ? `<button class="lib-path-l2-info-btn lib-path-l2-dl-btn"
               onclick="event.stopPropagation(); libPathDownload('${safeL2DlUrl}')"
               title="${t('renderlib_download_bundle')}"
               aria-label="${t('renderlib_download_bundle')}">
               ${ICONS.download}
             </button>`
          : '';
        return `
          <div class="lib-path-l2-btn${showMode === 'one' ? ' open' : ''}" id="${btnId}"
            onclick="libPathToggleL2('${childrenId}','${btnId}',event)">
            <span class="lib-path-l2-icon">${ICONS.triangleRight}</span>
            <span class="lib-path-l2-label">${p2.titleLevel2}</span>
            ${l2DlBtn}
            <button class="lib-path-set-active-btn ${isSetActive ? 'is-set' : ''}"
              data-pathway-key="${pathwayKey}"
              onclick="event.stopPropagation(); libPathSetActive('${pathwayKey}', this)"
              title="${isSetActive ? t('renderlib_pathway_active_clear') : t('renderlib_pathway_set_active')}"
              aria-label="${isSetActive ? t('renderlib_pathway_active_clear') : t('renderlib_pathway_set_active')}">
              ${isSetActive ? ICONS.pathwayOn : ICONS.pathwayOff}
            </button>
            <button class="lib-path-l2-info-btn"
              onclick="libPathOpenPopup('${safeName}','${safeDesc}',event)"
              aria-label="${t('renderlib_pathway_info_btn')}"
              title="${t('renderlib_pathway_info_btn')}">${ICONS.triggerInfo}</button>
          </div>
          <div class="lib-path-l2-children${showMode === 'one' ? ' open' : ''}" id="${childrenId}" style="padding-left:16px;">
            <div class="lib-path-l3-wrap">
              ${buildL3Rows(p2, l1Idx, l2Idx)}
            </div>
          </div>`;
      }).join('');
      return rows;
    }

    // Build level-1 accordion buttons
    const l1Html = pathways.slice(0, l1Limit).map((p1, l1Idx) => {
      const childrenId  = `lp-l1-ch-${l1Idx}`;
      const btnId       = `lp-l1-btn-${l1Idx}`;
      const hiddenCount = (showMode === 'all' || showMode === 'one') ? 0 : (p1.pathways || []).length - Math.min((p1.pathways || []).length, l2Limit);
      const baseDesc    = (p1.description || '');
      const hiddenNote  = hiddenCount > 0
        ? ` <p style="margin-top:10px;font-size:0.85em;color:var(--text-faint);">&#9432; ${t('renderlib_paths_hidden_note', { count: hiddenCount })}</p>`
        : '';
      const fullDesc    = baseDesc + hiddenNote;
      const safeDesc    = fullDesc.replace(/'/g, "\\'").replace(/"/g, '&quot;');
      const safeName    = (p1.titleLevel1 || '').replace(/'/g, "\\'");
      return `
        <div class="lib-path-l1-btn${showMode === 'one' ? ' open' : ''}" id="${btnId}"
          onclick="libPathToggleL1('${childrenId}','${btnId}',event)">
          <span class="lib-path-l1-icon">${ICONS.triangleRight}</span>
          <span class="lib-path-l1-label">${p1.titleLevel1}</span>
          <button class="lib-path-info-btn"
            onclick="libPathOpenPopup('${safeName}','${safeDesc}',event)">${ICONS.triggerInfo}</button>
        </div>
        <div class="lib-path-l1-children${showMode === 'one' ? ' open' : ''}" id="${childrenId}">
          ${buildL2Buttons(p1.pathways || [], l1Idx)}
        </div>`;
    }).join('');

    return `
      <div class="lib-paths-page">
        <div class="lib-tab-page-header" style="padding-left:0;padding-right:0;">
          <div class="lib-tab-page-title">${t('renderlib_paths_title')}</div>
          <p class="lib-tab-page-intro">
            ${t('renderlib_paths_intro')}
            <button class="lib-tab-page-more-btn" onclick="libPathOpenMoreInfo()">${t('renderlib_more_btn')} ${ICONS.triggerInfo}</button>
          </p>
        </div>
        <div class="lib-shelves-controls" style="margin-bottom:18px;">
          <button class="lib-shelves-ctrl-btn" id="libPathsCtrlCollapse"
            onclick="libPathsSetMode('collapse')">${t('renderlib_ctrl_collapse')}</button>
          <button class="lib-shelves-ctrl-btn active" id="libPathsCtrlSome"
            onclick="libPathsSetMode('some')">${t('renderlib_ctrl_expand_some')}</button>
          <button class="lib-shelves-ctrl-btn" id="libPathsCtrlAll"
            onclick="libPathsSetMode('all')">${t('renderlib_ctrl_expand_all')}</button>
        </div>
        ${l1Html}
      </div>`;
  }

  function buildTryThisBlock() {
    const d = window.appAboutData || {};
    return `
      <div class="lib-try-block">
        <div class="lib-try-inner">
          <div class="library-eyebrow">${t('renderlib_try_this_eyebrow')}</div>
          <div class="lib-try-title">${t('renderlib_try_this_heading')}</div>
          <div class="lib-try-title"><em>${d.sampleTitle || ''}: ${d.sampleSubtitle || ''}</em></div>
          <button class="import-btn import-btn-secondary lib-try-btn"
            onclick="libDownloadTryThis()">
            ${ICONS.download}&nbsp;${t('renderlib_try_this_btn', { title: d.sampleShortTitle || '' })}
          </button>
          <div class="lib-try-desc">${d.sampleDescription || ''}</div>
        </div>
      </div>`;
  }

  // ── Paths tab helper functions (global scope so onclick="" can reach them) ──

  window.libPathToggleL1 = function(childrenId, btnId, event) {
    if (event && event.target.classList.contains('lib-path-info-btn')) return;
    const children = document.getElementById(childrenId);
    const btn      = document.getElementById(btnId);
    if (!children || !btn) return;
    const isOpen = children.classList.contains('open');
    children.classList.toggle('open', !isOpen);
    btn.classList.toggle('open', !isOpen);
  };

  window.libPathToggleL2 = function(childrenId, btnId, event) {
    if (event && (event.target.classList.contains('lib-path-l2-info-btn') || 
                  event.target.classList.contains('lib-path-info-btn') ||
                  event.target.classList.contains('lib-path-l2-dl-btn'))) return;
    const children = document.getElementById(childrenId);
    const btn      = document.getElementById(btnId);
    if (!children || !btn) return;
    const isOpen = children.classList.contains('open');
    children.classList.toggle('open', !isOpen);
    btn.classList.toggle('open', !isOpen);
  };

  window.libPathOpenMoreInfo = function() {
    window.libPathOpenPopup(t('renderlib_paths_popup_title'), t('renderlib_paths_popup_body'), null);
  };

  /**
   * UPDATED: Optimized for Google Drive Zip Downloads
   */
  window.libPathDownload = function(url) {
  if (!url || url === '' || url.includes('placeholder.com')) {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = t('renderlib_download_coming_soon');
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2500);
    }
    return;
  }

  let finalUrl = url;

  // Convert sharing-link format to direct download format if needed
  if (url.includes('drive.google.com') && url.includes('/file/d/')) {
    const fileId = url.split('/file/d/')[1].split('/')[0];
    finalUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  }

  // Use the Android bridge if available (required for WebView), otherwise open
  // in a new browser tab. window.open() is preferred over a hidden <a download>
  // click for Drive URLs because the uc?export=download endpoint redirects
  // through an interstitial — window.open follows the redirect chain correctly
  // while the download attribute on an anchor behaves inconsistently across
  // browsers for cross-origin redirects.
  if (window.Android && typeof window.Android.openUrl === 'function') {
    window.Android.openUrl(finalUrl);
  } else {
    window.open(finalUrl, '_blank');
  }
  };

  window.libPathSetActive = function(pathwayKey, btn) {
    const current = localStorage.getItem('bsr_activePathwayId');
    if (current === pathwayKey) {
      // Toggle off
      localStorage.removeItem('bsr_activePathwayId');
    } else {
      safeSetItem('bsr_activePathwayId', pathwayKey);
    }
    // Refresh all set-active buttons in the current view so their state is correct
    document.querySelectorAll('.lib-path-set-active-btn').forEach(b => {
      const k = b.dataset.pathwayKey;
      const active = localStorage.getItem('bsr_activePathwayId') === k;
      b.classList.toggle('is-set', active);
      b.title     = active ? t('renderlib_pathway_active_clear') : t('renderlib_pathway_set_active');
      b.innerHTML = active ? ICONS.pathwayOn : ICONS.pathwayOff;
    });
  };

  window.libPathExpandAll = function() {
    document.querySelectorAll('.lib-path-l1-children, .lib-path-l2-children').forEach(el => el.classList.add('open'));
    document.querySelectorAll('.lib-path-l1-btn, .lib-path-l2-btn').forEach(el => el.classList.add('open'));
  };

  window.libPathCollapseAll = function() {
    document.querySelectorAll('.lib-path-l1-children, .lib-path-l2-children').forEach(el => el.classList.remove('open'));
    document.querySelectorAll('.lib-path-l1-btn, .lib-path-l2-btn').forEach(el => el.classList.remove('open'));
  };

  window.libPathsSetMode = function(mode) {
    const map = { some: 'libPathsCtrlSome', all: 'libPathsCtrlAll', collapse: 'libPathsCtrlCollapse' };
    Object.entries(map).forEach(([m, id]) => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle('active', m === mode);
    });
    if (mode === 'collapse') {
      document.querySelectorAll('.lib-path-l1-children, .lib-path-l2-children').forEach(el => el.classList.remove('open'));
      document.querySelectorAll('.lib-path-l1-btn, .lib-path-l2-btn').forEach(el => el.classList.remove('open'));
    } else if (mode === 'some') {
      // Open L1 groups only, close L2 children
      document.querySelectorAll('.lib-path-l1-children').forEach(el => el.classList.add('open'));
      document.querySelectorAll('.lib-path-l1-btn').forEach(el => el.classList.add('open'));
      document.querySelectorAll('.lib-path-l2-children').forEach(el => el.classList.remove('open'));
      document.querySelectorAll('.lib-path-l2-btn').forEach(el => el.classList.remove('open'));
    } else if (mode === 'all') {
      document.querySelectorAll('.lib-path-l1-children, .lib-path-l2-children').forEach(el => el.classList.add('open'));
      document.querySelectorAll('.lib-path-l1-btn, .lib-path-l2-btn').forEach(el => el.classList.add('open'));
    }
  };

  window.libShelvesOpenMoreInfo = function() {
    window.libPathOpenPopup(t('renderlib_shelves_popup_title'), t('renderlib_shelves_popup_body'), null);
  };

  // ── Render the tab bar and body into the overlay ─────────────────────────────
  const overlay = document.getElementById('mainContent');
  if (!overlay) return;

  const _extraTabs = (showRecent ? 1 : 0) + (showShelves ? 1 : 0) + (showPaths ? 1 : 0);
  const _longLabels = _extraTabs === 0;
  const tabs = [
    { id: 'all',     label: _longLabels ? t('renderlib_tab_all_long') : t('renderlib_tab_all')  },
    ...(showShelves ? [{ id: 'shelves', label: t('renderlib_tab_shelves') }] : []),
    ...(showPaths   ? [{ id: 'paths',   label: t('renderlib_tab_paths') }] : []),
    ...(showRecent  ? [{ id: 'recent',  label: t('renderlib_tab_recent') }] : []),
    { id: 'load',    label: _longLabels ? t('renderlib_tab_load_long') : t('renderlib_tab_load') },
  ];

  window._libTabs  = tabs;
  window.activeTabId = activeTab;

  const tabsHtml = tabs.map(t => `
    <button class="lib-tab${t.id === activeTab ? ' active' : ''}"
      onclick="switchLibTab('${t.id}')">${t.label}</button>`).join('');

  // ── Compute which languages are present (for the lang filter bar) ────────────
  // Only counts languages that exist in LANGUAGE_MAP so unmapped languages don't
  // produce orphaned buttons. Order follows LANGUAGE_MAP definition order.
  // Checks entry.langs (array, multilingual) and entry.lang (string, mono-lingual).
  const presentLangCodes = Object.keys(LANGUAGE_MAP).filter(code =>
    Object.values(studyCache).some(e =>
      (e.langs && e.langs.includes(code)) || e.lang === code
    )
  );

  overlay.innerHTML = `
    <div class="library-page">
      <div class="howto-header">
        <div class="howto-eyebrow">${t('renderlib_header_eyebrow')}</div>
        <div class="howto-title">${t('renderlib_header_title')}</div>
      </div>
      <div style="height:1px; background:rgba(245,240,232,0.10);"></div>
      <div class="lib-sticky-header" id="libStickyHeader">
        <div class="lib-tab-bar" id="libTabBar">${tabsHtml}</div>
        <div class="lib-lang-bar" id="libLangBar" style="display:none;"></div>
      </div>
      <div class="lib-tab-content" id="libTabContent"></div>
    </div>`;

  // ── Populate the active tab's content area ───────────────────────────────────
  const contentEl = document.getElementById('libTabContent');

  if (activeTab === 'load') {
    contentEl.innerHTML = buildLoadTab();

  } else if (activeTab === 'recent') {
    const result = buildRecentTab();
    if (result && result.frag) {
      contentEl.appendChild(result.frag);
    } else {
      contentEl.innerHTML = result || '';
    }

  } else if (activeTab === 'all') {
    const result = buildAllTab();
    if (result && result.frag) {
      contentEl.appendChild(result.frag);
    } else {
      contentEl.innerHTML = result || '';
    }

  } else if (activeTab === 'shelves') {
    contentEl.innerHTML = buildShelvesTab();
    libShelvesSetMode('some');

  } else if (activeTab === 'paths') {
    contentEl.innerHTML = buildPathsTab();
  }

  // ── Render the language filter bar (All/Shelves/Paths tabs only) ─────────────
  // Hidden on Load and Recent tabs where the filter has no effect.
  const langBarTabs = ['all', 'shelves', 'paths'];
  if (langBarTabs.includes(activeTab)) {
    renderLangBar(presentLangCodes);
  } else {
    const bar = document.getElementById('libLangBar');
    if (bar) bar.style.display = 'none';
  }

}

// Opens the highlighted estudy direct download link.
// Uses an old, hardcoded version of a "Conversion" study download as a fallback 
// (in case of appAboutData loading problems)
function libDownloadTryThis() {
  const id = window.appAboutData?.sampleDownloadId || '12GWu_cCP8XEyehOY0por--FYaBWloevT';
  const url = `https://drive.google.com/uc?export=download&id=${id}`;
  if (window.Android && typeof window.Android.openUrl === 'function') {
    window.Android.openUrl(url);
  } else {
    window.open(url, '_blank');
  }
}

// Switch the active library tab and re-render.
function switchLibTab(tabId) {
  window._libActiveTab = tabId;
  window.activeTabId   = tabId;
  renderLibrary();
}

// Toggle a shelf body open/closed.
function libToggleShelf(bodyId, chevId, event) {
  if (event && event.target.classList.contains('lib-shelf-info-btn')) return;
  const body = document.getElementById(bodyId);
  const chev = document.getElementById(chevId);
  if (!body) return;
  const isClosed = body.classList.contains('closed');
  body.classList.toggle('closed', !isClosed);
  if (chev) chev.classList.toggle('open', isClosed);
  document.querySelectorAll('.lib-shelves-ctrl-btn').forEach(b => b.classList.remove('active'));
}

// Set the Shelves tab expansion mode and update control button active state.
// mode: 'collapse' | 'some' | 'all'
function libShelvesSetMode(mode) {
  // Update button active states
  const map = { collapse: 'libShelvesCtrlCollapse', some: 'libShelvesCtrlSome', all: 'libShelvesCtrlAll' };
  Object.entries(map).forEach(([m, id]) => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle('active', m === mode);
  });

  const shelves     = document.querySelectorAll('.lib-shelf-body');
  const secBodies   = document.querySelectorAll('.lib-section-body');
  const shelfChevs  = document.querySelectorAll('.lib-shelf-chevron');
  const secChevs    = document.querySelectorAll('.lib-section-chevron');

  if (mode === 'collapse') {
    // Close all shelves (top-level), sections stay as-is inside
    shelves.forEach(el => el.classList.add('closed'));
    shelfChevs.forEach(el => el.classList.remove('open'));
  } else if (mode === 'some') {
    // Open all shelves, close all sections
    shelves.forEach(el => el.classList.remove('closed'));
    shelfChevs.forEach(el => el.classList.add('open'));
    secBodies.forEach(el => el.classList.remove('open'));
    secChevs.forEach(el => el.classList.remove('open'));
  } else if (mode === 'all') {
    // Open everything
    shelves.forEach(el => el.classList.remove('closed'));
    shelfChevs.forEach(el => el.classList.add('open'));
    secBodies.forEach(el => el.classList.add('open'));
    secChevs.forEach(el => el.classList.add('open'));
  }
}

// Toggle a section body open/closed.
function libToggleSection(bodyId, chevId, event) {
  if (event && event.target.classList.contains('lib-shelf-section-info-btn')) return;
  const body = document.getElementById(bodyId);
  const chev = document.getElementById(chevId);
  if (!body) return;
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  if (chev) chev.classList.toggle('open', !isOpen);
}