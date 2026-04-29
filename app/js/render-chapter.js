// ── RENDER CHAPTER ────────────────────────────────────────────────────────────
// Orchestrator: builds full chapter HTML and injects it into #mainContent.
//
// Element rendering is delegated to render-elements.js.
// Save bar, notes field, nav buttons, and language bar come from
// render-chapter-ui.js.
// This file contains only orchestration, post-render DOM wiring, and error
// handling — no element-level HTML is built here.
//
// Load order (must precede this file):
//   render-elements.js      – renderHeading, renderText, renderBiblePassage,
//                             renderQuestion, renderImage, renderCallout,
//                             renderLikertScaleElement, buildLangMap
//   render-chapter-ui.js    – buildSaveBar, buildNotesField, buildNavButtons,
//                             buildLangBar, setStudyLang
//
// Structure rendered (in order):
//   .chapter-page wrapper    — plain block; holds lang bar div and receives
//                              padding-top offset when the lang bar is visible
//   1.  #chapterLangBar      — sticky lang switcher inside the wrapper;
//                              populated by buildLangBar() post-render
//   2.  Chapter header (label + title)
//   3.  Starred summary panel placeholder (populated after innerHTML is set)
//   4.  Elements loop — delegates to render-elements.js per type
//   5.  Notes field                   — buildNotesField()
//   6.  Prev/Next nav buttons         — buildNavButtons()
//   7.  Save/Share bar                — buildSaveBar()
//   8.  Spacer div
//
// Post-render DOM work (after innerHTML is set):
//   – Language bar population        (buildLangBar)
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
//   LANGUAGE_MAP                     – i18n.js
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
//   window.titlePageData,
//   window.studyMetadata       – state.js / study-loader.js (language slot map source)
//   buildLangBar, setStudyLang       – render-chapter-ui.js


// ── DETECT AVAILABLE LANGUAGES ────────────────────────────────────────────────
// Returns an ordered array of language codes available in this study.
//
// Multilingual studies (v3+) declare language1/language2/language3 in
// studyMetadata once for the whole study — all chapters share the same set.
// window.studyMetadata is set by applyStudyData() in study-loader.js.
//
// Mono-lingual studies carry no numbered language slots anywhere, so this
// returns [] and buildLangBar() hides the bar.
//
// The 'ch' parameter is accepted for callers that still pass it, but is no
// longer used — the scan has moved to studyMetadata.

function detectAvailableLangs(ch) {
  const metadata = window.studyMetadata || {};
  const result   = [];
  for (let i = 1; ; i++) {
    const code = metadata[`language${i}`];
    if (!code) break;
    result.push(code);
  }
  return result;
}


// ── RENDER CHAPTER ────────────────────────────────────────────────────────────

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

    // ── Detect available languages and resolve the active one ─────────────────
    // window._activeStudyLang persists across chapters for the session.
    // If it is set but not present in this chapter, fall back to the first
    // available language (the preferred language may not be in every chapter).
    const availableLangs = detectAvailableLangs(ch);
    const activeLang = (() => {
      const preferred = window._activeStudyLang;
      if (preferred && availableLangs.includes(preferred)) return preferred;
      return availableLangs[0] || 'en';   // 'en' safety net for zero-lang chapters
    })();

    // ── Build the language-slot map ───────────────────────────────────────────
    // { ha: 1, ff: 2, en: 3 } — derived once from studyMetadata and threaded
    // into every ctx so resolveText() can find el[fieldN] without re-scanning.
    // Empty object for mono-lingual studies (resolveText falls back to el[field]).
    const langMap = buildLangMap(window.studyMetadata || {});

    // ── Resolve the chapter title for the active language ─────────────────────
    // Multilingual studies store chapterTitle1/chapterTitle2/chapterTitle3.
    // Mono-lingual studies store chapterTitle (unnumbered).
    const chapterTitle = (() => {
      if (langMap && Object.keys(langMap).length > 0) {
        const slot = langMap[activeLang];
        if (slot !== undefined) return ch[`chapterTitle${slot}`] || ch[`chapterTitle1`] || ch.chapterTitle || '';
        return ch[`chapterTitle1`] || ch.chapterTitle || '';
      }
      return ch.chapterTitle || '';
    })();

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

    // ── 2. Chapter page wrapper + lang bar placeholder + chapter header ─────────
    // .chapter-page is a plain block wrapper with two jobs:
    // 1. Holds the .chapter-lang-bar div so buildLangBar() can find it via
    //    bar.closest('.chapter-page') to toggle .chapter-page--with-lang-bar.
    // 2. Receives padding-top when the lang bar is visible, preventing the
    //    fixed bar from overlapping the chapter header.
    let contentHtml = `<div class="chapter-page">
      <div class="chapter-lang-bar" id="chapterLangBar"></div>
      <div class="chapter-header">
        <div class="chapter-label" id="chapter-label-el">${t('renderchapter_chapter_label', { current: ch.chapterNumber, total: chapters[0].chapterNumber + chapters.length - 1 })}</div>
        <h1 class="chapter-title">${chapterTitle}</h1>
      </div>`;

    // ── 3. Starred summary placeholder ────────────────────────────────────────
    contentHtml += `<div id="starredSummaryContainer"></div>`;

    // ── 4. Elements loop ──────────────────────────────────────────────────────
    for (const el of (ch.elements || [])) {

      // Resolve repeatElement references
      const resolved = el.repeatElement ? elementMap[el.repeatElement] : el;
      if (!resolved) continue; // skip unresolvable references; do not abort render

      const noPad = resolved.bottomPadding === 'none' ? ' style="margin-bottom:0"' : '';

      // activeLang and langMap are threaded into every ctx so renderers can
      // call resolveText() with the correct slot map for this study.
      const ctx = { el: resolved, ch, noPad, answerRowInfoHtml, activeLang, langMap };

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

    // ── 5. Notes field ────────────────────────────────────────────────────────
    contentHtml += buildNotesField(ch);

    // ── 6. Prev/Next nav buttons ──────────────────────────────────────────────
    contentHtml += buildNavButtons(idx, activeLang, langMap);

    // ── 7. Save/Share bar + 8. Spacer ─────────────────────────────────────────
    contentHtml += buildSaveBar(ch);
    contentHtml += `<div style="height:80px"></div>`;
    contentHtml += `</div>`; // close .chapter-page

    // ── Set innerHTML (single write) ──────────────────────────────────────────
    container.innerHTML = contentHtml;

    // ── Post-render: language bar ─────────────────────────────────────────────
    // Populates #chapterLangBar with flag buttons for the available languages.
    // Hides the bar automatically when only one language is present.
    buildLangBar(availableLangs, activeLang);

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
