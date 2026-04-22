// ── STARRED QUESTIONS ─────────────────────────────────────────────────────────
// Manages the starring (bookmarking) of individual questions and reflection items.
// Stars are persisted to localStorage under a key derived from study ID, chapter
// number, and elementId. The starred summary panel at the top of each chapter
// view is rebuilt whenever a star is toggled.
//
// Dependencies (all available as globals before this file loads):
//   window.activeStudyId – state.js
//   chapters, currentChapter – main.js state block
//   goToChapter – main.js navigation

// Returns the localStorage key for a starred question.
// Format: bsr_{studyId}_star_ch{N}_{elementId}
function starKey(chapterNum, elementId) {
  const currentStudyId = window.activeStudyId;
  return `bsr_${currentStudyId}_star_ch${chapterNum}_${elementId}`;
}

// Returns true if the question identified by (chapterNum, elementId) is starred.
function isStarred(chapterNum, elementId) {
  return localStorage.getItem(starKey(chapterNum, elementId)) === '1';
}

// Toggles the starred state of a question in localStorage, updates the card's
// visual style and the star button icon, then rebuilds the starred summary panel.
function toggleStar(chapterNum, elementId) {
  const key = starKey(chapterNum, elementId);
  const currently = localStorage.getItem(key) === '1';
  if (currently) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, '1');
  }

  // Determine card and button IDs — reflection questions use elementId directly
  const cardId = elementId;
  const btnId  = `star_${elementId}`;

  const card = document.getElementById(cardId);
  const btn  = document.getElementById(btnId);

  if (card) card.classList.toggle('starred-card', !currently);
  if (btn)  btn.innerHTML = currently ? ICONS.starEmpty : ICONS.starFilled;

  refreshStarredSummary(chapterNum);
}

// Rebuilds the starred summary panel at the top of the current chapter view.
// Called after any star toggle to keep the panel in sync with localStorage.
function refreshStarredSummary(chapterNum) {
  const ch = chapters.find(c => c.num === chapterNum);
  if (!ch) return;
  const container = document.getElementById('starredSummaryContainer');
  if (!container) return;
  const starred = getStarredQuestions(ch);
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
function getStarredQuestions(ch) {
  const starred = [];

  // Standard questions — walk sections → questions
  if (ch.sections && Array.isArray(ch.sections)) {
    ch.sections.forEach(sec => {
      if (sec.questions && Array.isArray(sec.questions)) {
        sec.questions.forEach(q => {
          const eid = q.elementId;
          if (eid && isStarred(ch.chapterNumber, eid)) {
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
      if (isStarred(ch.chapterNumber, el.elementId)) {
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
  goToChapter(chIdx);
  setTimeout(() => {
    const card = document.getElementById(cardId);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 300);
}
