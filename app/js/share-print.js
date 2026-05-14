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
async function shareAnswers() {
  const ch      = chapters[currentChapter];
  const studyId = window.activeStudyId;
  const meta    = window.titlePageData || {};
  const fmt     = appSettings.shareFormat === 'plain';
  const bold    = (s) => fmt ? s : `*${s}*`;

  let report = bold(`${meta.title || t('shareprint_default_study_title')}`) + '\n';
  report += bold(t('shareprint_answers_header', { title: ch.chapterTitle, number: ch.chapterNumber })) + '\n';
  report += `------------------------------------------\n\n`;

  const qFields = document.querySelectorAll('.answer-field[data-type="q"]');
  let qIndex = 0;
  ch.sections.forEach(section => {
    section.questions.forEach(q => {
      const field  = qFields[qIndex];
      const answer = (field && field.value.trim()) ? field.value.trim() : t('shareprint_no_answer');
      report += `${bold(t('shareprint_label_ref'))} ${q.ref}\n`;
      report += `${bold(t('shareprint_label_q'))} ${q.text}\n`;
      report += `${bold(t('shareprint_label_a'))} ${answer}\n\n`;
      qIndex++;
    });
  });

  if (ch.reflection && ch.reflection.length > 0) {
    report += bold(t('shareprint_reflection_heading')) + '\n';
    report += `------------------------------------------\n`;
    const rFields = document.querySelectorAll('.answer-field[data-type="r"]');
    ch.reflection.forEach((qText, rIdx) => {
      const field  = rFields[rIdx];
      const answer = (field && field.value.trim()) ? field.value.trim() : t('shareprint_no_answer');
      report += `${bold(t('shareprint_label_q'))} ${qText}\n`;
      report += `${bold(t('shareprint_label_a'))} ${answer}\n\n`;
    });
  }

  // Notes — read from IDB since the notes field is not a standard answer-field
  // in the DOM for share purposes (it may not be visible at share time).
  try {
    const record  = await StudyIDB.getChapterAnswers(studyId, ch.chapterNumber);
    const notesVal = (record[answerFieldKey('notes', 0)] || '').trim();
    if (notesVal) {
      report += bold(t('shareprint_notes_heading')) + '\n';
      report += `------------------------------------------\n`;
      report += notesVal + '\n\n';
    }
  } catch (e) {
    console.warn('[shareAnswers] IDB read failed for notes.', e);
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
async function exportStudyAnswers() {
  const studyId = window.activeStudyId;
  const meta    = window.titlePageData || {};
  const fmt     = appSettings.shareFormat === 'plain';
  const bold    = (s) => fmt ? s : `*${s}*`;

  // Pre-load all chapter records in parallel.
  const records = await _loadAllChapterRecords(studyId);

  // Also load global notes.
  let globalNotes = '';
  try {
    globalNotes = (await StudyIDB.getAnswerRaw(`${studyId}_global_notes`)) || '';
  } catch (e) { /* no global notes */ }

  let report = bold(`${meta.title || t('shareprint_default_study_title')}`) + '\n';
  report += bold(t('shareprint_complete_answers_heading')) + '\n';
  report += `==========================================\n\n`;

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
        const answer = (record[answerFieldKey('q', q.elementId)] || '').trim();
        if (answer) {
          chapterHasAnswers = true;
          chapterReport += `${bold(t('shareprint_label_ref'))} ${q.ref}\n`;
          chapterReport += `${bold(t('shareprint_label_q'))} ${q.text}\n`;
          chapterReport += `${bold(t('shareprint_label_a'))} ${answer}\n\n`;
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
          if (answer) {
            hasReflections    = true;
            chapterHasAnswers = true;
            const qText = el.question || el.question1 || '';
            reflectionReport += `${bold(t('shareprint_label_q'))} ${qText}\n`;
            reflectionReport += `${bold(t('shareprint_label_a'))} ${answer}\n\n`;
          }
        });
      if (hasReflections) {
        chapterReport += bold(t('shareprint_reflection_short_heading')) + '\n\n';
        chapterReport += reflectionReport;
      }
    }

    // Notes
    const notesAnswer = (record[answerFieldKey('notes', 0)] || '').trim();
    if (notesAnswer) {
      chapterHasAnswers = true;
      chapterReport += bold(t('shareprint_notes_heading')) + '\n';
      chapterReport += notesAnswer + '\n\n';
    }

    // Likert scale responses
    (ch.elements || [])
      .filter(e => e.type === 'likertScale' && !e.repeatElement && e.subtype !== 'bipolar')
      .forEach(el => {
        const scale      = el.scale      || [];
        const statements = el.statements || [];
        if (!statements.length) return;

        let likertReport = '';
        statements.forEach((stmt, stIdx) => {
          const raw      = record[likertFieldKey(el.elementId, stIdx)];
          const labelIdx = raw ? (parseInt(raw, 10) - 1) : -1;
          const label    = (labelIdx >= 0 && labelIdx < scale.length) ? scale[labelIdx] : t('shareprint_print_no_answer');
          likertReport += `• ${stmt}: ${label}\n`;
        });

        chapterHasAnswers = true;
        chapterReport += bold(t('shareprint_print_likert_heading')) + '\n';
        chapterReport += likertReport + '\n';
      });

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

function buildPrintHead(title) {
  const bodyFontStack    = appSettings.useSansSerif
    ? "'Inter', 'Helvetica Neue', Arial, sans-serif"
    : "'Source Serif 4', Georgia, 'Times New Roman', serif";
  const headingFontStack = "'Playfair Display', Georgia, 'Times New Roman', serif";

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
  .question-text { padding: 6pt 8pt 3pt; font-size: 10pt; }
  .answer { padding: 6pt 8pt; font-size: 10pt; border-top: 0.5pt solid #ddd; background: #f9f9f9; min-height: 32pt; white-space: pre-wrap; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .no-answer { color: #aaa; font-style: italic; }
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
// Does NOT include a chapter header — callers add their own wrapper.
function buildChapterBody(ch, record) {
  record = record || {};
  let body = '';

  // Intro
  if (ch.intro) {
    body += `<div class="intro"><p>${ch.intro.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p></div>`;
  }

  // Sections: bridge text then questions with saved answers
  ch.sections.forEach(sec => {
    if (sec.bridge) {
      body += `<div class="bridge">${sec.bridge.replace(/<b>/g, '<strong>').replace(/<\/b>/g, '</strong>')}</div>`;
    }
    sec.questions.forEach(q => {
      const answer = (record[answerFieldKey('q', q.elementId)] || '').trim();
      body += `<div class="question-block">
        <div class="question-ref">${q.ref}</div>
        <div class="question-text">${q.text}</div>
        <div class="answer ${answer ? '' : 'no-answer'}">${answer ? escapeHtml(answer) : t('shareprint_print_no_answer')}</div>
      </div>`;
    });
  });

  // Closing passage
  if (ch.closing) {
    body += `<div class="closing"><p>${ch.closing.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p></div>`;
  }

  // Likert scale responses
  (ch.elements || [])
    .filter(e => e.type === 'likertScale' && !e.repeatElement && e.subtype !== 'bipolar')
    .forEach(el => {
      const scale      = el.scale      || [];
      const statements = el.statements || [];
      if (!statements.length) return;

      const rowsHtml = statements.map((stmt, stIdx) => {
        const raw      = record[likertFieldKey(el.elementId, stIdx)];
        const labelIdx = raw ? (parseInt(raw, 10) - 1) : -1;
        const label    = (labelIdx >= 0 && labelIdx < scale.length) ? scale[labelIdx] : null;
        return `<div class="likert-block-row">
          <div class="likert-block-statement">${stmt}</div>
          <div class="likert-block-response${label ? '' : ' no-answer'}">${label || t('shareprint_print_no_answer')}</div>
        </div>`;
      }).join('');

      body += `<div class="likert-block">
        <div class="likert-block-title">${t('shareprint_print_likert_heading')}</div>
        ${rowsHtml}
      </div>`;
    });

  // Reflection questions with saved answers
  if (ch.reflection && ch.reflection.length > 0) {
    body += `<div class="reflection-heading">${t('shareprint_print_reflection_heading')}</div>`;
    (ch.elements || [])
      .filter(e => e.type === 'question' && e.subtype === 'reflection' && !e.repeatElement)
      .forEach((el, ri) => {
        const answer = (record[answerFieldKey('r', el.elementId)] || '').trim();
        const qText  = el.question || el.question1 || '';
        body += `<div class="question-block">
          <div class="question-ref">${t('shareprint_print_reflection_label', { number: ri + 1 })}</div>
          <div class="question-text">${qText}</div>
          <div class="answer ${answer ? '' : 'no-answer'}">${answer ? escapeHtml(answer) : t('shareprint_print_no_answer')}</div>
        </div>`;
      });
  }

  // Notes — only included if non-empty
  const notesVal = (record[answerFieldKey('notes', 0)] || '').trim();
  if (notesVal) {
    body += `<div class="notes-heading">${t('shareprint_print_notes_heading')}</div>
      <div class="answer">${escapeHtml(notesVal)}</div>`;
  }

  return body;
}

function dispatchPrint(html, fallbackMsg) {
  if (window.Android && window.Android.printContent) {
    window.Android.printContent(html);
  } else if (window.Android && window.Android.share) {
    window.Android.share(fallbackMsg);
  }
}

// ── PRINT FUNCTIONS ───────────────────────────────────────────────────────────

// Prints the current chapter. Async because it must load the chapter record
// from IDB before calling buildChapterBody().
async function printChapter() {
  const ch      = chapters[currentChapter];
  const studyId = window.activeStudyId;
  const meta    = window.titlePageData || {};

  let record = {};
  try {
    record = await StudyIDB.getChapterAnswers(studyId, ch.chapterNumber);
  } catch (e) {
    console.warn('[printChapter] IDB read failed; printing with empty answers.', e);
  }

  const chapterHeader = `<div class="chapter-header">
  <div class="chapter-eyebrow">${t('shareprint_print_chapter_eyebrow', { number: ch.chapterNumber, total: chapters.length, studyTitle: meta.title })}</div>
  <h1>${ch.chapterTitle}</h1>
</div>`;

  const docTitle = t('shareprint_print_doc_title_chapter', { studyTitle: meta.title, number: ch.chapterNumber, chapterTitle: ch.chapterTitle });

  const html = `<!DOCTYPE html>
<html lang="en">
${buildPrintHead(docTitle)}
<body>
${chapterHeader}
${buildChapterBody(ch, record)}
</body></html>`;

  dispatchPrint(html, t('shareprint_print_fallback_chapter', { studyTitle: meta.title, number: ch.chapterNumber, chapterTitle: ch.chapterTitle }));
}

// Prints all chapters as a single document. Pre-loads all chapter records and
// global notes from IDB before building HTML.
async function printAllChapters() {
  const studyId     = window.activeStudyId;
  const meta        = window.titlePageData || {};
  const datePrinted = new Date().toLocaleDateString(resolveLanguage(), {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  // Pre-load all chapter records and global notes in parallel.
  const [records, globalNotes] = await Promise.all([
    _loadAllChapterRecords(studyId),
    StudyIDB.getAnswerRaw(`${studyId}_global_notes`).catch(() => ''),
  ]);

  const cover = `<div class="cover">
  <div class="eyebrow">${t('shareprint_print_cover_eyebrow')}</div>
  <h1>${meta.title}</h1>
  <div style="font-size:9pt; color:#666; margin-top:6pt;">${t('shareprint_print_cover_date', { date: datePrinted })}</div>
</div>`;

  let chaptersHTML = '';
  chapters.forEach((ch, i) => {
    const record = records[i] || {};

    // Skip chapters that have no saved content.
    const hasContent = Object.entries(record).some(([field, val]) =>
      (field.startsWith('q_') || field.startsWith('r_') || field === answerFieldKey('notes', 0)) &&
      (val || '').trim()
    );
    if (!hasContent) return;

    chaptersHTML += `<h2>${t('shareprint_print_chapter_h2', { number: ch.chapterNumber, title: ch.chapterTitle })}</h2>
${buildChapterBody(ch, record)}`;
  });

  // Notes & Comments page
  if (appSettings.showPageNotes && globalNotes && globalNotes.trim()) {
    chaptersHTML += `
<h2>${t('shareprint_print_notes_page_heading')}</h2>
<div class="answer" style="min-height:0;">${escapeHtml(globalNotes.trim())}</div>`;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
${buildPrintHead(t('shareprint_print_doc_title_all', { studyTitle: meta.title }))}
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
    body += `<div class="intro"><p>${ch.intro.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p></div>`;
  }

  ch.sections.forEach(sec => {
    if (sec.bridge) {
      body += `<div class="bridge">${sec.bridge.replace(/<b>/g, '<strong>').replace(/<\/b>/g, '</strong>')}</div>`;
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
    body += `<div class="closing"><p>${ch.closing.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p></div>`;
  }

  (ch.elements || [])
    .filter(e => e.type === 'likertScale' && !e.repeatElement && e.subtype !== 'bipolar')
    .forEach(el => {
      const statements = el.statements || [];
      if (!statements.length) return;
      const rowsHtml = statements.map(stmt => `<div class="likert-block-row">
          <div class="likert-block-statement">${stmt}</div>
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
        const qText = el.question || el.question1 || '';
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
    ? `<img src="${meta.image.src}" alt="${meta.image?.alt || ''}"
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
  <h1>${meta.title || ''}</h1>
  ${subtitle    ? `<div style="font-size:13pt; color:#4a3f30; margin-top:4pt; font-style:italic;">${subtitle}</div>` : ''}
  ${description ? `<div style="font-size:10pt; color:#666; margin-top:12pt; max-width:340pt; margin-left:auto; margin-right:auto; line-height:1.6;">${description}</div>` : ''}
  ${authorLabel ? `<div style="font-size:8pt; letter-spacing:0.1em; text-transform:uppercase; color:#8c6420; margin-top:20pt;">${authorLabel}</div>` : ''}
  ${authorName  ? `<div style="font-size:12pt; color:#1c1710; margin-top:4pt;">${authorName}</div>` : ''}
  ${version     ? `<div style="font-size:8pt; color:#999; margin-top:8pt;">${version}</div>` : ''}
</div>`;

  let chaptersHTML = '';
  chapters.forEach(ch => {
    chaptersHTML += `<h2>${t('shareprint_print_chapter_h2', { number: ch.chapterNumber, title: ch.chapterTitle })}</h2>
${buildBlankChapterBody(ch)}`;
  });

  const docTitle = `${meta.title || t('shareprint_default_study_title')} — ${t('shareprint_blank_doc_title_suffix')}`;

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

  dispatchPrint(html, `${meta.title || t('shareprint_default_study_title')} — ${t('shareprint_blank_doc_title_suffix')}`);
}
