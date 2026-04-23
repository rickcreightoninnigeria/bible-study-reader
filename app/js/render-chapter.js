// ── RENDER CHAPTER ────────────────────────────────────────────────────────────
// Orchestrator: builds full chapter HTML and injects it into #mainContent.
//
// Element rendering is delegated to render-elements.js.
// Save bar, notes field, and nav buttons come from render-chapter-ui.js.
// This file contains only orchestration, post-render DOM wiring, and error
// handling — no element-level HTML is built here.
//
// Load order (must precede this file):
//   render-elements.js      – renderHeading, renderText, renderBiblePassage,
//                             renderQuestion, renderImage, renderCallout,
//                             renderLikertScaleElement
//   render-chapter-ui.js    – buildSaveBar, buildNotesField, buildNavButtons
//
// Structure rendered (in order):
//   1.  Chapter header (label + title)
//   2.  Starred summary panel placeholder (populated after innerHTML is set)
//   3.  Elements loop — delegates to render-elements.js per type
//   4.  Notes field                   — buildNotesField()
//   5.  Prev/Next nav buttons         — buildNavButtons()
//   6.  Save/Share bar                — buildSaveBar()
//   7.  Spacer div
//
// Post-render DOM work (after innerHTML is set):
//   – Starred summary population
//   – Local-validate eligibility check + input wiring
//   – Chapter-eyebrow info trigger (chapter 1 only, once globally)
//   – Nav bar title update
//   – Progress ring update
//   – Scroll restoration
//
// All chapter fields (openingquote, intro, application, closing, reflection,
// nextSteps) are optional — the elements loop renders only what is present.
//
//  NOTE ON openingquote curly-quote rendering:
//    openingquote: {
//      quoted: true,          // set false (or omit) to disable
//      quotes: [ "…", "…" ],
//      question: "…"
//    }
//
// Dependencies (globals — must be loaded before this file):
//   t()                              – i18n.js
//   ICONS                            – icons.js
//   appSettings                      – settings.js
//   chapters, currentChapter,
//   isNonChapterPage, verseData,
//   storageKey                       – main.js STATE section
//   updateProgress                   – main.js PROGRESS section
//   restoreStudyTheme                – main.js
//   renderTitlePage                  – main.js
//   openLibrary                      – study-loader.js
//   getStarredQuestions,
//   buildStarredSummaryHtml          – starred.js
//   localValidateEligible            – local-validate.js
//   createInfoTrigger                – onboarding.js
//   StudyIDB                         – idb.js
//   Swal                             – sweetalert2 (vendor)
//   window.activeStudyId,
//   window.titlePageData             – state.js

async function renderChapter(idx, scrollY = 0) {
  try {
    currentChapter   = idx;
    isNonChapterPage = false;
    restoreStudyTheme();

    const ch = chapters[idx];
    if (!ch) {
      // No study loaded or index out of range — fall back to title page
      renderTitlePage();
      return;
    }

    const container = document.getElementById('mainContent');
    container.innerHTML = '';

    // ── elementId → element map for resolving repeatElement references ────────
    const elementMap = {};
    (ch.elements || []).forEach(el => {
      if (el.elementId && !el.repeatElement) {
        elementMap[el.elementId] = el;
      }
    });

    // ── Answer-row info popup ─────────────────────────────────────────────────
    // Built once per render and passed into renderQuestion() via ctx so that
    // render-elements.js carries no setup logic of its own. Also written to
    // window._answerRowInfoHtml so the inline onclick handler can reach it.
    const answerRowInfoHtml = {
      title: t('renderchapter_answer_tools_title'),
      body:
        `<p><b>${ICONS.mic} ${t('renderchapter_answer_tools_mic_label')}</b> — ${t('renderchapter_answer_tools_mic_desc')}</p><br>` +
        `<p><b>${ICONS.localValidate} ${t('renderchapter_answer_tools_localvalidate_label')}</b> — ${t('renderchapter_answer_tools_localvalidate_desc')}</p><br>` +
        `<p><b>${ICONS.checkAnswer} ${t('renderchapter_answer_tools_aichat_label')}</b> — ${t('renderchapter_answer_tools_aichat_desc')}</p>`,
    };
    window._answerRowInfoHtml = answerRowInfoHtml;

    // ── 1. Chapter header ─────────────────────────────────────────────────────
    let contentHtml = `
      <div class="chapter-header">
        <div class="chapter-label" id="chapter-label-el">${t('renderchapter_chapter_label', { current: ch.chapterNumber, total: chapters[0].chapterNumber + chapters.length - 1 })}</div>
        <h1 class="chapter-title">${ch.chapterTitle}</h1>
      </div>`;

    // ── 2. Starred summary placeholder ────────────────────────────────────────
    contentHtml += `<div id="starredSummaryContainer"></div>`;

    // ── 3. Elements loop ──────────────────────────────────────────────────────
    for (const el of (ch.elements || [])) {

      // Resolve repeatElement references
      const resolved = el.repeatElement ? elementMap[el.repeatElement] : el;
      if (!resolved) continue; // skip unresolvable references; do not abort render

      const noPad = resolved.bottomPadding === 'none' ? ' style="margin-bottom:0"' : '';
      const ctx   = { el: resolved, ch, noPad, answerRowInfoHtml };

      switch (resolved.type) {

        case 'heading':
          contentHtml += renderHeading(ctx);
          break;

        case 'text':
          contentHtml += renderText(ctx);
          break;

        case 'biblePassage':
          // Side-effect only: registers passage into verseData[].
          // Returns '' — no HTML contribution.
          renderBiblePassage(ctx);
          break;

        case 'question':
          contentHtml += renderQuestion(ctx);
          break;

        case 'image': {
          // Resolve the image src before calling the synchronous renderer.
          // Priority: IDB blob (zip-imported studies) → el.src → empty string.
          const blob   = await StudyIDB.getImage(`${window.activeStudyId}_${resolved.elementId}`);
          const imgSrc = blob
            ? await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.readAsDataURL(blob);
              })
            : (resolved.src || '');
          contentHtml += renderImage({ ...ctx, imgSrc });
          break;
        }

        case 'callout':
          contentHtml += renderCallout(ctx);
          break;

        case 'likertScale':
          contentHtml += renderLikertScaleElement(ctx);
          break;

        default:
          break;
      }
    }

    // ── 4. Notes field ────────────────────────────────────────────────────────
    contentHtml += buildNotesField(ch);

    // ── 5. Prev/Next nav buttons ──────────────────────────────────────────────
    contentHtml += buildNavButtons(idx);

    // ── 6. Save/Share bar + 7. Spacer ─────────────────────────────────────────
    contentHtml += buildSaveBar(ch);
    contentHtml += `<div style="height:80px"></div>`;

    // ── Set innerHTML (single write) ──────────────────────────────────────────
    container.innerHTML = contentHtml;

    // ── Post-render: starred summary ──────────────────────────────────────────
    const starredQuestions = getStarredQuestions(ch);
    if (starredQuestions.length > 0) {
      const summaryContainer = document.getElementById('starredSummaryContainer');
      if (summaryContainer) {
        summaryContainer.innerHTML = buildStarredSummaryHtml(ch, starredQuestions);
      }
    }

    // ── Post-render: local-validate wiring ────────────────────────────────────
    // Remove the button from ineligible cards, then wire the textarea's input
    // event to enable/disable the button on eligible cards.
    container.querySelectorAll('.question-card').forEach(card => {
      const lvBtn = card.querySelector('.local-validate-btn');
      if (!lvBtn) return;
      if (!localValidateEligible(card)) {
        lvBtn.remove();
        return;
      }
      const textarea = card.querySelector('.answer-field');
      if (textarea) {
        textarea.addEventListener('input', () => {
          lvBtn.disabled = !textarea.value.trim();
        });
      }
    });

    // ── Post-render: chapter-eyebrow info trigger (chapter 1 only) ───────────
    if (ch.chapterNumber === 1) {
      createInfoTrigger(
        'chapter-eyebrow-intro',
        {
          title: t('renderchapter_eyebrow_info_title'),
          body:  t('renderchapter_eyebrow_info_body'),
        },
        {
          placement:      'floating',
          headingElement: document.getElementById('chapter-label-el'),
        }
      );
    }

    // ── Post-render: nav bar title ────────────────────────────────────────────
    const navTitle = document.getElementById('header-title');
    if (navTitle) {
      navTitle.innerText = (window.titlePageData && window.titlePageData.headerTitle)
        ? `${window.titlePageData.headerTitle} ·\u00A0${t('renderchapter_nav_chapter_short', { number: ch.chapterNumber })}`
        : t('renderchapter_nav_chapter_short', { number: ch.chapterNumber });
    }

    // ── Post-render: progress + scroll ────────────────────────────────────────
    updateProgress();
    window.scrollTo({ top: scrollY, behavior: 'instant' });

  } catch (err) {
    console.error(err);
    Swal.fire({
      icon:              'error',
      title:             t('renderchapter_error_title'),
      html:              `<p>${t('renderchapter_error_body')}</p><p style="font-size:0.85em; color:var(--text-faint); font-family:monospace;">${err.message}</p>`,
      confirmButtonText: t('renderchapter_error_confirm'),
      showCancelButton:  true,
      cancelButtonText:  t('renderchapter_error_cancel'),
    }).then(result => {
      if (result.isConfirmed) {
        openLibrary();
      } else {
        renderChapter(idx, scrollY);
      }
    });
  }
}
