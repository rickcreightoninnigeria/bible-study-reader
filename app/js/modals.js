// ── MODALS ────────────────────────────────────────────────────────────────────
// Populates and opens/closes the QA callout modal, the Deeper Question modal,
// the Verse modal, and the Likert scale popup.
// Also contains the shared info modal system (createInfoTrigger / openInfoModal /
// closeInfoModal) used for ⓘ help popups and one-off info overlays throughout
// the app — including openNotesInfo().
// Also contains renderLikertScale() and qaCalloutHtml(), which build the
// inline HTML for those components during chapter rendering.
//
// Dependencies (all available as globals before this file loads):
//   ICONS         – icons.js
//   appSettings   – settings.js
//   ttsAvailable, ttsSpeak, ttsStop – tts.js
//   likertKey     – main.js (storageKey helpers)
//   verseData, chapters, currentChapter – window globals / main.js

// Opens the QA modal from an inline callout element (v2 .estudy format).
// Looks up the element by its elementId across the current chapter's elements[].
function openQaModalFromElement(elementId) {
  const ch = chapters[currentChapter];
  if (!ch) return;
  const el = (ch.elements || []).find(e => e.elementId === elementId);
  if (!el) return;
  document.getElementById('qaModalEyebrow').textContent = el.eyebrow || '';
  document.getElementById('qaModalTerm').textContent    = el.term    || '';
  document.getElementById('qaModalText').innerHTML      = el.answer  || '';
  document.getElementById('qaModalOverlay').classList.add('open');
  const qsb = document.getElementById('qaModalSpeakBtn');
  if (qsb) {
    qsb.innerHTML = ttsAvailable() && appSettings.ttsMode !== 'never' ? ICONS.speak : '';
    qsb.onclick = () => ttsSpeak(el.answer || '', qsb);
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
function openDeeperModal(elementId) {
  const ch = chapters[currentChapter];
  if (!ch) return;
  const el = (ch.elements || []).find(e => e.elementId === elementId);
  if (!el || !el.deeper) return;
  const body = document.getElementById('deeperModalBody');
  if (body) body.innerHTML = el.deeper.question || '';
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
// el    – the element object from the study JSON (type: 'likertScale')
// chNum – the chapter number (for localStorage key scoping)
//
// Expected el properties:
//   elementId   – stable ID for localStorage keys
//   scaleNumber – number of options (determines how many radio buttons per row)
//   scale       – array of label strings, length === scaleNumber
//   statements  – array of statement strings
//   instruction – instruction text shown in the popup
//   popupTitle  – title shown in the popup's title bar
function renderLikertScale(el, chNum) {
  const n          = el.scaleNumber || (el.scale ? el.scale.length : 5);
  const scale      = el.scale || [];
  const statements = el.statements || [];
  const eid        = el.elementId || '';

  // Number header labels (1 … N)
  const numberHeadersHtml = Array.from({ length: n }, (_, i) =>
    `<div class="likert-number-label">${i + 1}</div>`
  ).join('');

  // One row per statement
  const rowsHtml = statements.map((stmt, stIdx) => {
    const savedVal   = localStorage.getItem(likertKey(chNum, eid, stIdx));
    const radiosHtml = Array.from({ length: n }, (_, optIdx) => {
      const val    = optIdx + 1;  // 1-based, matching the column headers
      const checked = savedVal === String(val) ? 'checked' : '';
      const keyStr  = likertKey(chNum, eid, stIdx);
      return `<input
        type="radio"
        class="likert-radio"
        name="likert_${chNum}_${eid}_${stIdx}"
        value="${val}"
        ${checked}
        onchange="localStorage.setItem('${keyStr}', this.value); updateProgress();"
      />`;
    }).join('');

    return `
      <div class="likert-row">
        <div class="likert-statement">${stmt}</div>
        <div class="likert-options">${radiosHtml}</div>
      </div>`;
  }).join('');

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

// Opens the verse modal and populates it with the NET Bible text for 'ref'.
// 'ref' must match a key in window.verseData exactly (populated by renderChapter()).
// If no match is found, returns silently.
function openVerseModal(ref) {
  const data = verseData[ref];
  if (!data) return;
  document.getElementById('verseModalRef').textContent = t('modals_verse_ref_label', { ref });
  document.getElementById('verseModalText').innerHTML = data.text;
  document.getElementById('verseModalFooter').innerHTML =
    `(<a href="${data.netUrl}" target="_blank">${t('modals_verse_net_link')}</a>)`;
  document.getElementById('verseModalOverlay').classList.add('open');
  const vsb = document.getElementById('verseModalSpeakBtn');
  if (vsb) {
    vsb.innerHTML = ttsAvailable() && appSettings.ttsMode !== 'never' ? ICONS.speak : '';
    vsb.onclick = () => ttsSpeak(data.text, vsb);
  }
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

  const showAgain = document.getElementById('infoModalShowAgain').checked;

  if (!showAgain && _currentInfoTriggerBtn) {
    const infoId = _currentInfoTriggerBtn._infoId;
    localStorage.setItem(`bsr_infoSeen_${infoId}`, 'hidden');
    // Remove the button from the DOM entirely so no gap or placeholder remains.
    _currentInfoTriggerBtn.remove();
  }

  _currentInfoTriggerBtn = null;
  document.getElementById('info-modal-overlay').classList.remove('open');
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
//  //  //    'likert-intro',
//    {
//      title: 'About this scale',
//      body:  '<p>Rate each statement honestly — there are no right or wrong answers.</p>'
//    },
//    {
//      placement:      'floating',
//      headingElement: document.querySelector('.likert-section-heading')
//    }
//  );

// ──────────────────────────────────────────────────────────────────────────────
