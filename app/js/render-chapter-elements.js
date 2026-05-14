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
//   ctx.el             {object}  The resolved element object from chapters[].elements[]
//   ctx.ch             {object}  The chapter object (chapters[idx])
//   ctx.noPad          {string}  Either ' style="margin-bottom:0"' or '' — derived from
//                                el.bottomPadding by the orchestrator
//   ctx.activeLang     {string}  Active study language code (e.g. 'ha', 'en').
//                                Set by the orchestrator from window._activeStudyLang,
//                                falling back to the first language in studyMetadata.
//   ctx.langMap        {object}  Slot-index map built from studyMetadata, e.g.
//                                { ha: 1, ff: 2, en: 3 }. Empty object for
//                                mono-lingual studies. Passed to resolveText() so
//                                it can find el[field + N] without scanning elements.
//   ctx.chapterAnswers {object}  Pre-loaded IDB answer record for this chapter,
//                                fetched once by the orchestrator (render-chapter.js)
//                                via StudyIDB.getChapterAnswers(). Used by
//                                renderQuestion() to populate saved answer text
//                                and starred state without any async calls.
//                                Defaults to {} when no answers exist yet.
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
//   answerFieldKey                   – state.js
//   ttsAvailable, ttsShouldShow,
//   ttsStripHtml                     – tts.js
//   voiceInputAvailable              – voice.js
//   isStarredFromCache               – starred.js
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
//   renderFormatted, renderParas,
//   renderFormattedArray             – format-text.js


// ── LANGUAGE RESOLUTION ───────────────────────────────────────────────────────
// buildLangMap(studyMetadata)
//   Builds a slot-index map: { ha: 1, ff: 2, en: 3 }
//
// resolveText(el, lang, field, langMap)
//   Resolves a numbered field on a chapter element for the active language.
//
// resolveMetaField(obj, field, lang, langMap)
//   Resolves a numbered field on any plain object (metadata, leaders notes,
//   howToUse sections, etc.) using the same slot system as resolveText().
//
// getActiveLang(availableLangs)
//   Returns the session active language constrained to a given set of codes.
//   Shared by all page renderers so they mirror renderChapter()'s logic.
//
// buildLangMap(studyMetadata)
//
// Builds a slot-index map from studyMetadata so resolvers can find the right
// numbered field without scanning every element.
//
//   Input:  studyMetadata = { language1: 'ha', language2: 'ff', language3: 'en', … }
//   Output: { ha: 1, ff: 2, en: 3 }
//
// Returns an empty object for studies that carry no numbered language slots
// (mono-lingual studies use unnumbered fields throughout).

function buildLangMap(studyMetadata) {
  const map = {};
  if (!studyMetadata) return map;
  for (let i = 1; ; i++) {
    const code = studyMetadata[`language${i}`];
    if (!code) break;
    map[code] = i;
  }
  return map;
}


// resolveText(el, lang, field, langMap)
//
// Returns the localised value of a numbered field on an element.
//
// Lookup order:
//   1. langMap present and lang found in it → el[field + slotIndex]
//   2. langMap present but lang missing (element doesn't carry this lang) →
//      el[field + 1] (first available slot, i.e. the primary language)
//   3. langMap absent or empty (mono-lingual study) → el[field] (unnumbered)
//   4. Final safety net → '' (never returns undefined)
//
// The 'field' parameter is the base name without a number suffix.
// Callers pass: 'text', 'question', 'answerPlaceholder', 'sampleAnswer',
// 'questionHint', 'eyebrow', 'term', 'answer', etc.
//
// langMap is optional: callers that don't have it (e.g. helpers called outside
// a render ctx) can omit it and the function will fall back gracefully.

function resolveText(el, lang, field, langMap) {
  // ── Multilingual path (langMap has entries) ────────────────────────────────
  if (langMap && Object.keys(langMap).length > 0) {
    const slot = langMap[lang];
    if (slot !== undefined) {
      // This element may not carry every language slot — fall back to slot 1.
      return el[`${field}${slot}`] || el[`${field}1`] || '';
    }
    // lang not in langMap at all — fall back to slot 1.
    return el[`${field}1`] || '';
  }

  // ── Mono-lingual path (no langMap) ────────────────────────────────────────
  // Study uses plain unnumbered fields (el.text, el.question, …).
  // Also handles old-style per-element language1/language2 scanning as a
  // last resort (for any transitional format).
  if (el[field] !== undefined) return el[field] || '';

  // Transitional: scan per-element languageN slots.
  for (let i = 1; ; i++) {
    if (!el[`language${i}`]) break;
    if (el[`language${i}`] === lang) return el[`${field}${i}`] || '';
  }
  return el[`${field}1`] || '';
}


// ── METADATA FIELD RESOLUTION ─────────────────────────────────────────────────
// resolveMetaField(obj, field, lang, langMap)
//
// Resolves a numbered field from a plain metadata-like object (studyMetadata,
// leadersNotesData, a howToUseData section/block, etc.) using the same slot
// system as resolveText().
//
// This is a thin wrapper around resolveText() — the object IS the "element"
// in this context. Kept as a named helper so call-sites are self-documenting.
//
// Examples:
//   resolveMetaField(studyMetadata, 'title',    'en', langMap)  → meta.title3
//   resolveMetaField(section,       'heading',  'ha', langMap)  → section.heading1
//   resolveMetaField(ch,            'keyPoints','ff', langMap)  → ch.keyPoints2
//
// Mono-lingual fallback: when langMap is empty, resolveText falls through to
// obj[field] (unnumbered), so mono-lingual studies work without any changes.

function resolveMetaField(obj, field, lang, langMap) {
  return resolveText(obj, lang, field, langMap);
}


// ── BIBLE TRANSLATION RESOLUTION ─────────────────────────────────────────────
// resolveBibleTranslation(slotIndex, studyMetadata)
//
// Returns { label, lang } for a given bibleTranslationN slot, handling both
// the old plain-string format and the new language-tagged object format.
//
// Old format (plain string):
//   studyMetadata.bibleTranslation1 = "HAU79"
//   → { label: "HAU79", lang: null }
//
// New format (language-tagged object):
//   studyMetadata.bibleTranslation1 = { "ha": "HAU79" }
//   → { label: "HAU79", lang: "ha" }
//
// Returns null if the slot does not exist.

function resolveBibleTranslation(slotIndex, studyMetadata) {
  const raw = studyMetadata[`bibleTranslation${slotIndex}`];
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'string') return { label: raw, lang: null };
  // Object format: exactly one key whose value is the label string.
  const lang  = Object.keys(raw)[0] || null;
  const label = lang ? raw[lang] : '';
  if (!label) return null;
  return { label, lang };
}


// resolveBibleRefForLang(el, lang, studyMetadata)
//
// Returns the localised book-name Bible reference (e.g. "Psalm 19:1") for the
// active language, using the new bibleTranslationN language-tagged format.
//
// Rules:
//   • Walk slots 1, 2, 3 … in order.
//   • For each slot where resolveBibleTranslation returns a lang that matches
//     the active language, return el[`bibleRef${slot}`].
//   • The *first* matching slot wins (handles multiple translations per language).
//   • If no slot matches (old plain-string format, or lang not present), fall
//     back to el.bibleRef1 || el.bibleRef (canonical primary ref).
//
// This means mono-lingual studies (old format, lang: null on every slot) always
// fall through to the bibleRef1 fallback, which is correct and unchanged behaviour.

function resolveBibleRefForLang(el, lang, studyMetadata) {
  for (let i = 1; ; i++) {
    const slot = resolveBibleTranslation(i, studyMetadata);
    if (slot === null) break;            // no more slots
    if (slot.lang === lang) {
      return el[`bibleRef${i}`] || el.bibleRef1 || el.bibleRef || '';
    }
  }
  // Fallback: old plain-string format or lang not present in any slot.
  return el.bibleRef1 || el.bibleRef || '';
}


// ── ACTIVE LANGUAGE RESOLUTION ────────────────────────────────────────────────
// getActiveLang(availableLangs)
//
// Returns the active study language for the current session, constrained to
// the languages present in the current study/page.
//
// Lookup order:
//   1. window._activeStudyLang if it is present in availableLangs
//   2. First entry in availableLangs
//   3. null if availableLangs is empty (mono-lingual studies pass [])
//
// Shared by renderTitlePage, renderMenu, renderLeadersNotes, and tabStudy()
// so they all use exactly the same resolution logic as renderChapter().

function getActiveLang(availableLangs) {
  const preferred = window._activeStudyLang;
  if (preferred && availableLangs.includes(preferred)) return preferred;
  return availableLangs[0] || null;
}


// ── HEADING ───────────────────────────────────────────────────────────────────

function renderHeading(ctx) {
  const { el, noPad, activeLang, langMap } = ctx;

  // Headings use the 'text' field. resolveText handles both multilingual
  // (text1/text2) and mono-lingual (text) elements gracefully.
  const text = resolveText(el, activeLang, 'text', langMap);

  if (el.subtype === 'reflection') {
    return `
      <div class="reflection-header"${noPad}>
        <h3>${text}</h3>
      </div>`;
  }

  if (el.subtype === 'section') {
    return `
      <div class="section-break">
        <div class="section-break-line"></div>
      </div>
      <h2 class="section-header"${noPad}>${text}</h2>`;
  }

  if (el.subtype === 'subsection') {
    return `
      <h3 class="subsection-header"${noPad}>${text}</h3>`;
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
  const { el, noPad, activeLang, langMap } = ctx;

  // resolveText returns the raw text for the active language.
  // Format conversion (HTML passthrough, markdown rendering, or paragraph
  // wrapping) is handled centrally by renderFormatted() in format-text.js.
  const rawText     = resolveText(el, activeLang, 'text', langMap);
  const html        = renderFormatted(rawText, el.format);
  const encodedHtml = html.replace(/"/g, '&quot;');
  const speakTitle  = t('renderchapter_speak_btn_title');

  switch (el.subtype) {

    case 'intro': {
      const speakBtn = ttsAvailable() && ttsShouldShow(ttsStripHtml(html).length)
        ? `<button class="speak-btn" onclick="ttsSpeak(this.closest('.intro-block').dataset.ttsRawHtml, this)" title="${speakTitle}" aria-label="${speakTitle}">${ICONS.speak}</button>`
        : '';
      return `<div class="intro-block"${noPad} data-tts-raw-html="${encodedHtml}">${speakBtn}${html}</div>`;
    }

    case 'bridge': {
      const speakBtn = ttsAvailable() && ttsShouldShow(ttsStripHtml(html).length)
        ? `<button class="speak-btn" onclick="ttsSpeak(this.closest('.bridge-text').dataset.ttsRawHtml, this)" title="${speakTitle}" aria-label="${speakTitle}">${ICONS.speak}</button>`
        : '';
      return `<div class="bridge-text"${noPad} data-tts-raw-html="${encodedHtml}">${speakBtn}${html}</div>`;
    }

    case 'closing': {
      const speakBtn = ttsAvailable() && ttsShouldShow(ttsStripHtml(html).length)
        ? `<button class="speak-btn" onclick="ttsSpeak(this.closest('.bridge-text').dataset.ttsRawHtml, this)" title="${speakTitle}" aria-label="${speakTitle}">${ICONS.speak}</button>`
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
        ? `<button class="speak-btn" onclick="ttsSpeak(this.closest('.bridge-text').dataset.ttsRawHtml, this)" title="${speakTitle}" aria-label="${speakTitle}">${ICONS.speak}</button>`
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
// verseData is keyed on the primary ref (bibleRef1 for multilingual, bibleRef
// for mono-lingual), which must match the linkedPassage field on question
// elements.
//
// Side-effect: writes verseData[primaryRef] = { translations: [...] }
//
// Multilingual format (v3+):
//   Translation labels come from studyMetadata.bibleTranslation1/2/3…
//   (independent of the language slots — 5 Bible translations for 3 languages
//   is a valid configuration). passageText1/bibleRef1/passageUrl1 are matched
//   by slot index to bibleTranslation1, and so on.
//   Slots with empty passageText are silently skipped.
//
// Legacy per-element format (v2 multilingual):
//   translation1/passageText1/passageUrl1/bibleRef1, … continuing until a
//   numbered slot is absent. Labels come from el.translationN directly.
//
// Mono-lingual legacy format (v1):
//   el.bibleRef / el.passageText / el.passageUrl — stored as a one-entry array.

function renderBiblePassage(ctx) {
  const { el } = ctx;
  const studyMetadata = window.studyMetadata || {};
  const translations = [];

  // ── Detect which format this passage element uses ──────────────────────────
  const hasMetadataTranslations = !!studyMetadata.bibleTranslation1;
  const hasPerElementTranslations = !!el.translation1;

  if (hasMetadataTranslations) {
    // ── v3 multilingual: labels from studyMetadata.bibleTranslationN ─────────
    for (let i = 1; ; i++) {
      const slot = resolveBibleTranslation(i, studyMetadata);
      if (slot === null) break;                        // no more translation slots
      const text = el[`passageText${i}`] || '';
      if (!text) continue;                             // this passage doesn't have slot i
      translations.push({
        label: slot.label,
        text,
        url: el[`passageUrl${i}`] || '',
        ref: el[`bibleRef${i}`]   || el.bibleRef1 || '',
      });
    }

  } else if (hasPerElementTranslations) {
    // ── v2 multilingual: labels embedded on the element itself ────────────────
    for (let i = 1; ; i++) {
      const label = el[`translation${i}`];
      if (!label) break;
      const text = el[`passageText${i}`] || '';
      if (!text) continue;
      translations.push({
        label,
        text,
        url: el[`passageUrl${i}`] || '',
        ref: el[`bibleRef${i}`]   || el.bibleRef1 || '',
      });
    }

  } else if (el.passageText) {
    // ── v1 mono-lingual legacy: unnumbered fields ─────────────────────────────
    translations.push({
      label: el.translation || 'NET',
      text:  el.passageText,
      url:   el.passageUrl  || '',
      ref:   el.bibleRef    || '',
    });
  }

  if (translations.length === 0) return '';

  // Key on the primary ref (must match linkedPassage on question elements).
  const key = el.bibleRef1 || el.bibleRef || '';
  if (!key) return '';

  verseData[key] = { translations };
  return '';
}


// ── QUESTION ──────────────────────────────────────────────────────────────────
// Renders both the 'header' subtype (custom label in the ref bar) and the
// standard subtype (scripture ref, optionally tappable via verseData).
//
// Answer pre-population and star state are read synchronously from
// ctx.chapterAnswers, which is fetched from IDB once by the orchestrator
// (renderChapter) before the elements loop runs.

function renderQuestion(ctx) {
  const { el, ch, noPad, answerRowInfoHtml, activeLang, langMap, chapterAnswers } = ctx;

  const isReflection = el.subtype === 'reflection';
  const isHeader     = el.subtype === 'header';

  // Read saved answer value from the pre-loaded chapter answers object.
  const fieldKey = answerFieldKey(isReflection ? 'r' : 'q', el.elementId);
  const val      = escapeHtml((chapterAnswers || {})[fieldKey] || '');

  // Read star state from the pre-loaded chapter answers object.
  const starred  = isStarredFromCache(chapterAnswers, el.elementId);
  const cardId   = el.elementId;

  // Resolve the question text for the active language.
  const questionText = resolveText(el, activeLang, 'question', langMap);

  // Resolve the answer placeholder for the active language.
  // Falls back to the generic i18n defaults when no language-keyed slot exists.
  const placeholder =
    resolveText(el, activeLang, 'answerPlaceholder', langMap) ||
    (isReflection ? t('renderchapter_placeholder_reflection') : t('renderchapter_placeholder_thoughts'));

  // Resolve sampleAnswer and questionHint for the active language.
  // Multilingual studies use sampleAnswer1/2/3 and questionHint1/2/3;
  // mono-lingual studies use sampleAnswer and questionHint (unnumbered).
  // resolveText handles both cases transparently via langMap.
  const sampleAnswerText = resolveText(el, activeLang, 'sampleAnswer', langMap);
  const questionHintText = resolveText(el, activeLang, 'questionHint', langMap);

  const encodedSampleAnswer = sampleAnswerText ? sampleAnswerText.replace(/"/g, '&quot;') : '';
  const encodedQuestionHint = questionHintText ? questionHintText.replace(/"/g, '&quot;') : '';

  const sampleAnswerAttr = sampleAnswerText ? ` data-sample-answer="${encodedSampleAnswer}"` : '';
  const questionHintAttr = questionHintText ? ` data-question-hint="${encodedQuestionHint}"` : '';

  const deeperLabel = el.deeper
    ? (resolveText(el.deeper, activeLang, 'label', langMap) || t('renderchapter_go_deeper'))
    : '';
  const deeperBtn = el.deeper
    ? ` <button class="deeper-btn" onclick="openDeeperModal('${cardId}', '${activeLang}')">(${deeperLabel} ${ICONS.triggerInfo})</button>`
    : '';

  const actionRow = `
    <div class="answer-action-row">
      <button class="answer-info-btn" title="${t('renderchapter_answer_info_btn_title')}" aria-label="${t('renderchapter_answer_info_btn_title')}"
          onclick="openInfoModal('answer-action-row-info', window._answerRowInfoHtml, this)">${ICONS.triggerInfo}</button>
      ${aiTutorAvailable() && showCheckAnswerButton() ? `<button class="check-answer-btn" title="${t('renderchapter_ask_ai_tutor')}" aria-label="${t('renderchapter_ask_ai_tutor')}" onclick="openAiTutorForCard(this)">${ICONS.checkAnswer}</button>` : ''}
      <button class="local-validate-btn" title="${t('renderchapter_check_my_answer')}" aria-label="${t('renderchapter_check_my_answer')}" onclick="openLocalValidateForCard(this)" ${val ? '' : 'disabled'}>${ICONS.localValidate}</button>
      ${voiceInputAvailable() ? `<button class="mic-btn" onclick="startVoiceInput(this)" aria-label="${t('renderchapter_answer_tools_mic_label')}" title="${t('renderchapter_answer_tools_mic_label')}">${ICONS.mic}</button>` : ''}
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
      onblur="localValidateAutoTrigger(this)"
    >${val}</textarea>`;

  const cardOpen = `
    <div class="question-card ${starred ? 'starred-card' : ''}" id="${cardId}"${noPad}
      data-question-subtype="${el.subtype || ''}"
      data-linked-passage="${el.linkedPassage || ''}"${sampleAnswerAttr}${questionHintAttr}>`;

  if (isHeader) {
    // Header subtype: custom label in the ref bar instead of a scripture ref.
    // Supports plain text, HTML, and markdown (resolved via el.format).
    const headerHtml = renderFormatted(el.header || '', el.format);

    return `${cardOpen}
        <div class="question-ref question-ref-split">
          <span class="question-header-label">${headerHtml}</span>
          ${starBtn}
        </div>
        <div class="question-body">
          <div class="question-text">${questionText}${deeperBtn}</div>
        </div>
        ${textarea}
        ${actionRow}
      </div>`;
  }

  // Standard question (including reflection and bible subtypes)
  // Resolve the displayed ref for the active language.
  // • Reflection questions → i18n label.
  // • No linkedPassage    → empty string.
  // • Old plain-string bibleTranslationN format → el.linkedPassage unchanged.
  // • New language-tagged format → first slot whose lang matches activeLang,
  //   looked up via the verseData entry that renderBiblePassage already built.
  //   el.linkedPassage (= bibleRef1) is used only as the verseData key;
  //   the visible label comes from the matching translation's .ref field.
  const displayRef = (() => {
    if (isReflection) return t('renderchapter_reflection_label');
    if (!el.linkedPassage) return '';
    const studyMetadata = window.studyMetadata || {};
    // Detect whether any slot uses the new language-tagged object format.
    const hasTaggedFormat = (() => {
      for (let i = 1; ; i++) {
        const raw = studyMetadata[`bibleTranslation${i}`];
        if (raw === undefined || raw === null || raw === '') return false;
        if (typeof raw === 'object') return true;
      }
      return false;
    })();
    if (!hasTaggedFormat) return el.linkedPassage;
    // New format: scan slots for first one whose lang matches activeLang,
    // then look up its ref from the verseData entry (keyed on bibleRef1).
    const entry = verseData[el.linkedPassage];
    if (!entry) return el.linkedPassage;
    for (let i = 1; ; i++) {
      const slot = resolveBibleTranslation(i, studyMetadata);
      if (slot === null) break;
      if (slot.lang === activeLang) {
        const tr = entry.translations.find(t => t.label === slot.label);
        if (tr && tr.ref) return tr.ref;
      }
    }
    return el.linkedPassage;   // safe fallback
  })();

  const hasVerse     = verseData.hasOwnProperty(el.linkedPassage || '');
  // data-ref stays as el.linkedPassage (the canonical verseData key = bibleRef1).
  // The visible label uses displayRef so the book name is localised for activeLang.
  const refSpanAttrs = hasVerse
    ? `data-ref="${(el.linkedPassage || '').replace(/"/g, '&quot;')}" onclick="openVerseModal(this.dataset.ref)" style="cursor:pointer;"`
    : '';

  return `${cardOpen}
      <div class="question-ref">
        <span ${refSpanAttrs}>
          ${displayRef}${hasVerse ? ` <span class="passage-icon">${ICONS.triggerInfo}</span>` : ''}
        </span>
        ${starBtn}
      </div>
      <div class="question-body">
        <div class="question-text">${questionText}${deeperBtn}</div>
      </div>
      ${textarea}
      ${actionRow}
    </div>`;
}


// ── IMAGE ───────────────────────────────────────────────────────────────────── "bluefish color-coding
// imgSrc is pre-resolved by the orchestrator (render-chapter.js) via the async
// StudyIDB.getImage() call. This function is fully synchronous.
// Caption and alt text are not language-keyed in the current schema — they are
// treated as single-language fields. If the schema adds caption1/caption2 in
// future, resolveText(el, activeLang, 'caption') can replace el.caption here.

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

  // Caption: rendered via renderFormatted() so HTML, markdown, and plainText
  // are all supported.
  const captionHtml = caption
    ? renderFormatted(caption, el.format)
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
// All display fields (eyebrow, term, question) are now language-keyed in
// multilingual studies (eyebrow1/2/3, term1/2/3, question1/2/3).
// The answer field (eyebrow, term, answer) shown in the QA modal is also
// language-keyed and stored on the element as answer1/2/3.
// resolveText handles both multilingual and mono-lingual studies transparently.

function renderCallout(ctx) {
  const { el, noPad, activeLang, langMap } = ctx;
  const safeId = el.elementId.replace(/'/g, "\\'");

  const eyebrow  = resolveText(el, activeLang, 'eyebrow',  langMap);
  const term     = resolveText(el, activeLang, 'term',     langMap);
  const question = resolveText(el, activeLang, 'question', langMap);

  if (el.subtype === 'general') {
    const btnLabel = el.buttonText || t('renderchapter_callout_general_btn');
    return `
      <div class="gen-callout-card"${noPad}>
        <div class="gen-callout-eyebrow">${eyebrow}</div>
        <div class="gen-callout-body">
          <div class="gen-callout-term">${term}</div>
          <div class="gen-callout-question">${question}</div>
          <button class="gen-callout-btn" onclick="openQaModalFromElement('${safeId}', '${activeLang}')">
            ${btnLabel}
          </button>
        </div>
      </div>`;
  }

  if (el.subtype === 'misunderstanding') {
    const btnLabel = el.buttonText || t('renderchapter_callout_misunderstanding_btn');
    return `
      <div class="qa-callout-card"${noPad}>
        <div class="qa-callout-eyebrow">${eyebrow}</div>
        <div class="qa-callout-body">
          <div class="qa-callout-term">${term}</div>
          <div class="qa-callout-question">${question}</div>
          <button class="qa-callout-btn" onclick="openQaModalFromElement('${safeId}', '${activeLang}')">
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
//
// chapterAnswers is passed as the third argument so renderLikertScale() can
// pre-populate saved radio selections from the already-loaded IDB record,
// avoiding a redundant IDB fetch.
 
function renderLikertScaleElement(ctx) {
  const { el, ch, chapterAnswers } = ctx;
  return renderLikertScale(el, ch.chapterNumber, chapterAnswers);
}
