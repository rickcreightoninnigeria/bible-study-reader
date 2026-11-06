// ── SHARE / PRINT ─────────────────────────────────────────────────────────────
// Share and print/export functions: compiling chapter answers into formatted
// text reports, generating print-ready HTML documents, and dispatching to
// the Android share/print bridge or Web Share API.
//
// All answer data is now read from IndexedDB via StudyIDB. Functions that need
// answers from multiple chapters pre-load all records in parallel before
// building output, then read synchronously from those objects.
//
// Dependencies (all available as globals before this file loads):
//   appSettings                    – settings.js
//   chapters, currentChapter       – state.js
//   answerFieldKey, likertFieldKey – state.js
//   isStarredFromCache,
//   getStarredQuestions            – starred.js
//   ICONS                          – icons.js
//   studyText                      – render-chapter-elements.js (runtime call only)
//   StudyIDB                       – idb.js
//   window.activeStudyId           – state.js
//   window.titlePageData           – set by study-loader.js
//   copyToClipboard                – utils.js
//   showToast                      – utils.js
//   t                              – i18n.js
//   Router                         – router.js (runtime call only)

// ── SHARE ANSWERS ─────────────────────────────────────────────────────────────

// Compiles the current chapter's questions and answers into a formatted text
// report and shares it via the native Web Share API, Android bridge, or clipboard.
// Question and reflection answers are read from the DOM (already rendered).
// Notes are read from IDB since they are not a standard .answer-field.
// Rows of a Likert element for share/print, in the reader's language.
// Standard scales give one statement per row. Bipolar scales give a
// "left ↔ right" pair, and because their labels repeat on both sides of the
// midpoint (e.g. Agree … Neutral … Agree) the chosen label is followed by
// the statement it leans toward. `answer` is null when the row is unanswered.
function _likertShareRows(el, record) {
  const isBipolar = el.subtype === 'bipolar';
  const scale = studyText(el, 'scale') || [];
  const rows  = (isBipolar ? studyText(el, 'statementPairs') : studyText(el, 'statements')) || [];
  const n     = Number(el.scaleNumber) || scale.length || 5;  // scaleNumber may be stored as a string
  return rows.map((row, stIdx) => {
    const raw = parseInt((record || {})[likertFieldKey(el.elementId, stIdx)], 10);
    let answer = null;
    if (raw >= 1 && raw <= n) {
      answer = scale[raw - 1] || String(raw);
      if (isBipolar && raw !== (n + 1) / 2) answer += ` (${raw < (n + 1) / 2 ? row.left : row.right})`;
    }
    return { statement: isBipolar ? `${row.left} ↔ ${row.right}` : row, answer };
  });
}

// Plain-text Likert section for the share reports. Returns '' when none of
// the chapter's Likert rows has been answered.
function _likertShareText(ch, record, bold) {
  let text = '';
  (ch.elements || [])
    .filter(e => e.type === 'likertScale' && !e.repeatElement)
    .forEach(el => {
      const rows = _likertShareRows(el, record);
      if (!rows.some(r => r.answer)) return;
      text += bold(t('shareprint_print_likert_heading')) + '\n';
      rows.forEach(r => { text += `• ${r.statement}: ${r.answer || t('shareprint_print_no_answer')}\n`; });
      text += '\n';
    });
  return text;
}

// A starred question carries a star in the shared text (at the start of its
// first line) and in the printed reference bar, so a reader can pick out what
// they marked. `record` is the chapter's answer record from IDB.
const _SHARE_STAR = '⭐ ';
const _starPrefix  = (record, elementId) => isStarredFromCache(record, elementId) ? _SHARE_STAR : '';

// Inline vector star for the print window, which has no icon sizing and may
// lack an emoji font. It takes its colour from the reference bar around it.
const _PRINT_STAR = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 2l2.65 5.86 6.35.93-4.6 4.5 1.09 6.34L12 16.77l-5.49 2.86 1.09-6.34L3 8.79l6.35-.93L12 2z"/></svg>`;
const _printStar = (record, elementId) => isStarredFromCache(record, elementId)
  ? `<span class="q-star" role="img" aria-label="${escapeHtml(t('renderchapter_star_btn_starred'))}">${_PRINT_STAR}</span>`
  : '';

// ── STARRED-ONLY CHOICE AND SUMMARY ──────────────────────────────────────────
// Share and Print each take an optional `scope`: 'all', 'starred', or nothing.
// With nothing, the reader is asked only when something is starred; with no
// stars the buttons work as they always did.

// Resolves to 'all', 'starred', or null when the reader cancels.
function _askStarScope(count, actionLabel) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="starScopeTitle">
        <div class="modal-title" id="starScopeTitle">${t('shareprint_scope_title')}</div>
        <div class="star-scope-options">
          <label class="star-scope-option">
            <input type="radio" name="starScope" value="all" checked>
            <span>${t('shareprint_scope_all')}</span>
          </label>
          <label class="star-scope-option">
            <input type="radio" name="starScope" value="starred">
            <span>${ICONS.starFilled} ${t('shareprint_scope_starred', { count })}</span>
          </label>
        </div>
        <div class="modal-btn-row">
          <button type="button" class="modal-btn-cancel" data-act="cancel">${t('shareprint_scope_cancel')}</button>
          <button type="button" class="modal-btn-confirm" data-act="ok">${actionLabel}</button>
        </div>
      </div>`;
    const onKey = e => { if (e.key === 'Escape') done(null); };
    const done  = value => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(value);
    };
    overlay.addEventListener('click', e => {
      if (e.target === overlay) return done(null);
      const act = e.target.closest('[data-act]');
      if (!act) return;
      done(act.dataset.act === 'ok' ? overlay.querySelector('input[name="starScope"]:checked').value : null);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    overlay.querySelector('input:checked').focus();
  });
}

async function _resolveStarScope(scope, starCount, actionLabel) {
  if (scope === 'all' || scope === 'starred') return scope;
  return starCount > 0 ? _askStarScope(starCount, actionLabel) : 'all';
}

// Starred questions for every chapter, aligned with chapters[]. `records` is
// the array from _loadAllChapterRecords(). The same function drives the
// starred panel, so stale star flags for questions that no longer exist are
// not counted.
const _loadStarredByChapter = records =>
  Promise.all(chapters.map((ch, i) => getStarredQuestions(ch, records[i] || {})));

// "Starred questions" list that opens Share all and Print all, grouped by
// chapter. Each returns '' when nothing is starred.
function _shareStarSummary(starredByChapter, bold) {
  let text = '';
  chapters.forEach((ch, i) => {
    const items = starredByChapter[i] || [];
    if (!items.length) return;
    text += bold(t('shareprint_chapter_heading', { number: ch.chapterNumber, title: ch.chapterTitle })) + '\n';
    items.forEach(({ q }) => { text += `• ${q.ref} — ${q.text}\n`; });
    text += '\n';
  });
  return text ? `${_SHARE_STAR}${bold(t('shareprint_starred_summary_heading'))}\n${text}` : '';
}

function _printStarSummary(starredByChapter) {
  let rows = '';
  chapters.forEach((ch, i) => {
    const items = starredByChapter[i] || [];
    if (!items.length) return;
    rows += `<div class="star-summary-chapter">${t('shareprint_print_chapter_h2', { number: ch.chapterNumber, title: escapeHtml(ch.chapterTitle) })}</div>`;
    items.forEach(({ q }) => { rows += `<div class="star-summary-item"><span class="star-summary-ref">${q.ref}</span> ${q.text}</div>`; });
  });
  return rows
    ? `<h2><span class="h-star">${_PRINT_STAR}</span> ${t('shareprint_starred_summary_heading')}</h2><div class="star-summary">${rows}</div>`
    : '';
}

// scope: 'all' | 'starred' | undefined (ask, when anything is starred).
// Starred only leaves out the notes and Likert rows: it is a list of questions.
async function shareAnswers(scope) {
  const ch      = chapters[currentChapter];
  const studyId = window.activeStudyId;
  const meta    = window.titlePageData || {};
  const fmt     = appSettings.shareFormat === 'plain';
  const bold    = (s) => fmt ? s : `*${s}*`;

  // Read once: star flags are needed by the questions, notes and Likert rows
  // by the end. A failed read still shares the answers, just without stars,
  // notes and Likert rows.
  let record = {};
  try {
    record = await StudyIDB.getChapterAnswers(studyId, ch.chapterNumber);
  } catch (e) {
    console.warn('[shareAnswers] IDB read failed; sharing without stars, notes or Likert rows.', e);
  }

  scope = await _resolveStarScope(scope, (await getStarredQuestions(ch, record)).length, t('renderchapter_share_btn'));
  if (!scope) return;
  const starredOnly = scope === 'starred';
  const wanted = id => !starredOnly || isStarredFromCache(record, id);

  let report = bold(`${meta.title || t('shareprint_default_study_title')}`) + '\n';
  report += bold(t('shareprint_answers_header', { title: ch.chapterTitle, number: ch.chapterNumber })) + '\n';
  if (starredOnly) report += `${_SHARE_STAR}${bold(t('shareprint_starred_summary_heading'))}\n`;
  report += `------------------------------------------\n\n`;

  // Look up each field by its elementId (data-index) rather than by position
  // in the NodeList — a question whose repeatElement reference doesn't
  // resolve is skipped by the chapter renderer (render-chapter.js's element
  // loop), which would silently shift every subsequent positional index and
  // misattribute answers to the wrong question. ch.sections is built
  // independently and always lists every question regardless of whether its
  // field actually rendered.
  ch.sections.forEach(section => {
    section.questions.forEach(q => {
      if (!wanted(q.elementId)) return;
      const field  = document.querySelector(`.answer-field[data-type="q"][data-index="${CSS.escape(q.elementId)}"]`);
      const answer = (field && field.value.trim()) ? field.value.trim() : t('shareprint_no_answer');
      report += `${_starPrefix(record, q.elementId)}${bold(t('shareprint_label_ref'))} ${q.ref}\n`;
      report += `${bold(t('shareprint_label_q'))} ${q.text}\n`;
      report += `${bold(t('shareprint_label_a'))} ${answer}\n\n`;
    });
  });

  if (ch.reflection && ch.reflection.length > 0) {
    // ch.reflection is an array of question-text strings built positionally
    // from the same filtered element list starred.js's getStarredQuestions()
    // uses — reconstruct that list here to resolve each entry's elementId.
    const reflEls = (ch.elements || []).filter(
      e => e.type === 'question' && e.subtype === 'reflection' && !e.repeatElement
    );
    const items = ch.reflection
      .map((qText, rIdx) => ({ qText, eid: reflEls[rIdx] ? reflEls[rIdx].elementId : null }))
      .filter(({ eid }) => !starredOnly || (eid && wanted(eid)));
    if (items.length) {
      report += bold(t('shareprint_reflection_heading')) + '\n';
      report += `------------------------------------------\n`;
      items.forEach(({ qText, eid }) => {
        const field  = eid ? document.querySelector(`.answer-field[data-type="r"][data-index="${CSS.escape(eid)}"]`) : null;
        const answer = (field && field.value.trim()) ? field.value.trim() : t('shareprint_no_answer');
        report += `${_starPrefix(record, eid)}${bold(t('shareprint_label_q'))} ${qText}\n`;
        report += `${bold(t('shareprint_label_a'))} ${answer}\n\n`;
      });
    }
  }

  // Notes — read from the IDB record since the notes field is not a standard
  // answer-field in the DOM for share purposes (it may not be visible at share time).
  if (!starredOnly) {
    const notesVal = (record[answerFieldKey('notes', 0)] || '').trim();
    if (notesVal) {
      report += bold(t('shareprint_notes_heading')) + '\n';
      report += `------------------------------------------\n`;
      report += notesVal + '\n\n';
    }
    report += _likertShareText(ch, record, bold);
  }

  if (window.Android && window.Android.share) {
    window.Android.share(report);
  } else if (navigator.share) {
    navigator.share({ title: t('shareprint_share_chapter_title', { number: ch.chapterNumber }), text: report });
  } else {
    copyToClipboard(report);
    showToast({ message: t('shareprint_copied_to_clipboard'), isManual: true });
  }
}

// ── EXPORT ALL ANSWERS ────────────────────────────────────────────────────────

// Compiles answered questions from all chapters of the current study into a
// single export document and shares/copies it. Chapters with no answers are
// silently skipped. Pre-loads all chapter answer records from IDB in parallel
// before building the report.
// scope: 'all' | 'starred' | undefined (ask, when anything is starred).
// 'all' lists answered questions plus any starred ones, and opens with a list
// of the starred questions; 'starred' lists only the starred ones.
async function exportStudyAnswers(scope) {
  const studyId = window.activeStudyId;
  const meta    = window.titlePageData || {};
  const fmt     = appSettings.shareFormat === 'plain';
  const bold    = (s) => fmt ? s : `*${s}*`;

  // Pre-load all chapter records in parallel.
  const records = await _loadAllChapterRecords(studyId);
  const starredByChapter = await _loadStarredByChapter(records);
  const starTotal = starredByChapter.reduce((n, list) => n + list.length, 0);
  scope = await _resolveStarScope(scope, starTotal, t('renderchapter_share_btn'));
  if (!scope) return;
  const starredOnly = scope === 'starred';

  // Also load global notes.
  let globalNotes = '';
  try {
    globalNotes = (await StudyIDB.getAnswerRaw(globalNotesIDBKey(studyId))) || '';
  } catch (e) { /* no global notes */ }

  let report = bold(`${meta.title || t('shareprint_default_study_title')}`) + '\n';
  report += bold(t('shareprint_complete_answers_heading')) + '\n';
  report += `==========================================\n\n`;
  if (!starredOnly) report += _shareStarSummary(starredByChapter, bold);

  let hasAnyAnswers = false;

  chapters.forEach((ch, i) => {
    const record = records[i] || {};
    let chapterReport    = '';
    let chapterHasAnswers = false;

    chapterReport += bold(t('shareprint_chapter_heading', { number: ch.chapterNumber, title: ch.chapterTitle })) + '\n';
    chapterReport += `------------------------------------------\n\n`;

    // Question answers
    ch.sections.forEach(section => {
      section.questions.forEach(q => {
        const answer  = (record[answerFieldKey('q', q.elementId)] || '').trim();
        const starred = isStarredFromCache(record, q.elementId);
        // A starred question is listed even when blank: the reader marked it.
        if (starredOnly ? starred : (answer || starred)) {
          chapterHasAnswers = true;
          chapterReport += `${_starPrefix(record, q.elementId)}${bold(t('shareprint_label_ref'))} ${q.ref}\n`;
          chapterReport += `${bold(t('shareprint_label_q'))} ${q.text}\n`;
          chapterReport += `${bold(t('shareprint_label_a'))} ${answer || t('shareprint_no_answer')}\n\n`;
        }
      });
    });

    // Reflection answers
    {
      let reflectionReport = '';
      let hasReflections   = false;
      (ch.elements || [])
        .filter(e => e.type === 'question' && e.subtype === 'reflection' && !e.repeatElement)
        .forEach(el => {
          const answer = (record[answerFieldKey('r', el.elementId)] || '').trim();
          const starred = isStarredFromCache(record, el.elementId);
          if (starredOnly ? starred : (answer || starred)) {
            hasReflections    = true;
            chapterHasAnswers = true;
            const qText = studyText(el, 'question');
            reflectionReport += `${_starPrefix(record, el.elementId)}${bold(t('shareprint_label_q'))} ${qText}\n`;
            reflectionReport += `${bold(t('shareprint_label_a'))} ${answer || t('shareprint_no_answer')}\n\n`;
          }
        });
      if (hasReflections) {
        chapterReport += bold(t('shareprint_reflection_short_heading')) + '\n\n';
        chapterReport += reflectionReport;
      }
    }

    // Notes
    const notesAnswer = starredOnly ? '' : (record[answerFieldKey('notes', 0)] || '').trim();
    if (notesAnswer) {
      chapterHasAnswers = true;
      chapterReport += bold(t('shareprint_notes_heading')) + '\n';
      chapterReport += notesAnswer + '\n\n';
    }

    // Likert scale responses (standard and bipolar)
    const likertText = starredOnly ? '' : _likertShareText(ch, record, bold);
    if (likertText) {
      chapterHasAnswers = true;
      chapterReport += likertText;
    }

    if (chapterHasAnswers) {
      report += chapterReport;
      hasAnyAnswers = true;
    }
  });

  if (!hasAnyAnswers) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card-centered">
        <div class="modal-icon-lg">📭</div>
        <div class="modal-title">${t('shareprint_no_answers_title')}</div>
        <div class="modal-body">
          ${t('shareprint_no_answers_body')}
        </div>
        <button onclick="this.closest('div').parentElement.remove()" class="modal-btn-ok">${t('shareprint_no_answers_ok')}</button>
      </div>
    `;
    document.body.appendChild(overlay);
    return;
  }

  const date = new Date().toLocaleDateString(resolveLanguage(), {
    day: 'numeric', month: 'long', year: 'numeric'
  });
  report += `==========================================\n`;
  report += t('shareprint_export_footer', { date, title: meta.title }) + '\n';

  if (window.Android && window.Android.share) {
    window.Android.share(report);
  } else if (navigator.share) {
    navigator.share({ title: t('shareprint_share_all_title', { title: meta.title || t('shareprint_default_study_title') }), text: report });
  } else {
    copyToClipboard(report);
    showToast({ message: t('shareprint_copied_to_clipboard'), isManual: true });
  }
}

// ── PRINT / EXPORT TO PDF ─────────────────────────────────────────────────────

// Study text reaches the print window as raw HTML, so its markers must be
// resolved here: [[sc:Lord]] becomes the small-capitals span (styled by the
// .divine-name rule in buildPrintHead), and [[icon:…]] is dropped because the
// sentence around it names the button and the print window has no icon sizing.
const _printMarkers = html => expandInlineMarkers(html, { icons: false });

// Fallback only if --divine-name-tracking (02-variables.css) cannot be read.
const _DIVINE_NAME_TRACKING_FALLBACK = '0.04em';

function buildPrintHead(title) {
  const bodyFontStack    = appSettings.useSansSerif
    ? "'Inter', 'Helvetica Neue', Arial, sans-serif"
    : "'Source Serif 4', Georgia, 'Times New Roman', serif";
  const headingFontStack = "'Playfair Display', Georgia, 'Times New Roman', serif";
  const divineNameTracking = getComputedStyle(document.documentElement)
    .getPropertyValue('--divine-name-tracking').trim() || _DIVINE_NAME_TRACKING_FALLBACK;

  const fontFaceCSS = `
    @font-face { font-family: 'Playfair Display'; src: url('fonts/PlayfairDisplay-Regular.ttf') format('truetype'); font-weight: 400; font-style: normal; font-display: block; }
    @font-face { font-family: 'Playfair Display'; src: url('fonts/PlayfairDisplay-Italic.ttf') format('truetype'); font-weight: 400; font-style: italic; font-display: block; }
    @font-face { font-family: 'Playfair Display'; src: url('fonts/PlayfairDisplay-SemiBold.ttf') format('truetype'); font-weight: 600; font-style: normal; font-display: block; }
    @font-face { font-family: 'Source Serif 4'; src: url('fonts/SourceSerif4-Regular.ttf') format('truetype'); font-weight: 400; font-style: normal; font-display: block; }
    @font-face { font-family: 'Source Serif 4'; src: url('fonts/SourceSerif4-Italic.ttf') format('truetype'); font-weight: 400; font-style: italic; font-display: block; }
    @font-face { font-family: 'Inter'; src: url('fonts/Inter-Regular.ttf') format('truetype'); font-weight: 400; font-style: normal; font-display: block; }
    @font-face { font-family: 'Inter'; src: url('fonts/Inter-Italic.ttf') format('truetype'); font-weight: 400; font-style: normal; font-display: block; }
    @font-face { font-family: 'Inter'; src: url('fonts/Inter-Medium.ttf') format('truetype'); font-weight: 500; font-style: normal; font-display: block; }`;

  return `<head>
<meta charset="UTF-8">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Source+Serif+4:opsz,wght@8..60,400&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>
  ${fontFaceCSS}

  body { font-family: ${bodyFontStack}; font-size: 11pt; color: black; margin: 0; padding: 0; }
  h1 { font-family: ${headingFontStack}; font-size: 20pt; font-style: italic; font-weight: 400; margin: 0 0 8pt 0; color: #1c1710; }
  h2 { font-family: ${headingFontStack}; font-size: 14pt; font-style: italic; font-weight: 400; margin: 24pt 0 8pt 0; color: #1c1710; border-bottom: 0.5pt solid #c8bca8; padding-bottom: 4pt; page-break-after: avoid; }
  .cover { text-align: center; padding: 40pt 0 32pt; border-bottom: 1pt solid #c8bca8; margin-bottom: 24pt; }
  .eyebrow { font-size: 8pt; letter-spacing: 0.14em; text-transform: uppercase; color: #8c6420; margin-bottom: 8pt; }
  .chapter-header { margin-bottom: 16pt; }
  .chapter-eyebrow { font-size: 8pt; letter-spacing: 0.14em; text-transform: uppercase; color: #8c6420; margin-bottom: 4pt; }
  .intro { font-style: italic; color: #4a3f30; margin-bottom: 16pt; padding: 8pt 12pt; border-left: 2pt solid #c8bca8; }
  .bridge { color: #4a3f30; margin: 12pt 0; font-size: 10pt; }
  .closing { font-style: italic; color: #4a3f30; margin: 16pt 0; padding: 8pt 12pt; border-left: 2pt solid #c8bca8; }
  .question-block { border: 0.5pt solid #ddd; margin: 8pt 0; page-break-inside: avoid; }
  .question-ref { background: #2c2416; color: #d4a843; padding: 4pt 8pt; font-size: 8pt; letter-spacing: 0.1em; text-transform: uppercase; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .scope-note { font-size: 8pt; letter-spacing: 0.14em; text-transform: uppercase; color: #8c6420; margin: 0 0 12pt 0; }
  .h-star { color: #d4a843; margin-right: 2pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .h-star svg { vertical-align: -1pt; }
  .star-summary { margin: 0 0 16pt 0; }
  .star-summary-chapter { font-size: 8pt; letter-spacing: 0.12em; text-transform: uppercase; color: #666; margin: 10pt 0 4pt 0; }
  .star-summary-item { font-size: 10pt; margin: 0 0 3pt 0; }
  .star-summary-ref { font-size: 8pt; letter-spacing: 0.08em; text-transform: uppercase; color: #8c6420; margin-right: 4pt; }
  .q-star { float: right; line-height: 1; }
  .q-star svg { display: block; }
  .question-text { padding: 6pt 8pt 3pt; font-size: 10pt; }
  .answer { padding: 6pt 8pt; font-size: 10pt; border-top: 0.5pt solid #ddd; background: #f9f9f9; min-height: 32pt; white-space: pre-wrap; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .no-answer { color: #aaa; font-style: italic; }
  .divine-name { font-variant: small-caps; letter-spacing: ${divineNameTracking}; }
  .reflection-heading { font-family: ${headingFontStack}; background: #8b3a2a; color: white; padding: 5pt 8pt; font-size: 10pt; font-style: italic; margin: 16pt 0 0 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; page-break-after: avoid; }
  .notes-heading { font-size: 8pt; letter-spacing: 0.12em; text-transform: uppercase; color: #666; margin: 16pt 0 4pt 0; }
  .likert-block { border: 0.5pt solid #ccc; margin: 8pt 0; page-break-inside: avoid; }
  .likert-block-title { background: #2c2416; color: #d4a843; padding: 4pt 8pt; font-size: 8pt; letter-spacing: 0.1em; text-transform: uppercase; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .likert-block-row { display: flex; justify-content: space-between; align-items: baseline; padding: 4pt 8pt; font-size: 10pt; border-top: 0.5pt solid #eee; gap: 12pt; }
  .likert-block-row:first-of-type { border-top: none; }
  .likert-block-statement { flex: 1; color: black; }
  .likert-block-response { flex-shrink: 0; font-style: italic; color: #444; text-align: right; }
  .likert-block-response.no-answer { color: #aaa; }
  @page { margin: 1.5cm 1.8cm; }
</style>
</head>`;
}

// ── SHARED IDB HELPERS ────────────────────────────────────────────────────────

// Pre-loads chapter answer records for all chapters of the given study from IDB
// in parallel. Returns an array aligned with the chapters[] array — records[i]
// corresponds to chapters[i]. Failures for individual chapters resolve to {}.
async function _loadAllChapterRecords(studyId) {
  return Promise.all(
    chapters.map(ch =>
      StudyIDB.getChapterAnswers(studyId, ch.chapterNumber).catch(() => ({}))
    )
  );
}

// ── BUILD CHAPTER BODY ────────────────────────────────────────────────────────

// Returns the inner body HTML for a single chapter: intro, sections (bridge +
// questions with saved answers), closing passage, reflection questions, and notes.
// record – the pre-loaded IDB answer object for this chapter (from _loadAllChapterRecords).
// starredOnly – true keeps only the starred questions (no intro, bridges,
//   closing, Likert rows or notes).
// Does NOT include a chapter header — callers add their own wrapper.
function buildChapterBody(ch, record, starredOnly) {
  record = record || {};
  let body = '';
  const wanted = id => !starredOnly || isStarredFromCache(record, id);

  // Intro
  if (ch.intro && !starredOnly) {
    body += `<div class="intro"><p>${_printMarkers(ch.intro.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>'))}</p></div>`;
  }

  // Sections: bridge text then questions with saved answers
  ch.sections.forEach(sec => {
    if (sec.bridge && !starredOnly) {
      body += `<div class="bridge">${_printMarkers(sec.bridge.replace(/<b>/g, '<strong>').replace(/<\/b>/g, '</strong>'))}</div>`;
    }
    sec.questions.forEach(q => {
      if (!wanted(q.elementId)) return;
      const answer = (record[answerFieldKey('q', q.elementId)] || '').trim();
      body += `<div class="question-block">
        <div class="question-ref">${q.ref}${_printStar(record, q.elementId)}</div>
        <div class="question-text">${q.text}</div>
        <div class="answer ${answer ? '' : 'no-answer'}">${answer ? escapeHtml(answer) : t('shareprint_print_no_answer')}</div>
      </div>`;
    });
  });

  // Closing passage
  if (ch.closing && !starredOnly) {
    body += `<div class="closing"><p>${_printMarkers(ch.closing.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>'))}</p></div>`;
  }

  // Likert scale responses
  (ch.elements || [])
    .filter(e => e.type === 'likertScale' && !e.repeatElement && !starredOnly)
    .forEach(el => {
      const rows = _likertShareRows(el, record);
      if (!rows.length) return;

      const rowsHtml = rows.map(({ statement, answer }) => `<div class="likert-block-row">
          <div class="likert-block-statement">${statement}</div>
          <div class="likert-block-response${answer ? '' : ' no-answer'}">${answer || t('shareprint_print_no_answer')}</div>
        </div>`).join('');

      body += `<div class="likert-block">
        <div class="likert-block-title">${t('shareprint_print_likert_heading')}</div>
        ${rowsHtml}
      </div>`;
    });

  // Reflection questions with saved answers
  const reflEls = (ch.elements || []).filter(e => e.type === 'question' && e.subtype === 'reflection' && !e.repeatElement);
  if (ch.reflection && ch.reflection.length > 0 && reflEls.some(el => wanted(el.elementId))) {
    body += `<div class="reflection-heading">${t('shareprint_print_reflection_heading')}</div>`;
    reflEls
      .forEach((el, ri) => {
        if (!wanted(el.elementId)) return;
        const answer = (record[answerFieldKey('r', el.elementId)] || '').trim();
        const qText  = studyText(el, 'question');
        body += `<div class="question-block">
          <div class="question-ref">${t('shareprint_print_reflection_label', { number: ri + 1 })}${_printStar(record, el.elementId)}</div>
          <div class="question-text">${qText}</div>
          <div class="answer ${answer ? '' : 'no-answer'}">${answer ? escapeHtml(answer) : t('shareprint_print_no_answer')}</div>
        </div>`;
      });
  }

  // Notes — only included if non-empty
  const notesVal = starredOnly ? '' : (record[answerFieldKey('notes', 0)] || '').trim();
  if (notesVal) {
    body += `<div class="notes-heading">${t('shareprint_print_notes_heading')}</div>
      <div class="answer">${escapeHtml(notesVal)}</div>`;
  }

  return body;
}

// Prints `html` through the Android bridge, or with the browser's own print
// dialog when there is no bridge (the web build). Android without a print
// bridge shares fallbackMsg instead.
function dispatchPrint(html, fallbackMsg) {
  if (window.Android && window.Android.printContent) {
    window.Android.printContent(html);
  } else if (window.Android && window.Android.share) {
    window.Android.share(fallbackMsg);
  } else {
    _printInFrame(html);
  }
}

// Browser print from a hidden iframe. A new window would be caught by popup
// blockers (printing starts after an async read and sometimes a chooser card),
// and printing the app's own page would print the app. The frame is sandboxed
// without scripts, so nothing in the document can run; allow-modals is what
// lets print() open the dialog and allow-same-origin lets us call it. Printing
// waits for fonts (the document uses font-display: block, so it would print
// blank text otherwise) but not for long. The frame is removed after printing,
// or after a minute where `afterprint` never fires.
const _PRINT_FONT_WAIT_MS  = 3000;
const _PRINT_FRAME_TTL_MS  = 60000;

function _printInFrame(html) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-modals allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed; right:0; bottom:0; width:0; height:0; border:0; visibility:hidden;';
  const cleanup = () => frame.remove();
  frame.addEventListener('load', () => {
    const win = frame.contentWindow;
    if (!win) return cleanup();
    win.addEventListener('afterprint', cleanup);
    const fontsReady = (win.document.fonts && win.document.fonts.ready) || Promise.resolve();
    Promise.race([fontsReady, new Promise(r => setTimeout(r, _PRINT_FONT_WAIT_MS))]).then(() => {
      win.focus();
      win.print();
      setTimeout(cleanup, _PRINT_FRAME_TTL_MS);
    });
  });
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

// ── PRINT FUNCTIONS ───────────────────────────────────────────────────────────

// Prints the current chapter. Async because it must load the chapter record
// from IDB before calling buildChapterBody().
// scope: 'all' | 'starred' | undefined (ask, when anything is starred).
async function printChapter(scope) {
  const ch      = chapters[currentChapter];
  const studyId = window.activeStudyId;
  const meta    = window.titlePageData || {};

  let record = {};
  try {
    record = await StudyIDB.getChapterAnswers(studyId, ch.chapterNumber);
  } catch (e) {
    console.warn('[printChapter] IDB read failed; printing with empty answers.', e);
  }

  scope = await _resolveStarScope(scope, (await getStarredQuestions(ch, record)).length, t('renderchapter_print_btn'));
  if (!scope) return;
  const starredOnly = scope === 'starred';

  const chapterHeader = `<div class="chapter-header">
  <div class="chapter-eyebrow">${t('shareprint_print_chapter_eyebrow', { number: ch.chapterNumber, total: chapters.length, studyTitle: escapeHtml(meta.title) })}</div>
  <h1>${escapeHtml(ch.chapterTitle)}</h1>
  ${starredOnly ? `<div class="scope-note">${t('shareprint_starred_summary_heading')}</div>` : ''}
</div>`;

  const docTitle = t('shareprint_print_doc_title_chapter', { studyTitle: escapeHtml(meta.title), number: ch.chapterNumber, chapterTitle: escapeHtml(ch.chapterTitle) });

  const html = `<!DOCTYPE html>
<html lang="en">
${buildPrintHead(docTitle)}
<body>
${chapterHeader}
${buildChapterBody(ch, record, starredOnly)}
</body></html>`;

  dispatchPrint(html, t('shareprint_print_fallback_chapter', { studyTitle: escapeHtml(meta.title), number: ch.chapterNumber, chapterTitle: escapeHtml(ch.chapterTitle) }));
}

// Prints all chapters as a single document. Pre-loads all chapter records and
// global notes from IDB before building HTML.
// scope: 'all' | 'starred' | undefined (ask, when anything is starred).
// 'all' opens with a list of the starred questions; 'starred' prints only them.
async function printAllChapters(scope) {
  const studyId     = window.activeStudyId;
  const meta        = window.titlePageData || {};
  const datePrinted = new Date().toLocaleDateString(resolveLanguage(), {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  // Pre-load all chapter records and global notes in parallel.
  const [records, globalNotes] = await Promise.all([
    _loadAllChapterRecords(studyId),
    StudyIDB.getAnswerRaw(globalNotesIDBKey(studyId)).catch(() => ''),
  ]);
  const starredByChapter = await _loadStarredByChapter(records);
  const starTotal = starredByChapter.reduce((n, list) => n + list.length, 0);
  scope = await _resolveStarScope(scope, starTotal, t('renderchapter_print_btn'));
  if (!scope) return;
  const starredOnly = scope === 'starred';

  const cover = `<div class="cover">
  <div class="eyebrow">${t('shareprint_print_cover_eyebrow')}</div>
  <h1>${escapeHtml(meta.title)}</h1>
  <div style="font-size:9pt; color:#666; margin-top:6pt;">${t('shareprint_print_cover_date', { date: datePrinted })}</div>
</div>`;

  let chaptersHTML = starredOnly
    ? `<div class="scope-note">${t('shareprint_starred_summary_heading')}</div>`
    : _printStarSummary(starredByChapter);
  chapters.forEach((ch, i) => {
    const record = records[i] || {};

    // Skip chapters that have no saved content. A starred question counts,
    // answered or not.
    const hasContent = starredByChapter[i].length > 0 || (!starredOnly && Object.entries(record).some(([field, val]) =>
      (field.startsWith('q_') || field.startsWith('r_') || field === answerFieldKey('notes', 0)) && (val || '').trim()
    ));
    if (!hasContent) return;

    chaptersHTML += `<h2>${t('shareprint_print_chapter_h2', { number: ch.chapterNumber, title: escapeHtml(ch.chapterTitle) })}</h2>
${buildChapterBody(ch, record, starredOnly)}`;
  });

  // Notes & Comments page
  if (!starredOnly && appSettings.showPageNotes && globalNotes && globalNotes.trim()) {
    chaptersHTML += `
<h2>${t('shareprint_print_notes_page_heading')}</h2>
<div class="answer" style="min-height:0;">${escapeHtml(globalNotes.trim())}</div>`;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
${buildPrintHead(t('shareprint_print_doc_title_all', { studyTitle: escapeHtml(meta.title) }))}
<body>
${cover}
${chaptersHTML}
</body></html>`;

  dispatchPrint(html, t('shareprint_print_fallback_all'));
}

// ── BLANK STUDY PRINT ─────────────────────────────────────────────────────────
// No answer reads needed — these functions are unchanged.

function buildBlankChapterBody(ch) {
  let body = '';

  if (ch.intro) {
    body += `<div class="intro"><p>${_printMarkers(ch.intro.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>'))}</p></div>`;
  }

  ch.sections.forEach(sec => {
    if (sec.bridge) {
      body += `<div class="bridge">${_printMarkers(sec.bridge.replace(/<b>/g, '<strong>').replace(/<\/b>/g, '</strong>'))}</div>`;
    }
    sec.questions.forEach(q => {
      body += `<div class="question-block">
        <div class="question-ref">${q.ref}</div>
        <div class="question-text">${q.text}</div>
        <div class="answer blank-answer"></div>
      </div>`;
    });
  });

  if (ch.closing) {
    body += `<div class="closing"><p>${_printMarkers(ch.closing.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>'))}</p></div>`;
  }

  (ch.elements || [])
    .filter(e => e.type === 'likertScale' && !e.repeatElement)
    .forEach(el => {
      const rows = _likertShareRows(el, null);
      if (!rows.length) return;
      const rowsHtml = rows.map(({ statement }) => `<div class="likert-block-row">
          <div class="likert-block-statement">${statement}</div>
          <div class="likert-block-response blank-answer" style="min-width:60pt;"></div>
        </div>`).join('');
      body += `<div class="likert-block">
        <div class="likert-block-title">${t('shareprint_print_likert_heading')}</div>
        ${rowsHtml}
      </div>`;
    });

  if (ch.reflection && ch.reflection.length > 0) {
    body += `<div class="reflection-heading">${t('shareprint_print_reflection_heading')}</div>`;
    (ch.elements || [])
      .filter(e => e.type === 'question' && e.subtype === 'reflection' && !e.repeatElement)
      .forEach((el, ri) => {
        const qText = studyText(el, 'question');
        body += `<div class="question-block">
          <div class="question-ref">${t('shareprint_print_reflection_label', { number: ri + 1 })}</div>
          <div class="question-text">${qText}</div>
          <div class="answer blank-answer"></div>
        </div>`;
      });
  }

  return body;
}

function printBlankStudy() {
  const meta = window.titlePageData || {};

  const coverImageHtml = meta.image?.src
    ? `<img src="${escapeHtml(meta.image.src)}" alt="${escapeHtml(meta.image?.alt || '')}"
           style="max-width:100%; max-height:160pt; object-fit:cover; display:block; margin:0 auto 20pt;"
           onerror="this.style.display='none'" />`
    : meta.image?.fallbackEmoji
      ? `<div style="font-size:48pt; margin-bottom:16pt;">${meta.image.fallbackEmoji}</div>`
      : '';

  const authorLabel = meta.authorLabel || '';
  const authorName  = meta.authorName  || meta.author || '';
  const version     = meta.version     || '';
  const subtitle    = meta.subtitle    || '';
  const description = meta.description || '';

  const cover = `<div class="cover" style="page-break-after:always;">
  ${coverImageHtml}
  <div class="eyebrow">${t('shareprint_print_cover_eyebrow')}</div>
  <h1>${escapeHtml(meta.title || '')}</h1>
  ${subtitle    ? `<div style="font-size:13pt; color:#4a3f30; margin-top:4pt; font-style:italic;">${escapeHtml(subtitle)}</div>` : ''}
  ${description ? `<div style="font-size:10pt; color:#666; margin-top:12pt; max-width:340pt; margin-left:auto; margin-right:auto; line-height:1.6;">${escapeHtml(description)}</div>` : ''}
  ${authorLabel ? `<div style="font-size:8pt; letter-spacing:0.1em; text-transform:uppercase; color:#8c6420; margin-top:20pt;">${escapeHtml(authorLabel)}</div>` : ''}
  ${authorName  ? `<div style="font-size:12pt; color:#1c1710; margin-top:4pt;">${escapeHtml(authorName)}</div>` : ''}
  ${version     ? `<div style="font-size:8pt; color:#999; margin-top:8pt;">${escapeHtml(version)}</div>` : ''}
</div>`;

  let chaptersHTML = '';
  chapters.forEach(ch => {
    chaptersHTML += `<h2>${t('shareprint_print_chapter_h2', { number: ch.chapterNumber, title: escapeHtml(ch.chapterTitle) })}</h2>
${buildBlankChapterBody(ch)}`;
  });

  const docTitle = `${escapeHtml(meta.title || t('shareprint_default_study_title'))} — ${t('shareprint_blank_doc_title_suffix')}`;

  const html = `<!DOCTYPE html>
<html lang="en">
${buildPrintHead(docTitle)}
<style>
  .blank-answer { background: #fff !important; min-height: 48pt !important; border-top: 0.5pt solid #ddd; }
  .likert-block-response.blank-answer { min-height: 0 !important; border-top: none; border-bottom: 0.5pt solid #bbb; padding-bottom: 2pt; }
</style>
<body>
${cover}
${chaptersHTML}
</body></html>`;

  dispatchPrint(html, `${escapeHtml(meta.title || t('shareprint_default_study_title'))} — ${t('shareprint_blank_doc_title_suffix')}`);
}
