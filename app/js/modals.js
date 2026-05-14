// ── MODALS ────────────────────────────────────────────────────────────────────
// Populates and opens/closes the QA callout modal, the Deeper Question modal,
// the Verse modal, and the Likert scale popup.
// Also contains the shared info modal system (createInfoTrigger / openInfoModal /
// closeInfoModal) used for ⓘ help popups and one-off info overlays throughout
// the app — including openNotesInfo().
// Also contains renderLikertScale() and qaCalloutHtml(), which build the
// inline HTML for those components during chapter rendering.
//
// Dependencies (all available as globals before this file loads):\
//   ICONS         – icons.js
//   appSettings   – settings.js
//   ttsAvailable, ttsSpeak, ttsStop – tts.js
//   likertFieldKey – state.js (IDB field-key helpers)
//   verseData, chapters, currentChapter – window globals / main.js
//   resolveText, buildLangMap – render-elements.js (language resolution)
//   window.studyMetadata      – study-loader.js (language slot map source)

// Opens the QA modal from an inline callout element (v2/v3 .estudy format).
// Looks up the element by its elementId across the current chapter's elements[].
//
// lang – the currently active study language code (e.g. 'ha', 'en'), passed
//        by renderCallout() via the button's onclick attribute. Used to resolve
//        the correct language slot for eyebrow, term, and answer.
//        Falls back gracefully to unnumbered fields for mono-lingual studies.
function openQaModalFromElement(elementId, lang) {
  const ch = chapters[currentChapter];
  if (!ch) return;
  const el = (ch.elements || []).find(e => e.elementId === elementId);
  if (!el) return;

  // Build the slot map from studyMetadata so we can resolve numbered fields.
  // For mono-lingual studies studyMetadata carries no languageN keys, so
  // langMap will be empty and resolveText falls back to unnumbered fields.
  const langMap = buildLangMap(window.studyMetadata || {});
  const activeLang = lang || window._activeStudyLang || 'en';

  // resolveText is defined in render-elements.js (loaded before modals.js).
  document.getElementById('qaModalEyebrow').textContent = resolveText(el, activeLang, 'eyebrow', langMap);
  document.getElementById('qaModalTerm').textContent    = resolveText(el, activeLang, 'term',    langMap);
  const answerHtml                                      = resolveText(el, activeLang, 'answer',  langMap);
  document.getElementById('qaModalText').innerHTML      = answerHtml;
  document.getElementById('qaModalOverlay').classList.add('open');
  const qsb = document.getElementById('qaModalSpeakBtn');
  if (qsb) {
    qsb.innerHTML = ttsAvailable() && appSettings.ttsMode !== 'never' ? ICONS.speak : '';
    qsb.onclick = () => ttsSpeak(answerHtml, qsb);
  }
}

// Opens the QA modal from the legacy qaCalloutsById lookup (v1 .estudy format).
// Kept for backward compatibility with any v1 study files still in use.
function openQaModal(id) {
  const data = (window.qaCalloutsById || {})[id];
  if (!data) return;
  document.getElementById('qaModalEyebrow').textContent = data.eyebrow;
  document.getElementById('qaModalTerm').textContent    = data.term;
  document.getElementById('qaModalText').innerHTML      = data.answer;
  document.getElementById('qaModalOverlay').classList.add('open');
}

// Closes the QA modal. If called from an overlay click event, only closes
// when the user clicked the overlay itself (not the modal card within it).
function closeQaModal(event) {
  if (event && event.target !== document.getElementById('qaModalOverlay')) return;
  ttsStop();
  document.getElementById('qaModalOverlay').classList.remove('open');
}

// Opens the "go deeper" modal for a question element.
// Looks up the element by elementId and populates the modal with its
// deeper.question text. The modal is read-only — no answer field.
//
// lang – the currently active study language code (e.g. 'ha', 'en'), passed
//        by renderQuestion() via the button's onclick attribute. Used to resolve
//        the correct language slot for the deeper question and label.
//        Falls back gracefully to unnumbered fields for mono-lingual studies.
function openDeeperModal(elementId, lang) {
  const ch = chapters[currentChapter];
  if (!ch) return;
  const el = (ch.elements || []).find(e => e.elementId === elementId);
  if (!el || !el.deeper) return;

  // Build the slot map from studyMetadata so we can resolve numbered fields.
  // For mono-lingual studies studyMetadata carries no languageN keys, so
  // langMap will be empty and resolveText falls back to unnumbered fields.
  const langMap    = buildLangMap(window.studyMetadata || {});
  const activeLang = lang || window._activeStudyLang || 'en';

  const body = document.getElementById('deeperModalBody');
  if (body) body.innerHTML = resolveText(el.deeper, activeLang, 'question', langMap);
  document.getElementById('deeperModalOverlay').classList.add('open');
}

// Closes the deeper modal. If triggered by an overlay click, only closes
// when the click target is the overlay itself, not the modal card.
function closeDeeperModal(event) {
  if (event && event.target !== document.getElementById('deeperModalOverlay')) return;
  document.getElementById('deeperModalOverlay').classList.remove('open');
}

// Returns the HTML string for a QA callout card from the legacy qaCalloutsById lookup.
// Only used when rendering v1 .estudy files that still carry qaPlacementRules.
// v2 files render callouts inline via the 'callout' element type in renderChapter().
function qaCalloutHtml(id) {
  const data = (window.qaCalloutsById || {})[id];
  if (!data) return '';
  return `
    <div class="qa-callout-card">
      <div class="qa-callout-eyebrow">${data.eyebrow}</div>
      <div class="qa-callout-body">
        <div class="qa-callout-term">${data.term}</div>
        <div class="qa-callout-question">${data.question}</div>
        <button class="qa-callout-btn" onclick="openQaModal('${id}')">
          ${t('modals_qa_callout_btn')}
        </button>
      </div>
    </div>
  `;
}

// Renders a Likert scale element into an HTML string.
// el             – the element object from the study JSON (type: 'likertScale')
// chNum          – the chapter number (used to scope radio input name attributes)
// chapterAnswers – optional pre-loaded IDB answer record for this chapter.
//                  When provided, saved values are read from it directly,
//                  avoiding a redundant IDB fetch. Pass null (or omit) to render
//                  with no pre-selected values.
//
// Expected el properties (standard):
//   elementId   – stable ID used for IDB field keys
//   scaleNumber – number of options (determines how many radio buttons per row)
//   scale       – array of label strings, length === scaleNumber
//   statements  – array of statement strings
//   instruction – instruction text shown in the popup
//   popupTitle  – title shown in the popup's title bar
//
// Additional properties for bipolar (subtype: 'bipolar'):
//   statementPairs – array of { left, right } objects instead of statements
function renderLikertScale(el, chNum, chapterAnswers = null) {
  const isBipolar  = el.subtype === 'bipolar';
  const n          = el.scaleNumber || (el.scale ? el.scale.length : 5);
  const scale      = el.scale || [];
  const eid        = el.elementId || '';

  // Number header labels (1 … N)
  const numberHeadersHtml = Array.from({ length: n }, (_, i) =>
    `<div class="likert-number-label">${i + 1}</div>`
  ).join('');

  // Build radio buttons for a given row index — shared by both subtypes
  function buildRadios(stIdx) {
    const fieldKey = likertFieldKey(eid, stIdx);
    const savedVal = chapterAnswers ? (chapterAnswers[fieldKey] || '') : '';
    return Array.from({ length: n }, (_, optIdx) => {
      const val     = optIdx + 1;
      const checked = savedVal === String(val) ? 'checked' : '';
      return `<input
        type="radio"
        class="likert-radio"
        name="likert_${chNum}_${eid}_${stIdx}"
        value="${val}"
        ${checked}
        onchange="saveLikertAnswer('${eid}', ${stIdx}, this.value)"
      />`;
    }).join('');
  }

  // One row per statement / statement pair
  let rowsHtml;
  if (isBipolar) {
    const pairs = el.statementPairs || [];
    rowsHtml = pairs.map((pair, stIdx) => `
      <div class="likert-row likert-row--bipolar">
        <div class="likert-statement likert-statement--left">${pair.left}</div>
        <div class="likert-options">${buildRadios(stIdx)}</div>
        <div class="likert-statement likert-statement--right">${pair.right}</div>
      </div>`
    ).join('');
  } else {
    const statements = el.statements || [];
    rowsHtml = statements.map((stmt, stIdx) => `
      <div class="likert-row">
        <div class="likert-statement">${stmt}</div>
        <div class="likert-options">${buildRadios(stIdx)}</div>
      </div>`
    ).join('');
  }

  // Safely escape title and instruction for single-quoted onclick args.
  // Scale is stored as a data attribute (JSON) to avoid double-quote
  // collision with the surrounding HTML attribute delimiters.
  const safeTitle = (el.popupTitle || '').replace(/'/g, "\\'");
  const safeInstr = (el.instruction || '').replace(/'/g, "\\'");
  const scaleJson = JSON.stringify(scale).replace(/"/g, '&quot;');

  return `
    <div class="likert-card">
      <div class="likert-header-row">
        <button class="likert-info-btn"
          data-scale="${scaleJson}"
          onclick="openLikertPopup('${safeTitle}', '${safeInstr}', this)"
          title="${t('modals_likert_about_title')}">${t('modals_likert_about_btn')}</button>
        <div class="likert-number-headers">${numberHeadersHtml}</div>
      </div>
      ${rowsHtml}
    </div>`;
}


// ── VERSE MODAL ───────────────────────────────────────────────────────────────
// Opens the verse modal and populates it with the passage for 'ref'.
// 'ref' must match a key in window.verseData (populated by renderBiblePassage()
// in render-elements.js).
//
// verseData[ref] shape (v2, multi-translation):
//   { translations: [{ label, text, url, ref }, ...] }
//
// verseData[ref] shape (v1, legacy single-translation):
//   { text, netUrl }
//   Normalised to the v2 shape on first access so the rest of this
//   function only needs to handle one code path.
//
// Translation tab behaviour:
//   • A row of .verse-trans-btn buttons is rendered, one per translation.
//   • The last-selected translation label is stored in window._activeTranslationLabel
//     (session-only) so the same translation is pre-selected when the next
//     passage is opened.
//   • If the stored label is not present in this passage, the first available
//     translation is used.
//   • Clicking a tab updates the ref display, passage text, speak button, and
//     external link — no modal close/reopen needed.

function openVerseModal(ref) {
  const raw = verseData[ref];
  if (!raw) return;

  // ── Normalise legacy v1 shape → v2 shape ─────────────────────────────────
  const data = raw.translations
    ? raw
    : {
        translations: [{
          label: raw.translation || 'NET',
          text:  raw.text  || '',
          url:   raw.netUrl || '',
          ref:   ref,
        }],
      };

  if (!data.translations.length) return;

  // ── Resolve the active translation ────────────────────────────────────────
  // Prefer the session-persistent label; fall back to the first slot.
  const preferred  = window._activeTranslationLabel;
  const activeTrans = data.translations.find(t => t.label === preferred)
    || data.translations[0];

  // ── Render the translation tab row ────────────────────────────────────────
  // Omitted entirely when only one translation is present (no tab row needed).
  const tabRowHtml = data.translations.length > 1
    ? `<div class="verse-trans-tab-row">${
        data.translations.map(tr =>
          `<button
            class="verse-trans-btn${tr.label === activeTrans.label ? ' active' : ''}"
            onclick="switchVerseTranslation('${ref}', '${tr.label}')"
          >${tr.label}</button>`
        ).join('')
      }</div>`
    : '';

  // ── Populate modal DOM ─────────────────────────────────────────────────────
  const tabRowEl = document.getElementById('verseModalTabRow');
  if (tabRowEl) tabRowEl.innerHTML = tabRowHtml;

  document.getElementById('verseModalRef').textContent   = activeTrans.ref || ref;
  document.getElementById('verseModalText').innerHTML    = activeTrans.text;
  document.getElementById('verseModalFooter').innerHTML  =
    activeTrans.url
      ? `(<a href="${activeTrans.url}" target="_blank">${t('modals_verse_net_link')}</a>)`
      : '';

  document.getElementById('verseModalOverlay').classList.add('open');

  // ── Wire speak button ─────────────────────────────────────────────────────
  _wireVerseModalSpeak(activeTrans.text);
}

// Switches the active translation tab without closing/reopening the modal.
// Called by the onclick on each .verse-trans-btn.
//
// ref   – the verseData key for the passage currently shown
// label – the translation label of the tab that was tapped
function switchVerseTranslation(ref, label) {
  const raw = verseData[ref];
  if (!raw) return;

  const data = raw.translations
    ? raw
    : { translations: [{ label: raw.translation || 'NET', text: raw.text, url: raw.netUrl, ref }] };

  const tr = data.translations.find(t => t.label === label);
  if (!tr) return;

  // Persist for the next passage opened in this session.
  window._activeTranslationLabel = label;

  // Update tab active state.
  document.querySelectorAll('.verse-trans-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.trim() === label);
  });

  // Update ref, text, footer link.
  document.getElementById('verseModalRef').textContent  = tr.ref || ref;
  document.getElementById('verseModalText').innerHTML   = tr.text;
  document.getElementById('verseModalFooter').innerHTML =
    tr.url
      ? `(<a href="${tr.url}" target="_blank">${t('modals_verse_net_link')}</a>)`
      : '';

  // Re-wire the speak button to the new translation's text.
  _wireVerseModalSpeak(tr.text);
}

// Internal helper: sets the speak button's visibility and onclick for the
// currently displayed translation text. Extracted to avoid repetition between
// openVerseModal and switchVerseTranslation.
function _wireVerseModalSpeak(text) {
  const vsb = document.getElementById('verseModalSpeakBtn');
  if (!vsb) return;
  vsb.innerHTML = ttsAvailable() && appSettings.ttsMode !== 'never' ? ICONS.speak : '';
  vsb.onclick   = () => ttsSpeak(text, vsb);
}

// Closes the verse modal. Called by the ✕ button and by clicking the overlay.
// When triggered by an overlay click event, only closes if the click was on the
// overlay itself (not on the modal card), preventing accidental dismissal.
function closeVerseModal(event) {
  if (event && event.target !== document.getElementById('verseModalOverlay')) return;
  ttsStop();
  document.getElementById('verseModalOverlay').classList.remove('open');
}


// Opens a plain info modal explaining the chapter Notes field.
// Uses the shared #info-modal-overlay
function openNotesInfo() {
  openInfoModal(
    'notes-field',
    {
      title: t('modals_notes_info_title'),
      body:  t('modals_notes_info_body'),
    },
    null   // no trigger button — called directly, not from a ⓘ icon
  );
}

// Opens the Likert explanation popup.
// title – shown in the title bar (from el.popupTitle)
// instr – instruction text (from el.instruction)
// btn   – the button element; its data-scale attribute holds the JSON scale array
function openLikertPopup(title, instr, btn) {
  const scale = JSON.parse(btn.dataset.scale);

  document.getElementById('likertPopupTitle').textContent = title;
  document.getElementById('likertPopupInstruction').textContent = instr;

  const keyHtml = scale.map((label, i) =>
    `<div class="likert-popup-key-row">
       <span class="likert-popup-key-num">${i + 1}</span>
       <span>${label}</span>
     </div>`
  ).join('');

  document.getElementById('likertPopupKey').innerHTML = keyHtml +
    `<p style="font-size:0.75em; color:var(--text-secondary, #888); text-align:center; margin-top:16px; margin-bottom:0;">${t('modals_likert_rotate_tip')}</p>`;
  document.getElementById('likertPopupOverlay').classList.add('open');
}

// Closes the Likert popup. If triggered by an overlay click, only closes
// when the click target is the overlay itself (not the modal card).
function closeLikertPopup(event) {
  if (event && event.target !== document.getElementById('likertPopupOverlay')) return;
  document.getElementById('likertPopupOverlay').classList.remove('open');
}

// ── INFO TRIGGER POPUPS ───────────────────────────────────────────────────────
// Provides first-time / onboarding help popups tied to a small ⓘ trigger icon.
// Each popup is identified by a unique infoId. The user can untick "Show this
// again" before closing, which stores 'hidden' in localStorage under the key
// bsr_infoSeen_${infoId} and removes the trigger icon from view.
// The icon reappears if the user resets defaults (which clears all bsr_ keys).
//
// Public API:
//   createInfoTrigger(infoId, content, options) → <button> | null
//   openInfoModal(infoId, content, triggerBtn)
//   closeInfoModal(event?)

// Tracks the trigger button for whichever info popup is currently open,
// so closeInfoModal() can hide it if the user unticks "Show this again".
let _currentInfoTriggerBtn = null;

/**
 * createInfoTrigger(infoId, content, options)
 *
 * Builds a small ⓘ trigger button for a help popup. Returns the button element
 * so the caller can insert it into the DOM (inline placement), or pass it back
 * via options.headingElement for automatic floating attachment.
 *
 * Returns null if the user has previously dismissed this popup (i.e. the
 * bsr_infoSeen_${infoId} key is set to 'hidden' in localStorage).
 *
 * @param {string} infoId   - Unique identifier for this popup.
 * @param {object} content  - { title: string, body: string (HTML) }
 * @param {object} options  - {
 *                              placement: 'inline' | 'floating',
 *                              headingElement: Element  // floating only
 *                            }
 * @returns {HTMLButtonElement|null}
 */
function createInfoTrigger(infoId, content, options = {}) {
  // Respect the user's previous "don't show again" choice.
  if (localStorage.getItem(`bsr_infoSeen_${infoId}`) === 'hidden') return null;

  const btn = document.createElement('button');
  btn.className   = 'info-trigger-btn';
  btn.innerHTML   = ICONS.triggerInfo;
  btn.title       = content.title || t('modals_info_trigger_default_label');
  btn.setAttribute('aria-label', content.title || t('modals_info_trigger_default_label'));
  btn.onclick     = () => openInfoModal(infoId, content, btn);

  // Floating placement: append the icon directly after the heading text.
  // The caller still receives the button, but doesn't need to insert it manually.
  if (options.placement === 'floating' && options.headingElement) {
    options.headingElement.appendChild(btn);
  }

  return btn;
}

/**
 * openInfoModal(infoId, content, triggerBtn)
 *
 * Populates the shared #info-modal-overlay with title and body content,
 * resets the "Show this again" checkbox to ticked, and opens the overlay.
 * Stores a reference to the trigger button so closeInfoModal() can hide it.
 *
 * @param {string}            infoId     - The infoId for this popup.
 * @param {object}            content    - { title: string, body: string (HTML) }
 * @param {HTMLButtonElement} triggerBtn - The ⓘ button that opened this modal.
 */
function openInfoModal(infoId, content, triggerBtn) {
  document.getElementById('info-modal-title').textContent = content.title || '';
  document.getElementById('info-modal-body').innerHTML    = content.body  || '';

  // Always reset checkbox to ticked when opening, regardless of previous state
  // during this session — the localStorage key is the source of truth.
  document.getElementById('infoModalShowAgain').checked = true;

  // Store context so closeInfoModal() can act on the right button and key.
  _currentInfoTriggerBtn          = triggerBtn;
  _currentInfoTriggerBtn._infoId  = infoId;

  document.getElementById('info-modal-overlay').classList.add('open');
}

/**
 * closeInfoModal(event?)
 *
 * Closes the info modal. Checks the "Show this again" checkbox:
 *   - Ticked:   closes the modal; trigger icon remains visible.
 *   - Unticked: stores 'hidden' in localStorage, hides the trigger icon,
 *               then closes the modal.
 *
 * When triggered by an overlay click event, only closes if the click
 * target is the overlay itself (not the modal card within it).
 *
 * @param {Event} [event] - Optional click event (from overlay onclick).
 */
function closeInfoModal(event) {
  if (event && event.target !== document.getElementById('info-modal-overlay')) return;
  const row = document.getElementById('infoModalShowAgainRow');
  if (row) row.style.display = '';   // restore for normal openInfoModal calls

  const showAgain = document.getElementById('infoModalShowAgain').checked;

  if (!showAgain && _currentInfoTriggerBtn) {
    const infoId = _currentInfoTriggerBtn._infoId;
    safeSetItem(`bsr_infoSeen_${infoId}`, 'hidden');
    // Remove the button from the DOM entirely so no gap or placeholder remains.
    _currentInfoTriggerBtn.remove();
  }

  _currentInfoTriggerBtn = null;
  document.getElementById('info-modal-overlay').classList.remove('open');
}

// ── FOOTNOTE MODAL ────────────────────────────────────────────────────────────
// A lightweight variant of openInfoModal for inline footnotes in Go Deeper text.
// Reuses the shared #info-modal-overlay DOM but suppresses the "Show this again"
// row — footnotes must always be accessible and must never be permanently hidden.
//
// @param {string} title    - Short label, e.g. 'Note 1'
// @param {string} bodyHtml - The footnote text (may contain markdown-rendered HTML)
function openFootnoteModal(title, bodyHtml) {
  document.getElementById('info-modal-title').textContent = title;
  document.getElementById('info-modal-body').innerHTML    = bodyHtml;

  // Hide the "Show this again" row — not appropriate for footnotes.
  const row = document.getElementById('infoModalShowAgainRow');
  if (row) row.style.display = 'none';

  // Null out the trigger reference so closeInfoModal()'s "remove button" path
  // is never taken (there is no trigger button to remove for footnotes).
  _currentInfoTriggerBtn = null;

  document.getElementById('info-modal-overlay').classList.add('open');
}

// USAGE EXAMPLES FOR INFO TRIGGERS
// Inline placement — caller inserts the returned button manually

//  const trigger = createInfoTrigger(
//    'notes-field',
//    {
//      title: 'Using the Notes field',
//      body:  '<p>Use this space for personal reflections, group discussion jottings, or prayer notes.</p>'
//    },
//    { placement: 'inline' }
//  );
//  if (trigger) someContainerElement.appendChild(trigger);
  
// Floating placement — icon is appended to the heading automatically

//  createInfoTrigger(
//    'likert-intro',
//    {
//      title: 'About this scale',
//      body:  '<p>Rate each statement honestly — there are no right or wrong answers.</p>'
//    },
//    {
//      placement:      'floating',
//      headingElement: document.querySelector('.likert-section-heading')
//    }
//  );


// ── LIKERT PRINT HELPERS ──────────────────────────────────────────────────────
// Injects .likert-print-summary nodes before window.print() fires, so that
// 08-themes.css @media print can display readable statement/response rows
// instead of raw radio inputs.
//
// Strategy:
//   beforeprint — for each .likert-card in the DOM, build a sibling
//                 .likert-print-summary and insert it immediately after.
//                 Reads the selected radio value from the live DOM (already
//                 reflects the IDB-loaded checked attribute set by
//                 renderLikertScale) and maps it to the scale label via the
//                 data-scale attribute on .likert-info-btn.
//   afterprint  — remove all injected nodes so the DOM is clean for screen use.
//
// Only standard (non-bipolar) scales are handled — bipolar is not yet
// implemented in renderLikertScale() so no .likert-card exists for it.

function _buildLikertPrintSummaries() {
  document.querySelectorAll('.likert-card').forEach(card => {
    // Read the scale label array from the data attribute set by renderLikertScale.
    const scaleJson = card.querySelector('.likert-info-btn')?.dataset?.scale;
    const scale     = scaleJson ? JSON.parse(scaleJson.replace(/&quot;/g, '"')) : [];

    const rows = Array.from(card.querySelectorAll('.likert-row'));
    if (!rows.length) return;

    const rowsHtml = rows.map(row => {
      const stmt    = row.querySelector('.likert-statement')?.textContent?.trim() || '';
      const checked = row.querySelector('.likert-radio:checked');
      const val     = checked ? parseInt(checked.value, 10) : -1;
      const label   = (val >= 1 && val <= scale.length) ? scale[val - 1] : null;
      return `<div class="likert-print-row">
        <div class="likert-print-statement">${stmt}</div>
        <div class="likert-print-response${label ? '' : ' no-response'}">${label || '—'}</div>
      </div>`;
    }).join('');

    const summary = document.createElement('div');
    summary.className            = 'likert-print-summary _likert-print-injected';
    summary.innerHTML            = `<div class="likert-print-title">${t('modals_likert_print_heading')}</div>${rowsHtml}`;
    card.insertAdjacentElement('afterend', summary);
  });
}

function _removeLikertPrintSummaries() {
  document.querySelectorAll('._likert-print-injected').forEach(el => el.remove());
}

window.addEventListener('beforeprint', _buildLikertPrintSummaries);
window.addEventListener('afterprint',  _removeLikertPrintSummaries);

// ──────────────────────────────────────────────────────────────────────────────
