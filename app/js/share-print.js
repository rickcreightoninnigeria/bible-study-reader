// ── SHARE / PRINT ─────────────────────────────────────────────────────────────
// Share and print/export functions: compiling chapter answers into formatted
// text reports, generating print-ready HTML documents, and dispatching to
// the Android share/print bridge or Web Share API.
//
// Swipe, scroll, and visibilitychange listeners have moved to gestures.js.
//
// Dependencies (all available as globals before this file loads):
//   appSettings                    – settings.js
//   chapters, currentChapter       – state.js
//   storageKey                     – state.js
//   window.activeStudyId           – state.js
//   window.titlePageData           – set by study-loader.js
//   copyToClipboard                – utils.js
//   showToast                      – utils.js
//   t                              – i18n.js
//   Router                         – router.js (runtime call only)

// ── SHARE ANSWERS ─────────────────────────────────────────────────────────────

// Compiles the current chapter's questions and answers into a formatted text
// report and shares it via the native Web Share API, Android bridge, or clipboard.
// Bold markers (*text*) are applied when shareFormat is 'formatted' (WhatsApp-style),
// and omitted for 'plain' (email). Includes reflection answers and notes if present.
// Clipboard fallback uses copyToClipboard() → navigator.clipboard.writeText()
// with execCommand as a last resort via fallbackCopy().
function shareAnswers() {
  const ch   = chapters[currentChapter];
  const meta = window.titlePageData || {};
  const fmt  = appSettings.shareFormat === 'plain';
  const bold = (s) => fmt ? s : `*${s}*`;

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

  // Notes — appended to the share report only if the field has content
  const notesKey = storageKey(ch.chapterNumber, 'notes', 0);
  const notesVal = localStorage.getItem(notesKey) || '';
  if (notesVal.trim()) {
    report += bold(t('shareprint_notes_heading')) + '\n';
    report += `------------------------------------------\n`;
    report += notesVal.trim() + '\n\n';
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

// Compiles answered questions from all chapters into a single export document
// and shares/copies it. Chapters with no answers are silently skipped.
// If no answers exist at all, shows a friendly "No answers yet" dialog instead
// of sharing an empty document. Adds a datestamped footer to the export.
function exportAllAnswers() {
  const meta = window.titlePageData || {};
  const fmt  = appSettings.shareFormat === 'plain';
  const bold = (s) => fmt ? s : `*${s}*`;

  let report = bold(`${meta.title || t('shareprint_default_study_title')}`) + '\n';
  report += bold(t('shareprint_complete_answers_heading')) + '\n';
  report += `==========================================\n\n`;

  let hasAnyAnswers = false;

  chapters.forEach(ch => {
    let chapterReport    = '';
    let chapterHasAnswers = false;

    chapterReport += bold(t('shareprint_chapter_heading', { number: ch.chapterNumber, title: ch.chapterTitle })) + '\n';
    chapterReport += `------------------------------------------\n\n`;

    // Question answers
    ch.sections.forEach(section => {
      section.questions.forEach(q => {
        const key    = storageKey(ch.chapterNumber, 'q', q.elementId);
        const answer = localStorage.getItem(key) || '';
        if (answer.trim()) {
          chapterHasAnswers = true;
          chapterReport += `${bold(t('shareprint_label_ref'))} ${q.ref}\n`;
          chapterReport += `${bold(t('shareprint_label_q'))} ${q.text}\n`;
          chapterReport += `${bold(t('shareprint_label_a'))} ${answer.trim()}\n\n`;
        }
      });
    });

    // Reflection answers — iterates ch.elements directly so elementId is read
    // from the element itself, matching the key renderQuestion() writes.
    // Identical fix to the one applied in search.js.
    {
      let reflectionReport = '';
      let hasReflections   = false;
      (ch.elements || [])
        .filter(e => e.type === 'question' && e.subtype === 'reflection' && !e.repeatElement)
        .forEach(el => {
          const answer = localStorage.getItem(storageKey(ch.chapterNumber, 'r', el.elementId)) || '';
          if (answer.trim()) {
            hasReflections    = true;
            chapterHasAnswers = true;
            const qText = el.question || el.question1 || '';
            reflectionReport += `${bold(t('shareprint_label_q'))} ${qText}\n`;
            reflectionReport += `${bold(t('shareprint_label_a'))} ${answer.trim()}\n\n`;
          }
        });
      if (hasReflections) {
        chapterReport += bold(t('shareprint_reflection_short_heading')) + '\n\n';
        chapterReport += reflectionReport;
      }
    }

    // Notes — included in export only if the user wrote something
    const notesKey    = storageKey(ch.chapterNumber, 'notes', 0);
    const notesAnswer = localStorage.getItem(notesKey) || '';
    if (notesAnswer.trim()) {
      chapterHasAnswers = true;
      chapterReport += bold(t('shareprint_notes_heading')) + '\n';
      chapterReport += notesAnswer.trim() + '\n\n';
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

  const date = new Date().toLocaleDateString('en-GB', {
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
// ── PRINT HELPERS ─────────────────────────────────────────────────────────────

// Returns the complete <head>…</head> block for a print document.
// 'title' becomes the <title> element text.
// All CSS shared by single-chapter and all-chapters print is defined here.
// The h1 / h2 / .cover / .eyebrow rules are only used by printAllChapters but
// are harmless in the single-chapter document, so one unified style block keeps
// things simple and avoids duplication.
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

  body {
    font-family: ${bodyFontStack};
    font-size: 11pt;
    color: black;
    margin: 0;
    padding: 0;
  }
  h1 {
    font-family: ${headingFontStack};
    font-size: 20pt;
    font-style: italic;
    font-weight: 400;
    margin: 0 0 8pt 0;
    color: #1c1710;
  }
  h2 {
    font-family: ${headingFontStack};
    font-size: 14pt;
    font-style: italic;
    font-weight: 400;
    margin: 24pt 0 8pt 0;
    color: #1c1710;
    border-bottom: 0.5pt solid #c8bca8;
    padding-bottom: 4pt;
    page-break-after: avoid;
  }
  .cover {
    text-align: center;
    padding: 40pt 0 32pt;
    border-bottom: 1pt solid #c8bca8;
    margin-bottom: 24pt;
  }
  .eyebrow {
    font-size: 8pt;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #8c6420;
    margin-bottom: 8pt;
  }
  .chapter-header {
    margin-bottom: 16pt;
  }
  .chapter-eyebrow {
    font-size: 8pt;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #8c6420;
    margin-bottom: 4pt;
  }
  .intro {
    font-style: italic;
    color: #4a3f30;
    margin-bottom: 16pt;
    padding: 8pt 12pt;
    border-left: 2pt solid #c8bca8;
  }
  .bridge {
    color: #4a3f30;
    margin: 12pt 0;
    font-size: 10pt;
  }
  .closing {
    font-style: italic;
    color: #4a3f30;
    margin: 16pt 0;
    padding: 8pt 12pt;
    border-left: 2pt solid #c8bca8;
  }
  .question-block {
    border: 0.5pt solid #ddd;
    margin: 8pt 0;
    page-break-inside: avoid;
  }
  .question-ref {
    background: #2c2416;
    color: #d4a843;
    padding: 4pt 8pt;
    font-size: 8pt;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .question-text {
    padding: 6pt 8pt 3pt;
    font-size: 10pt;
  }
  .answer {
    padding: 6pt 8pt;
    font-size: 10pt;
    border-top: 0.5pt solid #ddd;
    background: #f9f9f9;
    min-height: 32pt;
    white-space: pre-wrap;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .no-answer {
    color: #aaa;
    font-style: italic;
  }
  .reflection-heading {
    font-family: ${headingFontStack};
    background: #8b3a2a;
    color: white;
    padding: 5pt 8pt;
    font-size: 10pt;
    font-style: italic;
    margin: 16pt 0 0 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    page-break-after: avoid;
  }
  .notes-heading {
    font-size: 8pt;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #666;
    margin: 16pt 0 4pt 0;
  }
  .likert-block {
    border: 0.5pt solid #ccc;
    margin: 8pt 0;
    page-break-inside: avoid;
  }
  .likert-block-title {
    background: #2c2416;
    color: #d4a843;
    padding: 4pt 8pt;
    font-size: 8pt;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .likert-block-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 4pt 8pt;
    font-size: 10pt;
    border-top: 0.5pt solid #eee;
    gap: 12pt;
  }
  .likert-block-row:first-of-type { border-top: none; }
  .likert-block-statement { flex: 1; color: black; }
  .likert-block-response  { flex-shrink: 0; font-style: italic; color: #444; text-align: right; }
  .likert-block-response.no-answer { color: #aaa; }
  @page { margin: 1.5cm 1.8cm; }
</style>
</head>`;
}

// Returns the inner body HTML for a single chapter: intro, sections (bridge +
// questions with saved answers), closing passage, reflection questions, and notes.
// Does NOT include a chapter header — callers add their own wrapper so that
// printChapter() and printAllChapters() can use different header styles.
function buildChapterBody(ch) {
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
      const answer = localStorage.getItem(storageKey(ch.chapterNumber, 'q', q.elementId)) || '';
      body += `<div class="question-block">
        <div class="question-ref">${q.ref}</div>
        <div class="question-text">${q.text}</div>
        <div class="answer ${answer.trim() ? '' : 'no-answer'}">${answer.trim() ? escapeHtml(answer.trim()) : t('shareprint_print_no_answer')}</div>
      </div>`;
    });
  });

  // Closing passage
  if (ch.closing) {
    body += `<div class="closing"><p>${ch.closing.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p></div>`;
  }

  // Likert scale responses — rendered as statement/response rows.
  // Only standard (non-bipolar) scales are included; bipolar is not yet
  // implemented in renderLikertScale() so no responses exist for it.
  // Stored value: 1-based integer string from likertKey(chNum, eid, stIdx).
  // The label is resolved by indexing into el.scale (already locale-resolved
  // before being stored on the element by renderChapter).
  (ch.elements || [])
    .filter(e => e.type === 'likertScale' && !e.repeatElement && e.subtype !== 'bipolar')
    .forEach(el => {
      const scale      = el.scale      || [];
      const statements = el.statements || [];
      if (!statements.length) return;

      const rowsHtml = statements.map((stmt, stIdx) => {
        const raw      = localStorage.getItem(likertKey(ch.chapterNumber, el.elementId, stIdx));
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

  // Reflection questions with saved answers.
  // Iterates ch.elements directly so elementId is read from the element itself,
  // matching the key renderQuestion() writes — identical fix to search.js.
  if (ch.reflection && ch.reflection.length > 0) {
    body += `<div class="reflection-heading">${t('shareprint_print_reflection_heading')}</div>`;
    (ch.elements || [])
      .filter(e => e.type === 'question' && e.subtype === 'reflection' && !e.repeatElement)
      .forEach((el, ri) => {
        const answer = localStorage.getItem(storageKey(ch.chapterNumber, 'r', el.elementId)) || '';
        const qText  = el.question || el.question1 || '';
        body += `<div class="question-block">
          <div class="question-ref">${t('shareprint_print_reflection_label', { number: ri + 1 })}</div>
          <div class="question-text">${qText}</div>
          <div class="answer ${answer.trim() ? '' : 'no-answer'}">${answer.trim() ? escapeHtml(answer.trim()) : t('shareprint_print_no_answer')}</div>
        </div>`;
      });
  }

  // Notes — only included if non-empty
  const notesVal = localStorage.getItem(storageKey(ch.chapterNumber, 'notes', 0)) || '';
  if (notesVal.trim()) {
    body += `<div class="notes-heading">${t('shareprint_print_notes_heading')}</div>
      <div class="answer">${escapeHtml(notesVal.trim())}</div>`;
  }

  return body;
}

// Sends a completed HTML document to the Android print bridge, with a fallback
// to the share bridge if printing is not available on the device.
function dispatchPrint(html, fallbackMsg) {
  if (window.Android && window.Android.printContent) {
    window.Android.printContent(html);
  } else if (window.Android && window.Android.share) {
    window.Android.share(fallbackMsg);
  }
}

// ── PRINT FUNCTIONS ───────────────────────────────────────────────────────────

// Prints the current chapter as a self-contained document. Uses the chapter's
// own header style (eyebrow + large h1) rather than the multi-chapter h2 style
// used by printAllChapters().
function printChapter() {
  const ch   = chapters[currentChapter];
  const meta = window.titlePageData || {};

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
${buildChapterBody(ch)}
</body></html>`;

  dispatchPrint(html, t('shareprint_print_fallback_chapter', { studyTitle: meta.title, number: ch.chapterNumber, chapterTitle: ch.chapterTitle }));
}

// Prints all chapters as a single document with a cover page. Chapters that
// contain no saved answers, reflection answers, or notes are skipped so the
// output only reflects the user's actual work.
function printAllChapters() {
  const meta        = window.titlePageData || {};
  const datePrinted = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  const cover = `<div class="cover">
  <div class="eyebrow">${t('shareprint_print_cover_eyebrow')}</div>
  <h1>${meta.title}</h1>
  <div style="font-size:9pt; color:#666; margin-top:6pt;">${t('shareprint_print_cover_date', { date: datePrinted })}</div>
</div>`;

  let chaptersHTML = '';
  chapters.forEach(ch => {
    // Skip chapters that have no saved content
    let hasContent = false;
    ch.sections.forEach(sec => {
      sec.questions.forEach(q => {
        if (localStorage.getItem(storageKey(ch.chapterNumber, 'q', q.elementId))) hasContent = true;
      });
    });
    if (ch.reflection) {
      const reflEls = (ch.elements || []).filter(
        e => e.type === 'question' && e.subtype === 'reflection' && !e.repeatElement
      );
      ch.reflection.forEach((r, ri) => {
        const eid = reflEls[ri] ? reflEls[ri].elementId : null;
        if (eid && localStorage.getItem(storageKey(ch.chapterNumber, 'r', eid))) hasContent = true;
      });
    }
    const notesVal = localStorage.getItem(storageKey(ch.chapterNumber, 'notes', 0));
    if (notesVal && notesVal.trim()) hasContent = true;
    if (!hasContent) return;

    chaptersHTML += `<h2>${t('shareprint_print_chapter_h2', { number: ch.chapterNumber, title: ch.chapterTitle })}</h2>
${buildChapterBody(ch)}`;
  });

  // Notes & Comments page — only included if the feature is enabled AND non-empty
  const currentStudyId = window.activeStudyId;
  const globalNotes    = localStorage.getItem(`bsr_${currentStudyId}_global_notes`);
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

// Returns the inner body HTML for a single chapter with all answer fields left
// blank — no localStorage lookups, no saved content. Used by printBlankStudy()
// to produce a clean, unanswered version of the study ready for printing on paper.
//
// Structure mirrors buildChapterBody() exactly, with these differences:
//   • Question answer boxes are always empty (white, no placeholder text).
//   • Likert response cells are blank (same row layout, no text).
//   • Reflection answer boxes are always empty.
//   • Notes section is omitted entirely (it's a personal annotations space).
function buildBlankChapterBody(ch) {
  let body = '';

  // Intro
  if (ch.intro) {
    body += `<div class="intro"><p>${ch.intro.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p></div>`;
  }

  // Sections: bridge text then questions with blank answer boxes
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

  // Closing passage
  if (ch.closing) {
    body += `<div class="closing"><p>${ch.closing.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p></div>`;
  }

  // Likert scales — same row layout as buildChapterBody() but response cell is blank
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

  // Reflection questions with blank answer boxes
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

  // Notes omitted intentionally — this is a clean unanswered document.

  return body;
}

// Generates a print-ready HTML document of the entire study with all answer
// fields left blank. Includes the title page and all chapters. Excludes the
// Notes & Comments page, Leaders Notes, and About page.
//
// Called from the "Print Blank Study" card in Settings → Study tab.
function printBlankStudy() {
  const meta = window.titlePageData || {};

  // ── Cover page ──────────────────────────────────────────────────────────────
  // Mirrors the on-screen title page: image, title, subtitle, description,
  // author label/name, and version. The image is included via its src URL so
  // it renders in the print document exactly as it does on screen.
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

  // ── All chapters — no content gate; every chapter is always included ────────
  let chaptersHTML = '';
  chapters.forEach(ch => {
    chaptersHTML += `<h2>${t('shareprint_print_chapter_h2', { number: ch.chapterNumber, title: ch.chapterTitle })}</h2>
${buildBlankChapterBody(ch)}`;
  });

  // Notes & Comments, Leaders Notes, and About are intentionally excluded.

  const docTitle = `${meta.title || t('shareprint_default_study_title')} — ${t('shareprint_blank_doc_title_suffix')}`;

  const html = `<!DOCTYPE html>
<html lang="en">
${buildPrintHead(docTitle)}
<style>
  /* Blank answer box: white fill, slightly taller to invite handwriting */
  .blank-answer {
    background: #fff !important;
    min-height: 48pt !important;
    border-top: 0.5pt solid #ddd;
  }
  /* Blank Likert response cell: white, right-aligned, with a subtle underline
     to give a clear writing target without looking like an answer is expected */
  .likert-block-response.blank-answer {
    min-height: 0 !important;
    border-top: none;
    border-bottom: 0.5pt solid #bbb;
    padding-bottom: 2pt;
  }
</style>
<body>
${cover}
${chaptersHTML}
</body></html>`;

  dispatchPrint(html, `${meta.title || t('shareprint_default_study_title')} — ${t('shareprint_blank_doc_title_suffix')}`);
}