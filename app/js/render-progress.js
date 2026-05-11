// ── PROGRESS OVERVIEW ─────────────────────────────────────────────────────────
// Renders the My Progress page, the Notes & Comments page, and their helpers.
// Progress is calculated from localStorage answers on the fly — no cached state.
//
// Dependencies (all available as globals before this file loads):
//   ICONS                          – icons.js
//   appSettings                    – settings.js
//   chapters, isNonChapterPage     – main.js STATE section
//   storageKey                     – main.js STATE section
//   window.activeTabPage,
//   window.activeStudyId           – state.js
//   closeMenu, _resetNonChapterPageState,
//   closeNonChapterPage            – navigation.js
//   getStarredQuestions            – starred.js
//   navigateToStarred,
//   toggleProgressStarred          – starred.js
//   autoResize                     – settings.js
//   goToChapter                    – navigation.js
//   activateStudy                  – main.js

// ── PATHWAY HELPERS ───────────────────────────────────────────────────────────

// Reads bsr_activePathwayId from localStorage and resolves it to the pathway
// object from learningPathways.json. The key is a composite "l1Idx_l2Idx"
// string, e.g. "0_2". Returns null if nothing is set or the key can't be found.
function getActivePathway() {
  const key = localStorage.getItem('bsr_activePathwayId');
  if (!key) return null;
  const [l1, l2] = key.split('_').map(Number);
  const pathways = ((window.appAboutData || {}).learningPathways || {}).learningPathways || [];
  const l1Item = pathways[l1];
  if (!l1Item) return null;
  const l2Item = (l1Item.pathways || [])[l2];
  if (!l2Item) return null;
  return { ...l2Item, _l1Title: l1Item.titleLevel1, _key: key };
}

// Sets the active pathway in localStorage and re-renders the progress page
// so the tab bar appears immediately after selection.
function setActivePathway(l1Idx, l2Idx) {
  safeSetItem('bsr_activePathwayId', `${l1Idx}_${l2Idx}`);
  Router.replaceState({ page: 'progress' });
  renderProgressOverview();
}

// Clears the active pathway and re-renders.
function clearActivePathway() {
  localStorage.removeItem('bsr_activePathwayId');
  Router.replaceState({ page: 'progress' });
  renderProgressOverview();
}

// Counts answered questions for an arbitrary studyId by scanning localStorage
// keys of the form bsr_{studyId}_ch*_q_* and bsr_{studyId}_ch*_r_*.
// Does not require the study to be loaded — works entirely from storage keys.
// Returns { answered, total } where total is the count of keys found (answered
// + unanswered). This is a lightweight approximation: it counts storage slots
// that exist, which means studies never opened will return { answered:0, total:0 }.
function getStudyProgressForId(studyId) {
  const prefix = `bsr_${studyId}_`;
  let answered = 0;
  let total    = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k.startsWith(prefix)) continue;
    // Count question, reflection, and Likert answer slots, not notes/settings
    if (!/_(q|r|likert)_/.test(k)) continue;
    total++;
    if ((localStorage.getItem(k) || '').trim()) answered++;
  }
  return { answered, total };
}

// Returns the position (1-based) of studyId within the given pathway's
// studyTitles array, or null if not found.
function getStudyPositionInPathway(pathway, studyId) {
  if (!pathway || !studyId) return null;
  const idx = (pathway.studyTitles || []).findIndex(s => s.studyId === studyId);
  return idx === -1 ? null : idx + 1;
}


// ── EXISTING HELPERS ──────────────────────────────────────────────────────────

// Returns progress stats for a single chapter: total questions, answered count,
// and percentage. Used by renderProgressOverview() and the menu checkmarks.
function getChapterProgress(ch) {
  let total    = 0;
  let answered = 0;

  ch.sections.forEach(sec => {
    sec.questions.forEach(q => {
      total++;
      const val = localStorage.getItem(storageKey(ch.chapterNumber, 'q', q.elementId)) || '';
      if (val.trim()) answered++;
    });
  });

  if (ch.reflection) {
    const reflEls = (ch.elements || []).filter(
      e => e.type === 'question' && e.subtype === 'reflection' && !e.repeatElement
    );
    ch.reflection.forEach((r, rIdx) => {
      total++;
      const eid = reflEls[rIdx] ? reflEls[rIdx].elementId : null;
      const val = eid ? (localStorage.getItem(storageKey(ch.chapterNumber, 'r', eid)) || '') : '';
      if (val.trim()) answered++;
    });
  }

  // Count each Likert statement individually — a scale with N statements
  // contributes N items to total, one per answered statement to answered.
  (ch.elements || [])
    .filter(e => e.type === 'likertScale' && !e.repeatElement)
    .forEach(el => {
      (el.statements || []).forEach((_, stIdx) => {
        total++;
        const val = localStorage.getItem(likertKey(ch.chapterNumber, el.elementId, stIdx)) || '';
        if (val.trim()) answered++;
      });
    });

  return { total, answered, pct: total > 0 ? Math.round((answered / total) * 100) : 0 };
}

// Generates an SVG circular progress ring as an HTML string.
function progressRingSvg(pct, size, strokeWidth, color, bgColor) {
  const r            = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const offset       = circumference - (pct / 100) * circumference;
  const cx           = size / 2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${cx}" cy="${cx}" r="${r}"
      fill="none" stroke="${bgColor}" stroke-width="${strokeWidth}"/>
    <circle cx="${cx}" cy="${cx}" r="${r}"
      fill="none" stroke="${color}" stroke-width="${strokeWidth}"
      stroke-dasharray="${circumference}"
      stroke-dashoffset="${offset}"
      stroke-linecap="round"
      transform="rotate(-90 ${cx} ${cx})"/>
  </svg>`;
}

// Returns an { text, icon } object with an encouraging message appropriate
// to the given completion percentage.
function progressEncouragement(pct) {
  if (pct === 0)  return { text: t('progress_encourage_0'),   icon: "📚" };
  if (pct <= 24)  return { text: t('progress_encourage_24'),  icon: "🌱" };
  if (pct <= 39)  return { text: t('progress_encourage_39'),  icon: "💪" };
  if (pct <= 49)  return { text: t('progress_encourage_49'),  icon: "🎯" };
  if (pct === 50) return { text: t('progress_encourage_50'),  icon: "⭐" };
  if (pct <= 74)  return { text: t('progress_encourage_74'),  icon: "🎯" };
  if (pct <= 89)  return { text: t('progress_encourage_89'),  icon: "🏃" };
  if (pct <= 99)  return { text: t('progress_encourage_99'),  icon: "👊" };
  return                 { text: t('progress_encourage_100'), icon: "🎉" };
}


// ── TAB BAR ───────────────────────────────────────────────────────────────────

// Renders the two-tab bar (Active Study / Active Pathway) used when a pathway
// is set. activeTab is 'study' | 'pathway'.
function _progressTabBarHtml(activeTab) {
  return `
    <div class="progress-tab-bar" id="progressTabBar">
      <button
        class="progress-tab ${activeTab === 'study' ? 'active' : ''}"
        onclick="switchProgressTab('study')">${t('progress_tab_study')}</button>
      <button
        class="progress-tab ${activeTab === 'pathway' ? 'active' : ''}"
        onclick="switchProgressTab('pathway')">${t('progress_tab_pathway')}</button>
    </div>`;
}

// Switches between the two progress tabs without re-rendering the whole page.
window.switchProgressTab = function(tab) {
  document.querySelectorAll('.progress-tab').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.toLowerCase().includes(tab));
  });
  const studyPanel   = document.getElementById('progressStudyPanel');
  const pathwayPanel = document.getElementById('progressPathwayPanel');
  if (studyPanel)   studyPanel.style.display   = tab === 'study'   ? '' : 'none';
  if (pathwayPanel) pathwayPanel.style.display = tab === 'pathway' ? '' : 'none';
  window._progressActiveTab = tab;
  if (tab === 'study') { restoreStudyTheme(); } else { suspendStudyTheme(); }

  // Swap header content to match the active tab
  const eyebrow = document.getElementById('progressHeaderEyebrow');
  const title   = document.getElementById('progressHeaderTitle');
  const count   = document.getElementById('progressHeaderCount');
  if (!eyebrow || !title || !count) return;

  if (tab === 'study') {
    eyebrow.textContent = window.titlePageData?.title ?? t('progress_no_study_active');
    eyebrow.style.cursor = '';
    title.textContent   = t('progress_header_title_study');
    // Restore the answer count text (stored on the element when first rendered)
    count.textContent   = count.dataset.studyText || '';
  } else {
    // Pathway tab
    const pathway = getActivePathway();
    if (!pathway) return;
    eyebrow.textContent = `${pathway._l1Title}: ${pathway.titleLevel2}`;
    title.textContent = t('progress_header_title_pathway');
    // Compute pathway answer count
    const registry = JSON.parse(localStorage.getItem('study_registry') || '[]');
    let pAnswered = 0, pTotal = 0;
    (pathway.studyTitles || []).forEach(s => {
      const { answered, total } = getStudyProgressForId(s.studyId);
      pAnswered += answered; pTotal += total;
    });
    count.textContent = pTotal === 0
      ? t('progress_count_no_answers')
      : pAnswered === pTotal
        ? t('progress_count_pathway_all_done')
        : t('progress_count_pathway_partial', { answered: pAnswered, total: pTotal });
  }
};


// ── ACTIVE STUDY TAB ──────────────────────────────────────────────────────────

// Builds the HTML for the Active Study panel (the existing progress view).
// pathway is the resolved pathway object or null.
function _buildStudyPanelHtml(chapterStats, overallAnswered, overallTotal, overallPct, pathway) {
  const ringColor = overallPct === 100 ? 'var(--success)' : 'var(--accent)';
  const bgColor   = 'var(--border)';

  // Pathway position pill — shown when the active study is part of the active pathway
  let pathwayPill = '';
  if (pathway) {
    const pos   = getStudyPositionInPathway(pathway, window.activeStudyId);
    const total = (pathway.studyTitles || []).length;
    if (pos !== null) {
      pathwayPill = `
        <div class="progress-pathway-pill">
          <span class="progress-pathway-pill-icon">🗺</span>
          ${t('progress_pathway_pill', { pos, total, pathwayTitle: pathway.titleLevel2 })}
        </div>`;
    }
  }

  const chapterRows = chapterStats.map(({ ch, total, answered, pct }) => {
    const chRingColor = pct === 100 ? 'var(--success)' : pct > 0 ? 'var(--accent)' : 'var(--border)';
    const chBgColor   = 'var(--border)';
    const isDone      = pct === 100;

    const starredQs   = getStarredQuestions(ch);
    const starredHtml = starredQs.length > 0 ? `
      <div class="prog-star-section">
        <div onclick="toggleProgressStarred(${ch.chapterNumber})" class="prog-star-toggle">
          <div class="prog-star-label">${ICONS.starFilled} ${t('progress_starred_count', { count: starredQs.length })}</div>
          <span id="progressStarChevron_${ch.chapterNumber}" class="prog-star-chevron">${ICONS.chevronDown}</span>
        </div>
        <div id="progressStarList_${ch.chapterNumber}" class="prog-star-list">
          ${starredQs.map(({ q, elementId }) => `
            <div onclick="navigateToStarred(${ch.chapterNumber - 1}, '${elementId}')" class="prog-star-item">
              <div class="prog-star-ref">${q.ref}</div>
              <div class="prog-star-text">${q.text}</div>
            </div>`).join('')}
        </div>
      </div>
    ` : '';

    return `
      <div class="progress-chapter-item prog-chapter-outer">
        <div class="prog-chapter-inner" onclick="Router.navigate({ page: 'chapter', idx: ${ch.chapterNumber - 1} })">
          <div class="progress-chapter-ring">
            ${progressRingSvg(pct, 44, 4, chRingColor, chBgColor)}
          </div>
          <div class="progress-chapter-info">
            <div class="progress-chapter-num">${t('progress_chapter_num', { num: ch.chapterNumber })}</div>
            <div class="progress-chapter-title">${ch.chapterTitle}</div>
          </div>
          <div class="progress-chapter-count ${isDone ? 'done' : ''}">
            ${isDone ? t('progress_chapter_done') : answered === 0 ? t('progress_chapter_not_started') : `${answered}/${total}`}
          </div>
        </div>
        ${starredHtml}
      </div>`;
  }).join('');

  return `
    ${pathwayPill}

    <div class="encouragement-box">
      <div class="encouragement-box-icon">${progressEncouragement(overallPct).icon}</div>
      <div class="encouragement-box-text">${progressEncouragement(overallPct).text}</div>
    </div>

    <div class="progress-overall">
      <div class="progress-overall-ring">
        ${progressRingSvg(overallPct, 64, 6, ringColor, bgColor)}
      </div>
      <div class="progress-overall-text">
        <div class="progress-overall-label">${t('progress_overall_label')}</div>
        <div class="progress-overall-pct">${overallPct}%</div>
        <div class="progress-overall-detail">
          ${t('progress_overall_detail', { answered: overallAnswered, remaining: overallTotal - overallAnswered })}
        </div>
      </div>
    </div>

    <div class="progress-chapters">
      ${chapterRows}
    </div>`;
}


// ── ACTIVE PATHWAY TAB ────────────────────────────────────────────────────────

// Builds the HTML for the Active Pathway panel.
function _buildPathwayPanelHtml(pathway) {
  const registry = JSON.parse(localStorage.getItem('study_registry') || '[]');

  // Overall pathway stats
  let pathwayAnswered = 0;
  let pathwayTotal    = 0;

  const studyRows = (pathway.studyTitles || []).map((s, idx) => {
    const isActive   = s.studyId === window.activeStudyId;
    const inRegistry = registry.includes(s.studyId);
    const { answered, total } = getStudyProgressForId(s.studyId);
    pathwayAnswered += answered;
    pathwayTotal    += total;

    const pct        = total > 0 ? Math.round((answered / total) * 100) : 0;
    const ringColor  = pct === 100 ? 'var(--success)' : pct > 0 ? 'var(--accent)' : 'var(--border)';
    const bgColor    = 'var(--border)';
    const isDone     = pct === 100;

    // Status label
    let statusLabel;
    if (isDone)            statusLabel = `<span class="prog-pathway-status done">${t('progress_status_done')}</span>`;
    else if (isActive)     statusLabel = `<span class="prog-pathway-status active-study">${t('progress_status_active')}</span>`;
    else if (answered > 0) statusLabel = `<span class="prog-pathway-status in-progress">${answered}/${total}</span>`;
    else                   statusLabel = `<span class="prog-pathway-status not-started">${t('progress_status_not_started')}</span>`;

    // Open/activate button — deliberate action, separated visually from row tap
    let openBtn;
    if (isActive) {
      openBtn = `<button class="prog-pathway-open-btn current" title="${t('progress_btn_current_study_title')}" disabled>★</button>`;
    } else if (inRegistry) {
      openBtn = `<button class="prog-pathway-open-btn" title="${t('progress_btn_open_study_title')}"
        onclick="event.stopPropagation(); activateStudy('${s.studyId}')">→</button>`;
    } else {
      openBtn = `<button class="prog-pathway-open-btn" title="${t('progress_btn_find_library_title')}"
        onclick="event.stopPropagation(); Router.navigate({ page: 'library' })">↗</button>`;
    }

    // Expandable per-study detail row (toggled by tapping the main row)
    const detailId = `progPathStudy_${idx}`;

    return `
      <div class="prog-pathway-study-item ${isActive ? 'is-active-study' : ''}">
        <div class="prog-pathway-study-row"
          onclick="toggleProgPathwayStudy('${detailId}')">
          <div class="prog-pathway-study-ring">
            ${progressRingSvg(pct, 40, 4, ringColor, bgColor)}
          </div>
          <div class="prog-pathway-study-info">
            <div class="prog-pathway-study-num">${t('progress_study_num', { num: idx + 1 })}</div>
            <div class="prog-pathway-study-title">${s.titleLevel3}</div>
          </div>
          <div class="prog-pathway-study-right">
            ${statusLabel}
            ${openBtn}
            <span class="prog-pathway-chevron" id="${detailId}_chevron">▾</span>
          </div>
        </div>
        <div class="prog-pathway-study-detail" id="${detailId}">
          ${total === 0
            ? `<div class="prog-pathway-detail-empty">
                ${inRegistry
                  ? t('progress_detail_open_to_start')
                  : t('progress_detail_not_installed')}
               </div>`
            : _buildPathwayStudyDetail(s.studyId, answered, total)
          }
        </div>
      </div>`;
  }).join('');

  const pathwayPct = pathwayTotal > 0 ? Math.round((pathwayAnswered / pathwayTotal) * 100) : 0;
  const ringColor  = pathwayPct === 100 ? 'var(--success)' : 'var(--accent)';

  return `
    <div class="progress-overall">
      <div class="progress-overall-ring">
        ${progressRingSvg(pathwayPct, 64, 6, ringColor, 'var(--border)')}
      </div>
      <div class="progress-overall-text">
        <div class="progress-overall-label">${t('progress_pathway_overall_label')}</div>
        <div class="progress-overall-pct">${pathwayPct}%</div>
        <div class="progress-overall-detail">
          ${pathwayTotal === 0
            ? t('progress_pathway_no_studies_opened')
            : t('progress_overall_detail', { answered: pathwayAnswered, remaining: pathwayTotal - pathwayAnswered })}
        </div>
      </div>
    </div>

    <div class="progress-chapters">
      ${studyRows}
    </div>

    <div class="prog-pathway-clear-wrap">
      <button class="prog-pathway-clear-btn" onclick="clearActivePathway()">
        ${t('progress_clear_pathway_btn')}
      </button>
    </div>`;
}

// Builds the detail rows shown when a pathway study is expanded.
// Scans localStorage for chapter keys belonging to studyId.
function _buildPathwayStudyDetail(studyId, answered, total) {
  const prefix  = `bsr_${studyId}_`;
  const chNums  = new Set();

  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k.startsWith(prefix)) continue;
    if (!/_(q|r)_/.test(k)) continue;
    const match = k.match(/_ch(\d+)_/);
    if (match) chNums.add(Number(match[1]));
  }

  if (chNums.size === 0) {
    return `<div class="prog-pathway-detail-empty">${t('progress_detail_no_answers')}</div>`;
  }

  const rows = [...chNums].sort((a, b) => a - b).map(chNum => {
    const chPrefix   = `${prefix}ch${chNum}_`;
    let chTotal      = 0;
    let chAnswered   = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k.startsWith(chPrefix)) continue;
      if (!/_(q|r)_/.test(k)) continue;
      chTotal++;
      if ((localStorage.getItem(k) || '').trim()) chAnswered++;
    }
    const pct       = chTotal > 0 ? Math.round((chAnswered / chTotal) * 100) : 0;
    const ringColor = pct === 100 ? 'var(--success)' : pct > 0 ? 'var(--accent)' : 'var(--border)';
    const isDone    = pct === 100;

    return `
      <div class="prog-pathway-detail-row">
        <div class="prog-pathway-detail-ring">
          ${progressRingSvg(pct, 32, 3, ringColor, 'var(--border)')}
        </div>
        <div class="prog-pathway-detail-label">${t('progress_chapter_num', { num: chNum })}</div>
        <div class="prog-pathway-detail-count ${isDone ? 'done' : ''}">
          ${isDone ? '✓' : chAnswered === 0 ? '—' : `${chAnswered}/${chTotal}`}
        </div>
      </div>`;
  }).join('');

  return `<div class="prog-pathway-detail-list">${rows}</div>`;
}

// Toggles the expand/collapse of a single study's detail block in the pathway tab.
window.toggleProgPathwayStudy = function(detailId) {
  const detail  = document.getElementById(detailId);
  const chevron = document.getElementById(`${detailId}_chevron`);
  if (!detail) return;
  const isOpen = detail.classList.contains('open');
  detail.classList.toggle('open', !isOpen);
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
};

// ── MAIN RENDER ───────────────────────────────────────────────────────────────

// Renders the Progress Overview page into #mainContent.
function renderProgressOverview() {
  closeMenu();
  _resetNonChapterPageState();
  isNonChapterPage = true;
  window.activeTabPage = 'progress';
  if ((window._progressActiveTab || 'study') === 'study') { restoreStudyTheme(); } else { suspendStudyTheme(); }

  const progressBtn = document.getElementById('navProgressBtn');
  if (progressBtn) {
    progressBtn.innerHTML = ICONS.close;
    progressBtn.onclick = () => Router.back();
  }

  const content = document.getElementById('mainContent');
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.parentElement.style.display = 'none';
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('header-title').innerText = t('progress_header_title_study');

  // Calculate overall totals
  let overallTotal    = 0;
  let overallAnswered = 0;
  const chapterStats  = chapters.map(ch => {
    const stats = getChapterProgress(ch);
    overallTotal    += stats.total;
    overallAnswered += stats.answered;
    return { ch, ...stats };
  });
  const overallPct = overallTotal > 0
    ? Math.round((overallAnswered / overallTotal) * 100) : 0;

  const pathway       = getActivePathway();
  const hasPathway    = !!pathway;
  // Restore the last active tab, defaulting to 'study'
  const activeTab     = window._progressActiveTab || 'study';

  const studyPanelHtml   = _buildStudyPanelHtml(chapterStats, overallAnswered, overallTotal, overallPct, pathway);
  const pathwayPanelHtml = hasPathway ? _buildPathwayPanelHtml(pathway) : '';

  // Pre-compute the answer count string (also stored in data-study-text for tab switching)
  const answerCountText = overallAnswered === 0
    ? t('progress_count_no_answers_start')
    : overallPct === 100
      ? t('progress_count_all_done')
      : t('progress_count_partial', { answered: overallAnswered, total: overallTotal });

  const html = `
    <div class="progress-page">

      <div class="progress-header">
        <div class="progress-eyebrow" id="progressHeaderEyebrow">${window.titlePageData?.title ?? t('progress_no_study_active')}</div>
        <div class="progress-title" id="progressHeaderTitle">${t('progress_header_title_study')}</div>
        <div class="progress-answer-count" id="progressHeaderCount" data-study-text="${answerCountText}">
          ${answerCountText}
        </div>
      </div>
      <div style="height:1px; background:var(--border);"></div>

      ${hasPathway ? _progressTabBarHtml(activeTab) : ''}

      <div id="progressStudyPanel"
        style="${hasPathway && activeTab !== 'study' ? 'display:none' : ''}">
        ${studyPanelHtml}
      </div>

      ${hasPathway ? `
      <div id="progressPathwayPanel"
        style="${activeTab !== 'pathway' ? 'display:none' : ''}">
        ${pathwayPanelHtml}
      </div>` : ''}

      <div class="page-close-bar">
        <button class="page-close-btn" onclick="Router.back()"><span>${ICONS.close}</span> ${t('progress_close_btn')}</button>
      </div>

      <div style="height:40px;"></div>
    </div>`;

  content.innerHTML = html;
  // Sync header and theme to whichever tab is active
  switchProgressTab(activeTab);
  window.scrollTo(0, 0);
}


// ── NOTES PAGE ────────────────────────────────────────────────────────────────

// Renders the optional global Notes & Comments page.
function renderNotesPage() {
  closeMenu();
  _resetNonChapterPageState();
  isNonChapterPage = true;
  window.activeTabPage = 'notes';
  const content = document.getElementById('mainContent');
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.parentElement.style.display = 'none';
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('header-title').innerText = t('progress_notes_page_title');

  const currentStudyId = window.activeStudyId;
  const savedText      = escapeHtml(localStorage.getItem(`bsr_${currentStudyId}_global_notes`) || '');

  content.innerHTML = `
    <div class="howto-page">

      <div class="howto-header">
        <div class="howto-eyebrow">${t('progress_notes_eyebrow')}</div>
        <div class="howto-title">${t('progress_notes_page_title')}</div>
      </div>

      <div class="notes-info-wrap">
        <div onclick="document.querySelector('#mainContent').__notesPageInfo()" class="notes-info-link">
          <span class="notes-info-link-label">${t('progress_notes_about_link')}</span>
          <span class="notes-info-link-icon">${ICONS.triggerInfo}</span>
        </div>
      </div>

      <div class="question-card notes-card-wrap">
        <div class="question-ref notes-card-ref">${t('progress_notes_card_ref')}</div>
        <textarea
          id="globalNotesField"
          class="answer-field"
          placeholder="${t('progress_notes_placeholder')}"
          oninput="autoResize(this); safeSetItem(\`bsr_${currentStudyId}_global_notes\`, this.value); updateNotesMenuIndicator(!!this.value);"
        >${savedText}</textarea>
      </div>
      <div class="notes-autosave-label">${t('progress_notes_autosave_label')}</div>

      <div class="page-close-bar">
        <button class="page-close-btn" onclick="Router.back()"><span>${ICONS.close}</span> ${t('progress_close_btn')}</button>
      </div>
      <div style="height: 40px;"></div>
    </div>
  `;

  document.querySelector('#mainContent').__notesPageInfo = openNotesPageInfo;

  window.scrollTo(0, 0);
  const field = document.getElementById('globalNotesField');
  if (field) autoResize(field);
}

// Opens the verse modal with "About this page" guidance for the Notes page.
function openNotesPageInfo() {
  const modalRef = document.getElementById('verseModalRef');
  modalRef.textContent  = t('progress_notes_info_title');
  modalRef.style.fontFamily = 'var(--font-stack-heading)';
  document.getElementById('verseModalText').innerHTML = t('progress_notes_info_body');
  document.getElementById('verseModalFooter').innerHTML = '';
  document.getElementById('verseModalOverlay').classList.add('open');
}

// ── RENDER MENU ──────────────────────────────────────────────────────────────
// Rebuilds the chapter menu list with current progress checkmarks.
// A ✓ checkmark is shown if the first question of a chapter has a saved answer.
// NOTE: this check only tests question 0_0; a chapter where Q1 is unanswered
// but others are answered will not show a checkmark. Consider using getChapterProgress().
//
// Multilingual studies: the menu heading shortTitle and each chapter title are
// resolved for the active study language. The Contents overlay carries no lang
// bar — it silently follows window._activeStudyLang.

// Toggles the ✓ checkmark on the Notes item in the chapter menu without
// rebuilding the entire menu. Called from the globalNotesField oninput handler
// in render-progress.js as a cheap alternative to renderMenu().
// Guards against the item being absent (showPageNotes off, or menu not open).
function updateNotesMenuIndicator(hasContent) {
  const item = document.getElementById('menuItemNotes');
  if (!item) return;
  const existing = item.querySelector('.chapter-check');
  if (hasContent && !existing) {
    const span = document.createElement('span');
    span.className = 'chapter-check';
    span.textContent = '✓';
    item.appendChild(span);
  } else if (!hasContent && existing) {
    existing.remove();
  }
}

function renderMenu() {
  const list = document.getElementById('menuList');
  if (!list) return;

  const currentStudyId = window.activeStudyId;

  // Guard: if no study is loaded (e.g. after deleting the active study),
  // render a minimal menu with only a Library link and bail out.
  // This prevents stale chapter items from persisting in the menu after
  // the globals have been cleared by deleteStudy().
  if (!currentStudyId || !window.chapters?.length) {
    const heading = document.getElementById('menuHeading');
    if (heading) heading.textContent = t('main_menu_heading');
    list.innerHTML = `
      <div class="chapter-item" onclick="Router.navigate({ page: 'library' })">
        <span class="chapter-num">${ICONS.library}</span>
        <span class="chapter-name">${t('main_menu_no_study')}</span>
      </div>`;
    return;
  }

  // Resolve active language for multilingual title/chapter display.
  // For mono-lingual studies langMap is {} and resolveMetaField falls through
  // to the unnumbered field, so nothing changes for existing studies.
  const availableLangs = detectAvailableLangs();
  const activeLang     = getActiveLang(availableLangs);
  const langMap        = buildLangMap(window.studyMetadata || {});

  // 1. Dynamic heading: "Chapters of [shortTitle]"
  const heading = document.getElementById('menuHeading');
  if (heading) {
    const meta       = window.titlePageData;
    const shortTitle = meta
      ? ((activeLang ? resolveMetaField(meta, 'shortTitle', activeLang, langMap) : '') || meta.shortTitle || meta.title || '')
      : '';
    heading.textContent = shortTitle ? t('main_menu_heading_with_title', { title: shortTitle }) : t('main_menu_heading');
  }

  let html = `
    <div class="chapter-item" onclick="Router.navigate({ page: 'title' })">
      <span class="chapter-num">✦</span>
      <span class="chapter-name">${t('main_menu_title_page')}</span>
    </div>`;

  // 2. My Progress and How to Use removed from Contents — they live in the top bar

  html += chapters.map((ch, i) => {
    const hasAnswers = Object.keys(localStorage).some(key =>
      key.startsWith(`bsr_${currentStudyId}_ch${ch.chapterNumber}_q`) || key.startsWith(`bsr_${currentStudyId}_ch${ch.chapterNumber}_r`)
    );
    // Resolve the chapter title for the active language.
    // chapterTitle1/2/3 for multilingual, chapterTitle for mono-lingual.
    const chTitle = (activeLang ? resolveMetaField(ch, 'chapterTitle', activeLang, langMap) : '') || ch.chapterTitle || '';
    return `
      <div class="chapter-item" onclick="Router.navigate({ page: 'chapter', idx: ${i} })">
        <span class="chapter-num">${String(ch.chapterNumber).padStart(2,'0')}</span>
        <span class="chapter-name">${chTitle}</span>
        ${hasAnswers ? '<span class="chapter-check">✓</span>' : ''}
      </div>`;
  }).join('');

  if (appSettings.showPageNotes) {
    const hasNotesContent = !!localStorage.getItem(`bsr_${currentStudyId}_global_notes`);
    html += `
    <div class="chapter-item" id="menuItemNotes" onclick="Router.navigate({ page: 'notes' })">
      <span class="chapter-num">✎</span>
      <span class="chapter-name">${t('main_menu_notes')}</span>
      ${hasNotesContent ? '<span class="chapter-check">✓</span>' : ''}
    </div>`;
  }

  if (appSettings.showPageLeaders) {
    html += `
    <div class="chapter-item" onclick="Router.navigate({ page: 'leaders' })">
      <span class="chapter-num">✦</span>
      <span class="chapter-name">${t('main_menu_leaders_notes')}</span>
    </div>`;
  }

  if (window.goDeeperData) {
    const goDeepLabel = resolveMetaField(window.goDeeperData, 'titleMenuHeading', activeLang, langMap)
      || window.goDeeperData.titleMenuHeading || 'Go Deeper';
    html += `
    <div class="chapter-item" onclick="Router.navigate({ page: 'godeeper' })">
      <span class="chapter-num">✦</span>
      <span class="chapter-name">${goDeepLabel}</span>
    </div>`;
  }

  if (appSettings.showPageAbout) {
    html += `
    <div class="chapter-item" onclick="Router.navigate({ page: 'about' })">
      <span class="chapter-num">✦</span>
      <span class="chapter-name">${t('main_menu_about')}</span>
    </div>`;
  }

  list.innerHTML = html;
}

// ── PROGRESS ─────────────────────────────────────────────────────────────────

// Updates the thin gold progress bar in the top nav to reflect what percentage
// of the current chapter's answer fields have non-empty content.
// Called on every keystroke (via the document 'input' listener) and after saving.

function updateProgress() {
  if (isNonChapterPage) return;
  const ch = chapters[currentChapter];

  // ── Text answer fields (questions, reflections) ───────────────────────────
  const allFields = document.querySelectorAll('.answer-field');
  const fields = Array.from(allFields).filter(f => f.dataset.type !== 'notes');

  let filled = fields.filter(f => f.value.trim().length > 0).length;
  let total  = fields.length;

  // ── Likert radio groups ───────────────────────────────────────────────────
  // Each statement is a separate named group: likert_{chNum}_{eid}_{stIdx}
  // One answered statement = one checked radio in that name group.
  // Collect unique group names from all .likert-radio inputs in the page.
  const likertRadios = document.querySelectorAll('.likert-radio');
  if (likertRadios.length) {
    const groups = new Set(Array.from(likertRadios).map(r => r.name));
    groups.forEach(name => {
      total++;
      if (document.querySelector(`.likert-radio[name="${name}"]:checked`)) filled++;
    });
  }

  if (!total) return;

  const pct = Math.round((filled / total) * 100);
  document.getElementById('progressBar').style.width = pct + '%';

  // Trigger celebration toast on first completion of this chapter
  if (pct === 100) showCelebrationToast(ch);
}
