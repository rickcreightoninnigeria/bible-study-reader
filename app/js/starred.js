// ── STARRED QUESTIONS ─────────────────────────────────────────────────────────
// Manages the starring (bookmarking) of individual questions and reflection items.
// Stars are persisted to IndexedDB inside the per-chapter answer object, under
// a field name produced by starFieldKey(elementId) from state.js.
//
// Because renderQuestion() is synchronous, the chapter answer object must be
// pre-loaded by the orchestrator (renderChapter) and passed into ctx as
// ctx.chapterAnswers. isStarredFromCache() is the synchronous read used during
// rendering; isStarred() is the async version used outside of render.
//
// Dependencies (all available as globals before this file loads):
//   window.activeStudyId     – state.js
//   starFieldKey             – state.js
//   StudyIDB                 – idb.js
//   chapters, currentChapter – state.js
//   ICONS                    – icons.js
//   t()                      – i18n.js

// ── Synchronous read from a pre-loaded chapter answers object ─────────────────
// Used by renderQuestion() during chapter rendering, where the chapter answer
// object has already been fetched from IDB by the orchestrator and is available
// as ctx.chapterAnswers.
function isStarredFromCache(chapterAnswers, elementId) {
  return (chapterAnswers || {})[starFieldKey(elementId)] === '1';
}

// ── Async reads / writes ───────────────────────────────────────────────────────

// Returns true if the question identified by (chapterNum, elementId) is starred.
// Async — reads from IDB. Used outside of rendering (e.g. progress page,
// starred summary refresh after toggle).
async function isStarred(chapterNum, elementId) {
  const studyId = window.activeStudyId;
  if (!studyId) return false;
  try {
    const record = await StudyIDB.getChapterAnswers(studyId, chapterNum);
    return record[starFieldKey(elementId)] === '1';
  } catch (e) {
    console.warn('[isStarred] IDB read failed.', e);
    return false;
  }
}

// Toggles the starred state of a question in IDB, updates the card's
// visual style and the star button icon, then rebuilds the starred summary panel.
// Fire-and-forget async — callers (inline onclick handlers) do not await.
async function toggleStar(chapterNum, elementId) {
  const studyId = window.activeStudyId;
  if (!studyId) return;

  let record;
  try {
    record = await StudyIDB.getChapterAnswers(studyId, chapterNum);
  } catch (e) {
    console.warn('[toggleStar] IDB read failed.', e);
    return;
  }

  const field     = starFieldKey(elementId);
  const currently = record[field] === '1';

  if (currently) {
    delete record[field];
  } else {
    record[field] = '1';
  }

  try {
    await StudyIDB.setChapterAnswers(studyId, chapterNum, record);
  } catch (e) {
    console.warn('[toggleStar] IDB write failed.', e);
    return;
  }

  // Update the DOM immediately after the write succeeds.
  const cardId = elementId;
  const btnId  = `star_${elementId}`;
  const card   = document.getElementById(cardId);
  const btn    = document.getElementById(btnId);

  if (card) card.classList.toggle('starred-card', !currently);
  if (btn)  btn.innerHTML = currently ? ICONS.starEmpty : ICONS.starFilled;

  refreshStarredSummary(chapterNum);
}

// ── Starred summary panel ──────────────────────────────────────────────────────

// Rebuilds the starred summary panel at the top of the current chapter view.
// Called after any star toggle to keep the panel in sync with IDB.
// Async because getStarredQuestions() must read from IDB.
async function refreshStarredSummary(chapterNum) {
  const ch = chapters.find(c => c.chapterNumber === chapterNum);
  if (!ch) return;
  const container = document.getElementById('starredSummaryContainer');
  if (!container) return;
  const starred = await getStarredQuestions(ch);
  if (starred.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = buildStarredSummaryHtml(ch, starred);
}

// Returns an array of all starred questions and reflections for a chapter.
// Each item has shape: { q, elementId, isReflection }
// Covers both standard questions (from ch.sections) and reflection questions
// (from ch.elements with subtype 'reflection').
// Async — loads the chapter answer record from IDB once to check all star flags.
async function getStarredQuestions(ch, preloadedRecord = null) {
  const studyId = window.activeStudyId;
  if (!studyId) return [];

  let record;
  if (preloadedRecord !== null) {
    record = preloadedRecord;
  } else {
    try {
      record = await StudyIDB.getChapterAnswers(studyId, ch.chapterNumber);
    } catch (e) {
      console.warn('[getStarredQuestions] IDB read failed.', e);
      return [];
    }
  }

  const starred = [];

  // Standard questions — walk sections → questions
  if (ch.sections && Array.isArray(ch.sections)) {
    ch.sections.forEach(sec => {
      if (sec.questions && Array.isArray(sec.questions)) {
        sec.questions.forEach(q => {
          const eid = q.elementId;
          if (eid && record[starFieldKey(eid)] === '1') {
            starred.push({ q, elementId: eid, isReflection: false });
          }
        });
      }
    });
  }

  // Reflection questions — stored as elements with subtype 'reflection'
  if (ch.reflection && Array.isArray(ch.reflection)) {
    const reflEls = (ch.elements || []).filter(
      e => e.type === 'question' && e.subtype === 'reflection' && !e.repeatElement
    );
    reflEls.forEach((el, ri) => {
      if (record[starFieldKey(el.elementId)] === '1') {
        starred.push({
          q: { ref: t('starred_reflection_ref', { number: ri + 1 }), text: el.question },
          elementId: el.elementId,
          isReflection: true
        });
      }
    });
  }

  return starred;
}

// Builds the HTML for the collapsible starred summary panel shown at the top
// of a chapter. Each item is clickable and scrolls smoothly to the relevant card.
function buildStarredSummaryHtml(ch, starred) {
  const items = starred.map(({ q, elementId }) => `
    <div class="starred-summary-item"
      onclick="document.getElementById('${elementId}')
        .scrollIntoView({behavior:'smooth', block:'center'})">
      <div class="starred-summary-ref">${q.ref}</div>
      <div class="starred-summary-text">${q.text}</div>
    </div>`).join('');

  return `
    <div class="starred-summary">
      <div class="starred-summary-header" onclick="toggleStarredSummary()">
        <div class="starred-summary-title">${ICONS.starFilled} ${t('starred_panel_title')}</div>
        <div class="flex-row-gap">
          <span class="starred-summary-count">${starred.length}</span>
          <span class="starred-summary-chevron" id="starredChevron">${ICONS.chevronDown}</span>
        </div>
      </div>
      <div class="starred-summary-list" id="starredSummaryList">
        ${items}
      </div>
    </div>
  `;
}

// Toggles the open/collapsed state of the starred summary panel in a chapter view.
function toggleStarredSummary() {
  const list    = document.getElementById('starredSummaryList');
  const chevron = document.getElementById('starredChevron');
  if (!list) return;
  list.classList.toggle('open');
  if (chevron) chevron.classList.toggle('open');
}

// Toggles the starred list within a chapter row on the Progress Overview page.
// The list uses display:none/block rather than a CSS class, matching the
// inline style approach used by the progress overview renderer.
function toggleProgressStarred(chNum) {
  const list    = document.getElementById(`progressStarList_${chNum}`);
  const chevron = document.getElementById(`progressStarChevron_${chNum}`);
  if (!list) return;
  const isOpen = list.style.display !== 'none';
  list.style.display = isOpen ? 'none' : 'block';
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
}

// Navigates to the given chapter and scrolls to the starred card identified
// by cardId. The 300ms timeout allows renderChapter() to complete its DOM
// writes before scrollIntoView() is called.
function navigateToStarred(chIdx, cardId) {
  Router.navigate({ page: 'chapter', idx: chIdx });
  setTimeout(() => {
    const card = document.getElementById(cardId);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 300);
}
