// ── RENDER ELEMENTS ───────────────────────────────────────────────────────────
// One renderer function per element type, extracted from render-chapter.js.
// Each function accepts a ctx object and returns an HTML string, except
// renderBiblePassage() which returns '' and is called for its side-effect only.
//
// All functions are synchronous. The image renderer receives a pre-resolved
// imgSrc string — the async IDB lookup is handled by the orchestrator
// (render-chapter.js) before calling renderImage().
//
// ctx shape (all renderers):
//   ctx.el    {object}  The resolved element object from chapters[].elements[]
//   ctx.ch    {object}  The chapter object (chapters[idx])
//   ctx.noPad {string}  Either ' style="margin-bottom:0"' or '' — derived from
//                       el.bottomPadding by the orchestrator
//
// ctx shape (renderQuestion only, additional):
//   ctx.answerRowInfoHtml {object}  { title, body } — built once per render in
//                                   render-chapter.js and passed through ctx so
//                                   render-elements.js needs no setup logic
//
// ctx shape (renderImage only, additional):
//   ctx.imgSrc {string}  Pre-resolved image src (data URL, remote URL, or '')
//
// Globals used (must be loaded before this file):
//   t()                              – i18n.js
//   ICONS                            – icons.js
//   verseData                        – main.js STATE section  (read + written by renderBiblePassage)
//   storageKey                       – main.js STATE section
//   ttsAvailable, ttsShouldShow,
//   ttsStripHtml                     – tts.js
//   voiceInputAvailable              – voice.js
//   isStarred                        – starred.js
//   openVerseModal, openQaModalFromElement,
//   openDeeperModal, openInfoModal   – modals.js
//   renderLikertScale                – modals.js
//   localValidateAutoTrigger,
//   openLocalValidateForCard,
//   localValidateEligible            – local-validate.js
//   aiTutorAvailable,
//   showCheckAnswerButton,
//   openAiTutorForCard               – ai-tutor.js
//   startVoiceInput                  – voice.js
//   autoResize                       – utils.js
//   saveAnswers                      – save.js
//   renderParas                      – utils.js


// ── HEADING ───────────────────────────────────────────────────────────────────

function renderHeading(ctx) {
  const { el, noPad } = ctx;

  if (el.subtype === 'reflection') {
    return `
      <div class="reflection-header"${noPad}>
        <h3>${el.text}</h3>
      </div>`;
  }

  if (el.subtype === 'section') {
    return `
      <div class="section-break">
        <div class="section-break-line"></div>
      </div>
      <h2 class="section-header"${noPad}>${el.text}</h2>`;
  }

  if (el.subtype === 'subsection') {
    return `
      <h3 class="subsection-header"${noPad}>${el.text}</h3>`;
  }

  return '';
}


// ── TEXT ──────────────────────────────────────────────────────────────────────
// Handles subtypes: 'intro', 'bridge', 'closing', and the default (plain bridge).
//
// NOTE: The 'closing' speak button uses this.closest('.bridge-text') rather than
// '.closing-block' because the closing text is intentionally rendered inside a
// .bridge-text div (same layout as bridge). If that class is ever renamed, the
// TTS onclick selector will break and must be updated here to match.

function renderText(ctx) {
  const { el, noPad } = ctx;

  const html        = el.format === 'HTML' ? el.text : renderParas(el.text);
  const encodedHtml = html.replace(/"/g, '&quot;');
  const speakTitle  = t('renderchapter_speak_btn_title');

  switch (el.subtype) {

    case 'intro': {
      const speakBtn = ttsAvailable() && ttsShouldShow(ttsStripHtml(html).length)
        ? `<button class="speak-btn" onclick="ttsSpeak(this.closest('.intro-block').dataset.ttsRawHtml, this)" title="${speakTitle}">${ICONS.speak}</button>`
        : '';
      return `<div class="intro-block"${noPad} data-tts-raw-html="${encodedHtml}">${speakBtn}${html}</div>`;
    }

    case 'bridge': {
      const speakBtn = ttsAvailable() && ttsShouldShow(ttsStripHtml(html).length)
        ? `<button class="speak-btn" onclick="ttsSpeak(this.closest('.bridge-text').dataset.ttsRawHtml, this)" title="${speakTitle}">${ICONS.speak}</button>`
        : '';
      return `<div class="bridge-text"${noPad} data-tts-raw-html="${encodedHtml}">${speakBtn}${html}</div>`;
    }

    case 'closing': {
      const speakBtn = ttsAvailable() && ttsShouldShow(ttsStripHtml(html).length)
        ? `<button class="speak-btn" onclick="ttsSpeak(this.closest('.bridge-text').dataset.ttsRawHtml, this)" title="${speakTitle}">${ICONS.speak}</button>`
        : '';
      return `
        <div class="section-break">
          <div class="section-break-line"></div>
          <div class="section-break-text">${t('renderchapter_closing_label')}</div>
          <div class="section-break-line"></div>
        </div>
        <div class="bridge-text"${noPad} data-tts-raw-html="${encodedHtml}">${speakBtn}${html}</div>`;
    }

    default: {
      const speakBtn = ttsAvailable() && ttsShouldShow(ttsStripHtml(html).length)
        ? `<button class="speak-btn" onclick="ttsSpeak(this.closest('.bridge-text').dataset.ttsRawHtml, this)" title="${speakTitle}">${ICONS.speak}</button>`
        : '';
      return `<div class="bridge-text"${noPad} data-tts-raw-html="${encodedHtml}">${speakBtn}${html}</div>`;
    }
  }
}


// ── BIBLE PASSAGE ─────────────────────────────────────────────────────────────
// Registers the passage into the verseData global so that openVerseModal() can
// find it when a question card's ref span is tapped. Returns '' — this element
// renders no visible HTML of its own; its presence makes linked question refs
// tappable.
//
// Side-effect: writes verseData[el.bibleRef] = { text, netUrl }.

function renderBiblePassage(ctx) {
  const { el } = ctx;
  verseData[el.bibleRef] = {
    text:   el.passageText,
    netUrl: el.passageUrl,
  };
  return '';
}


// ── QUESTION ──────────────────────────────────────────────────────────────────
// Renders both the 'header' subtype (custom label in the ref bar) and the
// standard subtype (scripture ref, optionally tappable via verseData).

function renderQuestion(ctx) {
  const { el, ch, noPad, answerRowInfoHtml } = ctx;

  const isReflection = el.subtype === 'reflection';
  const isHeader     = el.subtype === 'header';
  const key          = storageKey(ch.chapterNumber, isReflection ? 'r' : 'q', el.elementId);
  const val          = localStorage.getItem(key) || '';
  const starred      = isStarred(ch.chapterNumber, el.elementId);
  const cardId       = el.elementId;
  const placeholder  = el.answerPlaceholder
    || (isReflection ? t('renderchapter_placeholder_reflection') : t('renderchapter_placeholder_thoughts'));

  const encodedSampleAnswer = el.sampleAnswer ? el.sampleAnswer.replace(/"/g, '&quot;') : '';
  const encodedQuestionHint = el.questionHint ? el.questionHint.replace(/"/g, '&quot;') : '';

  const sampleAnswerAttr = el.sampleAnswer ? ` data-sample-answer="${encodedSampleAnswer}"` : '';
  const questionHintAttr = el.questionHint ? ` data-question-hint="${encodedQuestionHint}"` : '';

  const deeperBtn = el.deeper
    ? ` <button class="deeper-btn" onclick="openDeeperModal('${cardId}')">(${el.deeper.label || t('renderchapter_go_deeper')} ${ICONS.triggerInfo})</button>`
    : '';

  const actionRow = `
    <div class="answer-action-row">
      <button class="answer-info-btn" title="${t('renderchapter_answer_info_btn_title')}"
          onclick="openInfoModal('answer-action-row-info', window._answerRowInfoHtml, this)">${ICONS.triggerInfo}</button>
      ${aiTutorAvailable() && showCheckAnswerButton() ? `<button class="check-answer-btn" title="${t('renderchapter_ask_ai_tutor')}" onclick="openAiTutorForCard(this)">${ICONS.checkAnswer}</button>` : ''}
      <button class="local-validate-btn" title="${t('renderchapter_check_my_answer')}" onclick="openLocalValidateForCard(this)" ${val ? '' : 'disabled'}>${ICONS.localValidate}</button>
      ${voiceInputAvailable() ? `<button class="mic-btn" onclick="startVoiceInput(this)">${ICONS.mic}</button>` : ''}
    </div>`;

  const starBtn = `
    <button class="verse-btn star-btn"
      id="star_${cardId}"
      onclick="toggleStar(${ch.chapterNumber}, '${cardId}')">
      ${starred ? ICONS.starFilled : ICONS.starEmpty}
    </button>`;

  const textarea = `
    <textarea class="answer-field"
      data-type="${isReflection ? 'r' : 'q'}"
      data-index="${el.elementId}"
      placeholder="${placeholder}"
      oninput="autoResize(this)"
      onblur="saveAnswers(); localValidateAutoTrigger(this)"
    >${val}</textarea>`;

  const cardOpen = `
    <div class="question-card ${starred ? 'starred-card' : ''}" id="${cardId}"${noPad}
      data-question-subtype="${el.subtype || ''}"
      data-linked-passage="${el.linkedPassage || ''}"${sampleAnswerAttr}${questionHintAttr}>`;

  if (isHeader) {
    // Header subtype: custom label in the ref bar instead of a scripture ref.
    // Supports plain text or HTML (resolved via el.format).
    const headerHtml = el.format === 'HTML'
      ? (el.header || '')
      : (el.header || '').replace(/</g, '&lt;');

    return `${cardOpen}
        <div class="question-ref question-ref-split">
          <span class="question-header-label">${headerHtml}</span>
          ${starBtn}
        </div>
        <div class="question-body">
          <div class="question-text">${el.question}${deeperBtn}</div>
        </div>
        ${textarea}
        ${actionRow}
      </div>`;
  }

  // Standard question (including reflection and bible subtypes)
  const ref          = el.linkedPassage || (isReflection ? t('renderchapter_reflection_label') : '');
  const hasVerse     = verseData.hasOwnProperty(ref);
  const refSpanAttrs = hasVerse
    ? `data-ref="${ref.replace(/"/g, '&quot;')}" onclick="openVerseModal(this.dataset.ref)" style="cursor:pointer;"`
    : '';

  return `${cardOpen}
      <div class="question-ref">
        <span ${refSpanAttrs}>
          ${ref}${hasVerse ? ` <span class="passage-icon">${ICONS.triggerInfo}</span>` : ''}
        </span>
        ${starBtn}
      </div>
      <div class="question-body">
        <div class="question-text">${el.question}${deeperBtn}</div>
      </div>
      ${textarea}
      ${actionRow}
    </div>`;
}


// ── IMAGE ─────────────────────────────────────────────────────────────────────
// imgSrc is pre-resolved by the orchestrator (render-chapter.js) via the async
// StudyIDB.getImage() call. This function is fully synchronous.

function renderImage(ctx) {
  const { el, noPad, imgSrc } = ctx;

  const imgAlt   = el.alt     || '';
  const fallback = el.fallback || '🖼️';
  const caption  = el.caption  || '';
  const align    = el.align    || 'full';
  const widthPct = parseInt(el.width) || 100;

  const alignStyle = align === 'full'
    ? 'width:100%;'
    : align === 'left'
      ? `width:${widthPct}%; float:left; margin-right:16px;`
      : align === 'right'
        ? `width:${widthPct}%; float:right; margin-left:16px;`
        : `width:${widthPct}%; margin-left:auto; margin-right:auto;`; // center

  // Caption: markdown not yet supported — treat as plainText unless format is HTML
  const captionHtml = caption
    ? (el.format === 'HTML' ? caption : `<p class="chapter-image-caption">${caption}</p>`)
    : '';

  return `
    <div class="chapter-image-wrapper" style="${alignStyle}"${noPad}>
      ${imgSrc
        ? `<img class="chapter-image" src="${imgSrc}" alt="${imgAlt}"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
           <div class="chapter-image-fallback" style="display:none">${fallback}</div>`
        : `<div class="chapter-image-fallback">${fallback}</div>`}
      ${captionHtml}
    </div>`;
}


// ── CALLOUT ───────────────────────────────────────────────────────────────────
// Subtypes: 'general' (gen-callout-card) and 'misunderstanding' (qa-callout-card).

function renderCallout(ctx) {
  const { el, noPad } = ctx;
  const safeId = el.elementId.replace(/'/g, "\\'");

  if (el.subtype === 'general') {
    const btnLabel = el.buttonText || t('renderchapter_callout_general_btn');
    return `
      <div class="gen-callout-card"${noPad}>
        <div class="gen-callout-eyebrow">${el.eyebrow}</div>
        <div class="gen-callout-body">
          <div class="gen-callout-term">${el.term}</div>
          <div class="gen-callout-question">${el.question}</div>
          <button class="gen-callout-btn" onclick="openQaModalFromElement('${safeId}')">
            ${btnLabel}
          </button>
        </div>
      </div>`;
  }

  if (el.subtype === 'misunderstanding') {
    const btnLabel = el.buttonText || t('renderchapter_callout_misunderstanding_btn');
    return `
      <div class="qa-callout-card"${noPad}>
        <div class="qa-callout-eyebrow">${el.eyebrow}</div>
        <div class="qa-callout-body">
          <div class="qa-callout-term">${el.term}</div>
          <div class="qa-callout-question">${el.question}</div>
          <button class="qa-callout-btn" onclick="openQaModalFromElement('${safeId}')">
            ${btnLabel}
          </button>
        </div>
      </div>`;
  }

  return '';
}


// ── LIKERT SCALE ──────────────────────────────────────────────────────────────
// Thin ctx-signature wrapper around renderLikertScale() from modals.js,
// for consistency with the other element renderers.

function renderLikertScaleElement(ctx) {
  const { el, ch } = ctx;
  return renderLikertScale(el, ch.chapterNumber);
}
