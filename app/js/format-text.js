// ── FORMAT TEXT ───────────────────────────────────────────────────────────────
// Central text-formatting utilities: converts stored text into HTML for display.
//
// Supported format values (case-insensitive):
//   'HTML'      – sanitised with DOMPurify then injected as HTML
//   'markdown'  – parsed with markdown-it (html: false — raw HTML is escaped)
//   'plainText' – double-newline-delimited paragraphs wrapped in <p> tags
//                 (any unrecognised format string also falls through to this)
//
// NOTE: markdown-it runs with html: false, so raw HTML in markdown source is
// escaped rather than rendered. If html: true is ever enabled, pipe the output
// through DOMPurify.sanitize(..., _PURIFY_CONFIG) before returning it.
//
// Dependencies (must be loaded before this file):
//   purify.min.js        – window.DOMPurify  (must load BEFORE this file)
//   markdown-it.min.js   – window.markdownit constructor

// ── DOMPURIFY CONFIG ──────────────────────────────────────────────────────────
// Applied to all HTML-format study content before it reaches the DOM.
// Restricts the tag/attribute set to what study content legitimately needs:
// rich text formatting, links, and superscript footnote buttons.
// Inline event handlers (onclick, onerror, …) and data-* attributes are
// stripped, so even a malicious .estudy file authored by a third party cannot
// inject executable code through HTML-format fields.
//
// If you ever need to allow additional tags (e.g. <table>) for a new element
// type, add them to ALLOWED_TAGS rather than loosening the config globally.
const _PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'b', 'i', 'em', 'strong', 'u', 's', 'p', 'br',
    'ul', 'ol', 'li', 'blockquote',
    'h1', 'h2', 'h3', 'h4',
    'a', 'span', 'sup', 'sub', 'button',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'id', 'onclick'],
  ALLOW_DATA_ATTR: false,
};

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
// that is not recognised.
//
// Previously defined in render-pages.js; centralised here so both
// render-elements.js and render-pages.js share one implementation.
function renderParas(text) {
  return text.split('\n\n').map(p => `<p>${p}</p>`).join('');
}

// ── expandFootnoteMarkers(text, footnotes) ────────────────────────────────────
// Pre-pass that replaces [[fn:N]] markers in text with superscript buttons
// that open openFootnoteModal(). Called by renderFormatted() when a footnotes
// array is supplied. Runs before markdown-it so the markers are not escaped.
//
// @param {string}   text      - Raw content string containing [[fn:N]] markers.
// @param {Array}    footnotes - Array of { id: number, body: string } objects.
// @returns {string} Text with markers replaced by <sup><button>…</button></sup>.
function expandFootnoteMarkers(text, footnotes) {
  if (!footnotes || !footnotes.length) return text;
  return text.replace(/\[\[fn:(\d+)\]\]/g, (_, n) => {
    const num = parseInt(n, 10);
    const fn  = footnotes.find(f => f.id === num);
    if (!fn) return `<sup>${n}</sup>`;
    // Sanitise the footnote body first, then escape for the inline onclick string.
    // DOMPurify runs before the manual quote-escaping so the escaping step only
    // sees the already-clean output — not raw study-author content.
    const cleanBody = DOMPurify.sanitize(fn.body || '', _PURIFY_CONFIG);
    const safeBody = cleanBody
      .replace(/\\/g, '\\\\')
      .replace(/'/g,  "\\'")
      .replace(/"/g,  '&quot;');
    return `<sup><button class="footnote-btn" onclick="openFootnoteModal('Note\u00a0${n}', '${safeBody}')">${n}</button></sup>`;
  });
}

// ── renderFormatted(text, format, footnotes) ─────────────────────────────────
// Master formatting entry point. Accepts a raw string and a format identifier
// and returns an HTML string ready for innerHTML injection.
//
// If a footnotes array is supplied, [[fn:N]] markers in the text are expanded
// into superscript buttons (via expandFootnoteMarkers()) before formatting.
// This pre-pass runs before markdown-it so the markers are never escaped.
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
// NOTE: markdown-it is used with html: false (the default), meaning any raw
// HTML embedded in a markdown string will be escaped rather than rendered.
// This is intentional. If html: true is ever enabled to allow inline HTML
// within markdown, apply DOMPurify.sanitize(_md.render(processed), _PURIFY_CONFIG)
// instead of the bare _md.render(processed) call below.
function renderFormatted(text, format, footnotes) {
  if (!text) return '';
  const processed = footnotes ? expandFootnoteMarkers(text, footnotes) : text;
  const fmt = (format || 'plainText').toLowerCase();
  if (fmt === 'html')     return DOMPurify.sanitize(processed, _PURIFY_CONFIG);
  if (fmt === 'markdown') return _md.render(processed);
  return renderParas(processed);
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
// For 'HTML' and 'plainText': each item is wrapped in a <p> tag.
//
// Parameters:
//   items  {string[]}  Array of paragraph strings.
//   format {string}    Format identifier (see renderFormatted above).
function renderFormattedArray(items, format) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const fmt = (format || 'plainText').toLowerCase();
  if (fmt === 'markdown') {
    return items.map(item => _md.render(item || '')).join('');
  }
  // HTML and plainText: wrap each item in <p>
  // HTML items are sanitised individually before wrapping so each item's
  // content is clean before it is concatenated into the final string.
  if (fmt === 'html') {
    return items.map(item => `<p>${DOMPurify.sanitize(item || '', _PURIFY_CONFIG)}</p>`).join('\n');
  }
  return items.map(item => `<p>${item || ''}</p>`).join('\n');
}
