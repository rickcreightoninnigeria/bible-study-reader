// ── RENDER CHAPTER ────────────────────────────────────────────────────────────
// The main renderChapter() function that builds the full chapter HTML
// from chapters[] data and injects it into #mainContent.
//
// Dependencies (all available as globals before this file loads):
//   ICONS                          – icons.js
//   appSettings                    – settings.js
//   ttsAvailable, ttsShouldShow,
//   ttsSpeak                       – tts.js
//   voiceInputAvailable,
//   startVoiceInput                – voice.js
//   openVerseModal, openQaModalFromElement,
//   openDeeperModal, openNotesInfo,
//   renderLikertScale              – modals.js
//   isStarred, toggleStar,
//   buildStarredSummaryHtml,
//   getStarredQuestions            – starred.js
//   storageKey, likertKey,
//   isNonChapterPage, currentChapter,
//   chapters                       – main.js STATE section
//   updateProgress                 – main.js PROGRESS section
//   saveAnswers                    – save.js
//   window.activeStudyId,
//   window.titlePageData           – state.js

// ── RENDER CHAPTER ────────────────────────────────────────────────────────────
// Main chapter render function. Builds the full chapter HTML from the chapters[]
// data and injects it into #mainContent.
//
// Structure rendered (in order):
//   1. Chapter header (label + title)
//   2. Starred summary panel placeholder (populated after render)
//   3. Opening quotes block (if present); gap; question + answer card below
//   4. Intro block (if present)
//   5. For each section (all sub-fields optional):
//        – Any QA callout cards (inline 'callout' elements in the elements[] array)
//        – Section title (if present)
//        – Bridge text (if present)
//        – Question cards with answer textareas (values loaded from localStorage)
//   6. Application block (if present) — "What this means – and what it doesn't"
//   7. Closing summary block (if present)
//   8. Reflection questions (if present)
//   9. Next Steps block (if present)
//  10. Notes/questions free-text field
//  11. Prev/Next navigation buttons (if enabled in settings)
//  12. Save/Share bar (appended as DOM nodes)
//
//
//  NOTE ON: Curly quotes can be added automatically to the openingquote 
//  To activate, use like this:
//    openingquote: {
//      quoted: true,
//      quotes: [
//        "The gospel is not good advice to men, but good news about Christ.",
//        "We never move on from the gospel; we move on in the gospel."
//      ],
//      question: "What do you think of these quotations?"
//    },
//  To deactive, set "quoted: false," (or omit the "quoted:," line althogether 
//  — it defaults to false.
//
// All chapter fields (openingquote, intro, application, closing, reflection,
// nextSteps) are optional — the function renders only what is present in the
// chapter data object.
//
// Wrapped in try/catch; shows an alert on render errors.

async function renderChapter(idx, scrollY = 0) {
  try {
    currentChapter = idx;
    restoreStudyTheme();
    isNonChapterPage = false;
    const ch = chapters[idx];
    if (!ch) {
      // No study loaded or index out of range — fall back to title page
      renderTitlePage();
      return;
    }
    const container = document.getElementById('mainContent');
    container.innerHTML = '';

    // Build an elementId→element map for resolving repeatElement references
    const elementMap = {};
    (ch.elements || []).forEach(el => {
      if (el.elementId && !el.repeatElement) {
        elementMap[el.elementId] = el;
      }
    });

    // 1. Chapter header
    let contentHtml = `
      <div class="chapter-header">
        <div class="chapter-label" id="chapter-label-el">${t('renderchapter_chapter_label', { current: ch.chapterNumber, total: chapters[0].chapterNumber + chapters.length - 1 })}</div>
        <h1 class="chapter-title">${ch.chapterTitle}</h1>
      </div>`;

    // 2. Starred summary placeholder
    contentHtml += `<div id="starredSummaryContainer"></div>`;

    // 3. Render elements
    // Answer-row info popup body — set once per render so the action-row
    // buttons can reference it safely without inline quote-escaping issues.
    window._answerRowInfoHtml = {
      title: t('renderchapter_answer_tools_title'),
      body:
        `<p><b>${ICONS.mic} ${t('renderchapter_answer_tools_mic_label')}</b> — ${t('renderchapter_answer_tools_mic_desc')}</p><br>` +
        `<p><b>${ICONS.localValidate} ${t('renderchapter_answer_tools_localvalidate_label')}</b> — ${t('renderchapter_answer_tools_localvalidate_desc')}</p><br>` +
        `<p><b>${ICONS.checkAnswer} ${t('renderchapter_answer_tools_aichat_label')}</b> — ${t('renderchapter_answer_tools_aichat_desc')}</p>`
    };    
    
    for (const el of (ch.elements || [])) {

      // Resolve repeatElement references
      const resolved = el.repeatElement ? elementMap[el.repeatElement] : el;
      if (!resolved) return;

      // bottomPadding CSS helper
      const noPad = resolved.bottomPadding === 'none' ? ' style="margin-bottom:0"' : '';

      switch (resolved.type) {

        // ── HEADING ELEMENTS ──────────────────────────────────────────
        case 'heading': {
          if (resolved.subtype === 'reflection') {
            contentHtml += `
              <div class="reflection-header"${noPad}>
                <h3>${resolved.text}</h3>
              </div>`;
          } else if (resolved.subtype === 'section') {
            contentHtml += `
              <div class="section-break">
                <div class="section-break-line"></div>
              </div>
              <h2 class="section-header"${noPad}>${resolved.text}</h2>`;
          } else if (resolved.subtype === 'subsection') {
            contentHtml += `
              <h3 class="subsection-header"${noPad}>${resolved.text}</h2>`;
          }
          break;
        }

        // ── TEXT ELEMENTS ─────────────────────────────────────────────
        case 'text': {
          const html = resolved.format === 'HTML'
            ? resolved.text
            : renderParas(resolved.text);

          const encodedHtml = html.replace(/"/g, '&quot;');

          switch (resolved.subtype) {
            case 'intro': {
              const introSpeakBtn = ttsAvailable() && ttsShouldShow(ttsStripHtml(html).length)
                ? `<button class="speak-btn" onclick="ttsSpeak(this.closest('.intro-block').dataset.ttsRawHtml, this)" title="${t('renderchapter_speak_btn_title')}">${ICONS.speak}</button>`
                : '';
              contentHtml += `<div class="intro-block"${noPad} data-tts-raw-html="${encodedHtml}">${introSpeakBtn}${html}</div>`;
              break;
            }
            case 'bridge': {
              const bridgeSpeakBtn = ttsAvailable() && ttsShouldShow(ttsStripHtml(html).length)
                ? `<button class="speak-btn" onclick="ttsSpeak(this.closest('.bridge-text').dataset.ttsRawHtml, this)" title="${t('renderchapter_speak_btn_title')}">${ICONS.speak}</button>`
                : '';
              contentHtml += `<div class="bridge-text"${noPad} data-tts-raw-html="${encodedHtml}">${bridgeSpeakBtn}${html}</div>`;
              break;
            }
            case 'closing': {
              const closingSpeakBtn = ttsAvailable() && ttsShouldShow(ttsStripHtml(html).length)
                ? `<button class="speak-btn" onclick="ttsSpeak(this.closest('.bridge-text').dataset.ttsRawHtml, this)" title="${t('renderchapter_speak_btn_title')}">${ICONS.speak}</button>`
                : '';
              contentHtml += `
                <div class="section-break">
                  <div class="section-break-line"></div>
                  <div class="section-break-text">${t('renderchapter_closing_label')}</div>
                  <div class="section-break-line"></div>
                </div>
                <div class="bridge-text"${noPad} data-tts-raw-html="${encodedHtml}">${closingSpeakBtn}${html}</div>`;
              break;
            }
            default: {
              const defaultSpeakBtn = ttsAvailable() && ttsShouldShow(ttsStripHtml(html).length)
                ? `<button class="speak-btn" onclick="ttsSpeak(this.closest('.bridge-text').dataset.ttsRawHtml, this)" title="${t('renderchapter_speak_btn_title')}">${ICONS.speak}</button>`
                : '';
              contentHtml += `<div class="bridge-text"${noPad} data-tts-raw-html="${encodedHtml}">${defaultSpeakBtn}${html}</div>`;
            }
          }
          break;
        }

        // ── BIBLE PASSAGE ─────────────────────────────────────────────
        case 'biblePassage': {
          // Register into verseData so openVerseModal() can find it
          verseData[resolved.bibleRef] = {
            text:   resolved.passageText,
            netUrl: resolved.passageUrl
          };

//          contentHtml += `
//            <div class="question-ref"${noPad} style="cursor:pointer; margin:12px 16px 0; border-radius:8px;"
//              onclick="openVerseModal('${resolved.bibleRef.replace(/'/g, "\\'")}')">
//              ${resolved.bibleRef}
//              <span style="font-size:11px; opacity:0.7; float:right;">↗</span>
//            </div>`;
          break;
        }
        
        // ── QUESTIONS ─────────────────────────────────────────────────
        case 'question': {
          const isReflection = resolved.subtype === 'reflection';
          const isHeader     = resolved.subtype === 'header';
          const key          = storageKey(ch.chapterNumber, isReflection ? 'r' : 'q', resolved.elementId);
          const val          = localStorage.getItem(key) || '';
          const starred      = isStarred(ch.chapterNumber, resolved.elementId);
          const cardId       = resolved.elementId;
          const placeholder  = resolved.answerPlaceholder || (isReflection ? t('renderchapter_placeholder_reflection') : t('renderchapter_placeholder_thoughts'));

          if (isHeader) {
            // Header subtype: custom text in the ref bar instead of a scripture ref.
            // header field supports plain text or HTML (resolved via resolved.format).
            const headerHtml = resolved.format === 'HTML'
              ? (resolved.header || '')
              : (resolved.header || '').replace(/</g, '&lt;'); // safe plain-text fallback
            const encodedSampleAnswer = resolved.sampleAnswer ? resolved.sampleAnswer.replace(/"/g, '&quot;') : '';
            const encodedQuestionHint = resolved.questionHint ? resolved.questionHint.replace(/"/g, '&quot;') : '';

            contentHtml += `
              <div class="question-card ${starred ? 'starred-card' : ''}" id="${cardId}"${noPad}
                data-question-subtype="${resolved.subtype || ''}"
                data-linked-passage="${resolved.linkedPassage || ''}"${resolved.sampleAnswer ? ` data-sample-answer="${encodedSampleAnswer}"` : ''}${resolved.questionHint ? ` data-question-hint="${encodedQuestionHint}"` : ''}>
                <div class="question-ref question-ref-split">
                  <span class="question-header-label">${headerHtml}</span>
                  <button class="verse-btn star-btn"
                    id="star_${cardId}"
                    onclick="toggleStar(${ch.chapterNumber}, '${cardId}')">
                    ${starred ? ICONS.starFilled : ICONS.starEmpty}
                  </button>
                </div>
                <div class="question-body">
                  <div class="question-text">${resolved.question}${resolved.deeper ? ` <button class="deeper-btn" onclick="openDeeperModal('${cardId}')">(${(resolved.deeper.label || t('renderchapter_go_deeper'))} ${ICONS.triggerInfo})</button>` : ''}</div>
                </div>
                <textarea class="answer-field"
                  data-type="q"
                  data-index="${resolved.elementId}"
                  placeholder="${placeholder}"
                  oninput="autoResize(this)"
                  onblur="saveAnswers(); localValidateAutoTrigger(this)"
                >${val}</textarea>
                <div class="answer-action-row">
                  <button class="answer-info-btn" title="${t('renderchapter_answer_info_btn_title')}"
                      onclick="openInfoModal('answer-action-row-info', window._answerRowInfoHtml, this)">${ICONS.triggerInfo}</button>
                  ${aiTutorAvailable() && showCheckAnswerButton() ? `<button class="check-answer-btn" title="${t('renderchapter_ask_ai_tutor')}" onclick="openAiTutorForCard(this)">${ICONS.checkAnswer}</button>` : ''}
                  <button class="local-validate-btn" title="${t('renderchapter_check_my_answer')}" onclick="openLocalValidateForCard(this)" ${val ? '' : 'disabled'}>${ICONS.localValidate}</button>
                  ${voiceInputAvailable() ? `<button class="mic-btn" onclick="startVoiceInput(this)">${ICONS.mic}</button>` : ''}
                </div>
              </div>`;

          } else {
            // Standard question (including reflection and bible subtypes)
            const ref      = resolved.linkedPassage || (isReflection ? t('renderchapter_reflection_label') : '');
            const hasVerse = verseData.hasOwnProperty(ref);
            const encodedSampleAnswer = resolved.sampleAnswer ? resolved.sampleAnswer.replace(/"/g, '&quot;') : '';
            const encodedQuestionHint = resolved.questionHint ? resolved.questionHint.replace(/"/g, '&quot;') : '';

            const refSpanAttrs = hasVerse
                ? `data-ref="${ref.replace(/"/g, '&quot;')}" onclick="openVerseModal(this.dataset.ref)" style="cursor:pointer;"`
                : '';


            //"bluefish color-coding
            contentHtml += `
              <div class="question-card ${starred ? 'starred-card' : ''}" id="${cardId}"${noPad}
                data-question-subtype="${resolved.subtype || ''}"
                data-linked-passage="${resolved.linkedPassage || ''}"${resolved.sampleAnswer ? ` data-sample-answer="${encodedSampleAnswer}"` : ''}${resolved.questionHint ? ` data-question-hint="${encodedQuestionHint}"` : ''}>
                <div class="question-ref">
                  <span ${refSpanAttrs}>
                    ${ref}${hasVerse ? ` <span class="passage-icon">${ICONS.triggerInfo}</span>` : ''}
                  </span>
                  <button class="verse-btn star-btn"
                    id="star_${cardId}"
                    onclick="toggleStar(${ch.chapterNumber}, '${cardId}')">
                    ${starred ? ICONS.starFilled : ICONS.starEmpty}
                  </button>
                </div>
                <div class="question-body">
                  <div class="question-text">${resolved.question}${resolved.deeper ? ` <button class="deeper-btn" onclick="openDeeperModal('${cardId}')">(${(resolved.deeper.label || t('renderchapter_go_deeper'))} ${ICONS.triggerInfo})</button>` : ''}</div>
                </div>
                <textarea class="answer-field"
                  data-type="${isReflection ? 'r' : 'q'}"
                  data-index="${resolved.elementId}"
                  placeholder="${placeholder}"
                  oninput="autoResize(this)"
                  onblur="saveAnswers(); localValidateAutoTrigger(this)"
                >${val}</textarea>
                <div class="answer-action-row">
                  <button class="answer-info-btn" title="${t('renderchapter_answer_info_btn_title')}"
                      onclick="openInfoModal('answer-action-row-info', window._answerRowInfoHtml, this)">${ICONS.triggerInfo}</button>
                  ${aiTutorAvailable() && showCheckAnswerButton() ? `<button class="check-answer-btn" title="${t('renderchapter_ask_ai_tutor')}" onclick="openAiTutorForCard(this)">${ICONS.checkAnswer}</button>` : ''}
                  <button class="local-validate-btn" title="${t('renderchapter_check_my_answer')}" onclick="openLocalValidateForCard(this)" ${val ? '' : 'disabled'}>${ICONS.localValidate}</button>
                  ${voiceInputAvailable() ? `<button class="mic-btn" onclick="startVoiceInput(this)">${ICONS.mic}</button>` : ''}
                </div>
              </div>`;
          }
          break;
        }
        
        // ── IMAGE ─────────────────────────────────────────────────────
        case 'image': {
          // Resolve src: IDB blob (zip format) → src field → empty
          const imgSrc = await (async () => {
            const blob = await StudyIDB.getImage(`${window.activeStudyId}_${resolved.elementId}`);
            if (blob) {
              return await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.readAsDataURL(blob);
              });
            }
            if (resolved.src) return resolved.src;
            return '';
          })();

          const imgAlt      = resolved.alt      || '';
          const fallback    = resolved.fallback  || '🖼️';
          const caption     = resolved.caption   || '';
          const align       = resolved.align     || 'full';
          const widthPct    = parseInt(resolved.width) || 100;

          // Outer wrapper handles margin and alignment
          const alignStyle = align === 'full'
            ? 'width:100%;'
            : align === 'left'
              ? `width:${widthPct}%; float:left; margin-right:16px;`
              : align === 'right'
                ? `width:${widthPct}%; float:right; margin-left:16px;`
                : `width:${widthPct}%; margin-left:auto; margin-right:auto;`; // center

          // Caption: apply format (markdown not yet supported — treat as plainText)
          const captionHtml = caption
            ? (resolved.format === 'HTML'
                ? caption
                : `<p class="chapter-image-caption">${caption}</p>`)
            : '';

          contentHtml += `
            <div class="chapter-image-wrapper" style="${alignStyle}"${noPad}>
              ${imgSrc
                ? `<img class="chapter-image" src="${imgSrc}" alt="${imgAlt}"
                       onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                   <div class="chapter-image-fallback" style="display:none">${fallback}</div>`
                : `<div class="chapter-image-fallback">${fallback}</div>`}
              ${captionHtml}
            </div>`;
          break;
        }

        // ── QA CALLOUT ────────────────────────────────────────────────
        case 'callout': {
          const safeId = resolved.elementId.replace(/'/g, "\\'");
          
          if (resolved.subtype === 'general') {
            const btnLabel = resolved.buttonText || t('renderchapter_callout_general_btn');
            contentHtml += `
              <div class="gen-callout-card"${noPad}>
                <div class="gen-callout-eyebrow">${resolved.eyebrow}</div>
                <div class="gen-callout-body">
                  <div class="gen-callout-term">${resolved.term}</div>
                  <div class="gen-callout-question">${resolved.question}</div>
                  <button class="gen-callout-btn" onclick="openQaModalFromElement('${safeId}')">
                    ${btnLabel}
                  </button>
                </div>
              </div>`;
          } else if (resolved.subtype === 'misunderstanding') {
            const btnLabel = resolved.buttonText || t('renderchapter_callout_misunderstanding_btn');
            contentHtml += `
              <div class="qa-callout-card"${noPad}>
                <div class="qa-callout-eyebrow">${resolved.eyebrow}</div>
                <div class="qa-callout-body">
                  <div class="qa-callout-term">${resolved.term}</div>
                  <div class="qa-callout-question">${resolved.question}</div>
                  <button class="qa-callout-btn" onclick="openQaModalFromElement('${safeId}')">
                    ${btnLabel}
                  </button>
                </div>
              </div>`;
          }
          break;
        }

        // ── LIKERT SCALE ──────────────────────────────────────────────
        case 'likertScale': {
          contentHtml += renderLikertScale(resolved, ch.chapterNumber);
          break;
        }

        default:
          break;
      }
    }

    // 4. Notes/questions free-text field (always appended as a UI feature)
    const notesKey = storageKey(ch.chapterNumber, 'notes', 0);
    const notesVal = localStorage.getItem(notesKey) || '';
    contentHtml += `
      <div class="section-break section-break-spaced">
        <div class="section-break-line"></div>
        <div class="section-break-text">${t('renderchapter_notes_section_label')}</div>
        <div class="section-break-line"></div>
      </div>
      <div class="question-card">
        <div class="question-ref question-ref-split">
          <span>${t('renderchapter_notes_heading')}</span>
          <button class="verse-btn" onclick="openNotesInfo()">${ICONS.triggerInfo}</button>
        </div>
        <textarea class="answer-field"
          data-type="notes"
          data-index="0"
          placeholder="${t('renderchapter_notes_placeholder')}"
          oninput="autoResize(this)"
        >${notesVal}</textarea>
        ${voiceInputAvailable() ? `<button class="mic-btn" onclick="startVoiceInput(this)">${ICONS.mic}</button>` : ''}
      </div>`;

    // 6. Prev/Next navigation buttons
    const showBack = idx > 0;
    const showNext = idx < chapters.length - 1;
    const navHtml = appSettings.showNavButtons ? `
      <div class="chapter-nav">
        ${showBack
          ? `<button class="chapter-nav-btn secondary" onclick="goToChapter(${idx - 1})">← ${chapters[idx - 1].chapterTitle}</button>`
          : `<div style="flex:1"></div>`}
        ${showNext
          ? `<button class="chapter-nav-btn" onclick="goToChapter(${idx + 1})">→ ${chapters[idx + 1].chapterTitle}</button>`
          : `<div style="flex:1"></div>`}
      </div>` : '';

    container.innerHTML = contentHtml + navHtml + `<div style="height:80px"></div>`;

    // 7. Starred summary — populated after innerHTML is set
    const starredQuestions = getStarredQuestions(ch);
    if (starredQuestions.length > 0) {
      const summaryContainer = document.getElementById('starredSummaryContainer');
      if (summaryContainer) {
        summaryContainer.innerHTML = buildStarredSummaryHtml(ch, starredQuestions);
      }
    }

    // Local validate: apply eligibility and wire up input-driven enable/disable
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

    // Info trigger: chapter eyebrow (fires on chapter 1 only, once globally)
    if (ch.chapterNumber === 1) {
      createInfoTrigger(
        'chapter-eyebrow-intro',
        {
          title: t('renderchapter_eyebrow_info_title'),
          body:  t('renderchapter_eyebrow_info_body')
        },
        {
          placement:      'floating',
          headingElement: document.getElementById('chapter-label-el')
        }
      );
    }

    // 8. Save/Share bar
    const saveBar = document.createElement('div');
    saveBar.className = 'save-bar';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'save-btn';
    saveBtn.innerHTML = `${ICONS.save} ${t('renderchapter_save_btn')}`;
    saveBtn.onclick = saveAnswers;

    const printBtn = document.createElement('button');
    printBtn.className = 'save-btn';
    printBtn.style.background = 'var(--text-secondary)';
    printBtn.innerHTML = `${ICONS.print} ${t('renderchapter_print_btn')}`;
    printBtn.onclick = printChapter;

    const shareBtn = document.createElement('button');
    shareBtn.className = 'save-btn';
    shareBtn.style.background = 'var(--success)';
    shareBtn.innerHTML = `${ICONS.share} ${t('renderchapter_share_btn')}`;
    shareBtn.onclick = shareAnswers;

    saveBar.appendChild(saveBtn);
    saveBar.appendChild(printBtn);
    saveBar.appendChild(shareBtn);
    container.appendChild(saveBar);

    // 9. Nav bar title
    const navTitle = document.getElementById('header-title');
    if (navTitle) navTitle.innerText =
      (window.titlePageData && window.titlePageData.headerTitle)
        ? `${window.titlePageData.headerTitle} ·\u00A0${t('renderchapter_nav_chapter_short', { number: ch.chapterNumber })}`
        : t('renderchapter_nav_chapter_short', { number: ch.chapterNumber });

    updateProgress();

    // Scroll to the requested position immediately after render.
    // Using 'instant' behaviour avoids any animated jump.
    window.scrollTo({ top: scrollY, behavior: 'instant' });

  } catch (err) {
    console.error(err);
    Swal.fire({
      icon: 'error',
      title: t('renderchapter_error_title'),
      html: `<p>${t('renderchapter_error_body')}</p><p style="font-size:0.85em; color:var(--text-faint); font-family:monospace;">${err.message}</p>`,
      confirmButtonText: t('renderchapter_error_confirm'),
      showCancelButton: true,
      cancelButtonText: t('renderchapter_error_cancel'),
    }).then(result => {
      if (result.isConfirmed) {
        openLibrary();
      } else {
        renderChapter(idx, scrollY);
      }
    });
  }
}
