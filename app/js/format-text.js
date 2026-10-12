// ── FORMAT TEXT ───────────────────────────────────────────────────────────────
// Central text-formatting utilities: converts stored text into HTML for display.
//
// Supported format values (case-insensitive):
//   'HTML'      – sanitised with DOMPurify then injected as HTML
//   'markdown'  – parsed with markdown-it (html: false — raw HTML is escaped)
//   'plainText' – double-newline-delimited paragraphs, sanitised, in <p> tags
//                 (any unrecognised format string also falls through to this)
//
// Every path is sanitised with _PURIFY_CONFIG before it is returned —
// markdown-it's output included, as defence in depth (it runs with html: false,
// so raw HTML in markdown source is escaped anyway).
//
// Dependencies (must be loaded before this file):
//   purify.min.js        – window.DOMPurify  (must load BEFORE this file)
//   markdown-it.min.js   – window.markdownit constructor
//   openFootnoteModal    – modals.js (runtime call only, from the click listener)

// ── DOMPURIFY CONFIG ──────────────────────────────────────────────────────────
// Applied to all formatted study content before it reaches the DOM.
// Restricts the tag/attribute set to what study content legitimately needs:
// rich text formatting and links. Inline event handlers (onclick, onerror, …),
// id (authored ids could collide with the app's own: #toast, #chapterMenu, …)
// and data-* attributes are all stripped, so a malicious .estudy file authored
// by a third party cannot inject executable code through formatted fields.
//
// Footnote buttons are NOT authored content: expandFootnoteMarkers() adds them
// after sanitising, as data-driven buttons with no inline handler.
//
// If you ever need to allow additional tags (e.g. <table>) for a new element
// type, add them to ALLOWED_TAGS rather than loosening the config globally.
const _PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'b', 'i', 'em', 'strong', 'u', 's', 'p', 'br',
    'ul', 'ol', 'li', 'blockquote',
    'h1', 'h2', 'h3', 'h4',
    'a', 'span', 'sup', 'sub',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
  ALLOW_DATA_ATTR: false,
};

// ── LOAD-TIME DOMPURIFY CONFIG ────────────────────────────────────────────────
// Used by sanitizeStudyData() in study-loader.js, which cleans every string in
// a study as it is loaded — including the many fields (question text, titles,
// Likert statements, …) that are inserted into the page without passing
// through renderFormatted(). It starts from DOMPurify's defaults (which remove
// scripts, event handlers and javascript: URLs) rather than the narrow
// allowlist above, because authors legitimately use tables, <div>, <cite> and
// <mark> in those fields and narrowing here would visibly strip them.
// On top of the defaults it removes ids (collisions with app ids), <style>
// (could restyle the whole app) and form controls (an injected
// <textarea class="answer-field"> would be picked up by the save code).
const _LOAD_PURIFY_CONFIG = {
  FORBID_ATTR: ['id'],
  FORBID_TAGS: ['style', 'form', 'input', 'textarea', 'select', 'button'],
};

// Every authored link that opens a new tab gets rel="noopener noreferrer", so
// the opened page cannot reach back into the app via window.opener. Registered
// once; DOMPurify runs hooks for every sanitize() call, whatever the config.
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A' && node.hasAttribute('target')) {
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

function sanitizeHtml(html) {
  return DOMPurify.sanitize(html || '', _PURIFY_CONFIG);
}

// ── MARKDOWN-IT INSTANCE ─────────────────────────────────────────────────────
// Initialised once and reused. Options:
//   html:    false  – escape raw HTML in source (safe default; see note above)
//   breaks:  false  – single newlines are not converted to <br>
//                     (double-newline paragraph breaks are handled by the
//                     markdown-it parser in the normal way)
//   linkify: true   – bare URLs in text are auto-linked
const _md = window.markdownit({
  html:    false,
  breaks:  false,
  linkify: true,
});


// ── renderParas(text) ─────────────────────────────────────────────────────────
// Converts a double-newline-delimited plain-text string into a series of <p>
// tags. Single newlines within a paragraph are preserved as-is (not <br>).
//
// This is the rendering path for format: 'plainText' and for any format value
// that is not recognised. Each paragraph is sanitised rather than escaped:
// authors put <b>…</b> and entities like &ldquo; in plainText fields and expect
// them to render, but nothing executable may get through.
function renderParas(text) {
  return text.split('\n\n').map(p => `<p>${sanitizeHtml(p)}</p>`).join('');
}

// ── FOOTNOTES ─────────────────────────────────────────────────────────────────
// expandFootnoteMarkers(html, footnotes) replaces [[fn:N]] markers in
// already-rendered, already-sanitised HTML with superscript buttons:
//   <sup><button class="footnote-btn" data-fn-key="K">N</button></sup>
// The footnote body is not embedded in the markup. It is sanitised and kept in
// _footnoteBodies under key K, and one delegated click listener (below) opens
// it. Building a JS string literal inside an onclick attribute instead broke on
// any newline or U+2028 in a footnote body, and required onclick to be allowed
// through the sanitiser.
//
// It runs AFTER formatting so that markdown-it (html: false) never sees the
// button markup — run before, the button was escaped into visible text.
//
// @param {string} html      - Rendered HTML still containing [[fn:N]] markers.
// @param {Array}  footnotes - Array of { id: number, body: string } objects.
// @returns {string} HTML with markers replaced by footnote buttons.
const _footnoteBodies = new Map();
let _footnoteKeySeq = 0;

function expandFootnoteMarkers(html, footnotes) {
  if (!footnotes || !footnotes.length) return html;
  return html.replace(/\[\[fn:(\d+)\]\]/g, (_, n) => {
    const num = parseInt(n, 10);
    const fn  = footnotes.find(f => f.id === num);
    if (!fn) return `<sup>${n}</sup>`;
    const key = String(++_footnoteKeySeq);
    _footnoteBodies.set(key, { title: `Note\u00a0${num}`, body: sanitizeHtml(fn.body) });
    return `<sup><button class="footnote-btn" data-fn-key="${key}">${num}</button></sup>`;
  });
}

document.addEventListener('click', e => {
  const btn = e.target.closest && e.target.closest('.footnote-btn[data-fn-key]');
  if (!btn) return;
  const fn = _footnoteBodies.get(btn.dataset.fnKey);
  if (fn) openFootnoteModal(fn.title, fn.body);
});

// ── renderFormatted(text, format, footnotes) ─────────────────────────────────
// Master formatting entry point. Accepts a raw string and a format identifier
// and returns an HTML string ready for innerHTML injection.
//
// If a footnotes array is supplied, [[fn:N]] markers are expanded into
// superscript buttons (via expandFootnoteMarkers()) after formatting and
// sanitising, so the generated buttons are neither escaped nor stripped.
//
// Parameters:
//   text      {string}  The raw content string. Returns '' if falsy.
//   format    {string}  The format identifier from the JSON ('HTML', 'markdown',
//                       'plainText', etc.). Case-insensitive. Defaults to
//                       'plainText' if absent or unrecognised.
//   footnotes {Array=}  Optional. Array of { id: number, body: string } objects
//                       from the chapter's footnotes field. Omit (or pass null)
//                       for callers that have no footnotes — existing behaviour
//                       is unchanged.
//
// Usage:
//   renderFormatted(el.text, el.format)
//   renderFormatted(body, ch.format || d.format)              // leaders notes / go-deeper (no footnotes)
//   renderFormatted(body, blockFormat, ch.footnotes)          // go-deeper blocks with footnotes
function renderFormatted(text, format, footnotes) {
  if (!text) return '';
  const fmt = (format || 'plainText').toLowerCase();
  let html;
  if (fmt === 'html')          html = sanitizeHtml(text);
  // markdown-it escapes raw HTML (html: false); sanitising its output as well
  // is defence in depth in case that option is ever changed.
  else if (fmt === 'markdown') html = sanitizeHtml(_md.render(text));
  else                         html = renderParas(text);
  // Markers are plain text, so they survive all three paths unchanged.
  return footnotes ? expandFootnoteMarkers(html, footnotes) : html;
}

// ── renderFormattedArray(items, format) ──────────────────────────────────────
// Renders an array of strings where each item is an independent paragraph.
// Used for intro fields in leadersNotesData and goDeeperData, which are
// stored as arrays of paragraph strings rather than a single block of text.
//
// For 'markdown' format: each item is parsed as markdown individually, so
// markdown syntax is honoured within each paragraph. Adjacent items are
// separated by the whitespace markdown-it adds naturally between block elements.
//
// For 'HTML' and 'plainText': each item is sanitised and wrapped in a <p> tag.
//
// Parameters:
//   items  {string[]}  Array of paragraph strings.
//   format {string}    Format identifier (see renderFormatted above).
function renderFormattedArray(items, format) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const fmt = (format || 'plainText').toLowerCase();
  if (fmt === 'markdown') {
    return items.map(item => sanitizeHtml(_md.render(item || ''))).join('');
  }
  // HTML and plainText: wrap each item in <p>, sanitising each item first.
  // plainText is sanitised rather than escaped for the reason given on
  // renderParas() above.
  return items.map(item => `<p>${sanitizeHtml(item)}</p>`).join('\n');
}
