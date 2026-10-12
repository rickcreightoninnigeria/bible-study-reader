// ── IMAGE GALLERY ─────────────────────────────────────────────────────────────
// Renders subtype:'image-gallery' content blocks (Go Deeper / Leaders' Notes)
// as a thumbnail grid that opens a full-screen viewer with swipe, captions
// and credits.
//
// Block shape (in a goDeeperData / leadersNotesData chapter):
//   { "subtype": "image-gallery", "header": "Images",
//     "images": [ { "elementId": "ch01-el03" }                     // reuse an inline image
//               | { "src": "images/name.webp", "alt": "…",          // or a file in the zip
//                   "caption": "…", "provenance": "…" } ] }
//
// Image sources (never a URL from the JSON — only blob URLs of stored files):
//   • elementId – the study's inline image stored under {studyId}_{elementId}.
//     alt / caption / provenance missing on the gallery entry are inherited
//     from that inline image element; an explicit value on the entry wins.
//   • src       – images/<file> inside the .estudy, stored at install time by
//     storeGalleryImages() under {studyId}_gallery_<file>. Must match
//     GALLERY_SRC_RE; anything else is ignored.
//   If an entry has both, elementId wins. An entry whose image isn't stored is
//   skipped (console.warn); a gallery with no displayable image renders
//   nothing, so the block (and its header) is omitted.
//
// Blob URLs come from the chapter image cache (_imageBlobCache /
// _createBlobUrl in render-chapter.js / study-loader.js), so they are revoked
// with everything else when another study is loaded.
//
// Security: study text is only ever set via escapeHtml() or textContent, and
// the markup carries integer indices only (data-gallery / data-index), read
// by delegated listeners.
//
// Dependencies (runtime calls only):
//   StudyIDB                         – idb.js
//   _imageBlobCache                  – render-chapter.js
//   _createBlobUrl                   – study-loader.js
//   studyText, resolveMetaField      – render-chapter-elements.js
//   escapeHtml, t, ICONS             – utils.js / i18n.js / icons.js

// ── Limits ────────────────────────────────────────────────────────────────────
const GALLERY_MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // per gallery file in the zip
const GALLERY_SRC_RE          = /^images\/[A-Za-z0-9._-]{1,100}\.(webp|png|jpe?g)$/i;
const GALLERY_SWIPE_MIN_PX    = 50;                // horizontal travel for a swipe

// ── Image keys ────────────────────────────────────────────────────────────────

// Returns the file name of a valid gallery src ("images/x.webp" → "x.webp"),
// or '' when the src is not an allowed in-package image path.
function gallerySrcFileName(src) {
  if (typeof src !== 'string' || !GALLERY_SRC_RE.test(src) || src.includes('..')) return '';
  return src.slice('images/'.length);
}

// The IDB key suffix (after "{studyId}_") for a gallery entry, or ''.
function _galleryImageKey(entry) {
  if (!entry || typeof entry !== 'object') return '';
  if (typeof entry.elementId === 'string' && /^[A-Za-z0-9_.-]+$/.test(entry.elementId)) return entry.elementId;
  const file = gallerySrcFileName(entry.src);
  return file ? `gallery_${file}` : '';
}

// All image-gallery blocks on a chapter object, resolved for the language
// (mirrors the key discovery in _buildContentBlocksHtml()).
function _galleryBlocksOf(ch, activeLang, langMap) {
  const isMultilang = !!langMap && Object.keys(langMap).length > 0;
  const seen = new Set();
  const blocks = [];
  for (const key of Object.keys(ch || {})) {
    const base = isMultilang ? key.replace(/\d+$/, '') : key;
    if (seen.has(base)) continue;
    seen.add(base);
    const block = resolveMetaField(ch, base, activeLang, langMap);
    if (block && typeof block === 'object' && block.subtype === 'image-gallery') blocks.push(block);
  }
  return blocks;
}

// ── Install-time storage (called by study-loader.js) ──────────────────────────

// Every distinct gallery src file name in a study's goDeeperData and
// leadersNotesData chapters, across all language slots.
function galleryFileNamesOf(data) {
  const names = new Set();
  for (const section of [data && data.goDeeperData, data && data.leadersNotesData]) {
    for (const ch of (section && Array.isArray(section.chapters) ? section.chapters : [])) {
      for (const value of Object.values(ch || {})) {
        if (!value || typeof value !== 'object' || value.subtype !== 'image-gallery' || !Array.isArray(value.images)) continue;
        for (const entry of value.images) {
          // An entry with an elementId never uses its src (elementId wins).
          if (entry && typeof entry === 'object' && !entry.elementId) {
            const file = gallerySrcFileName(entry.src);
            if (file) names.add(file);
          }
        }
      }
    }
  }
  return [...names];
}

// Stores each gallery file from the zip under {studyId}_gallery_<file>.
// A missing or oversized file is skipped with a warning — it never fails the
// install. onWrite(key) is called before each write (for cleanup tracking).
async function storeGalleryImages(zip, data, studyId, onWrite = () => {}) {
  for (const file of galleryFileNamesOf(data)) {
    const entry = zip.file(`images/${file}`);
    if (!entry) {
      console.warn(`[gallery] images/${file} is referenced but not in the study file — skipped.`);
      continue;
    }
    const declared = (entry._data && entry._data.uncompressedSize) || 0;
    if (declared > GALLERY_MAX_IMAGE_BYTES) {
      console.warn(`[gallery] images/${file} is larger than ${GALLERY_MAX_IMAGE_BYTES} bytes — skipped.`);
      continue;
    }
    const blob = await entry.async('blob');
    if (blob.size > GALLERY_MAX_IMAGE_BYTES) {
      console.warn(`[gallery] images/${file} is larger than ${GALLERY_MAX_IMAGE_BYTES} bytes — skipped.`);
      continue;
    }
    const key = `${studyId}_gallery_${file}`;
    onWrite(key);
    await StudyIDB.setImage(key, blob);
  }
}

// ── Render-time ───────────────────────────────────────────────────────────────

// Gallery entries collected while building HTML, read by the viewer.
// Indexed by the data-gallery integer in the markup; reset on each page
// render by prefetchGalleryImages().
let _galleryRegistry = [];

// Fetches every gallery image of a chapter into the blob-URL cache, so the
// synchronous builder below can read them. Call before building the HTML.
async function prefetchGalleryImages(ch, activeLang, langMap) {
  _galleryRegistry = [];
  const studyId = window.activeStudyId;
  if (!studyId) return;
  const keys = new Set();
  for (const block of _galleryBlocksOf(ch, activeLang, langMap)) {
    for (const entry of (Array.isArray(block.images) ? block.images : [])) {
      const key = _galleryImageKey(entry);
      if (key && !_imageBlobCache.has(`${studyId}_${key}`)) keys.add(key);
    }
  }
  await Promise.all([...keys].map(async key => {
    try {
      const blob = await StudyIDB.getImage(`${studyId}_${key}`);
      if (blob) _imageBlobCache.set(`${studyId}_${key}`, _createBlobUrl(blob));
    } catch (e) {
      console.warn('[gallery] could not read image', key, e);
    }
  }));
}

// The inline image element (non-repeat) with this elementId, if any.
function _inlineImageElement(elementId) {
  for (const ch of (window.chapters || [])) {
    for (const el of (ch.elements || [])) {
      if (!el.repeatElement && el.type === 'image' && el.elementId === elementId) return el;
    }
  }
  return null;
}

// Builds the thumbnail grid for one gallery block, or '' if none of its images
// can be shown. Reads image URLs synchronously from the prefetched cache.
function buildGalleryHtml(block, classPrefix) {
  const studyId = window.activeStudyId;
  const items = [];
  for (const entry of (Array.isArray(block.images) ? block.images : [])) {
    const key = _galleryImageKey(entry);
    const url = key && _imageBlobCache.get(`${studyId}_${key}`);
    if (!url) {
      console.warn('[gallery] image not available, skipped:', entry && (entry.elementId || entry.src));
      continue;
    }
    const inline = entry.elementId ? _inlineImageElement(key) : null;
    const pick = field => {
      const own = typeof entry[field] === 'string' ? entry[field] : '';
      return own || (inline ? studyText(inline, field) || '' : '');
    };
    items.push({ url, alt: pick('alt'), caption: pick('caption'), provenance: pick('provenance') });
  }
  if (items.length === 0) return '';

  const gid = _galleryRegistry.push(items) - 1;
  const thumbs = items.map((it, i) => {
    const label = [it.caption || it.alt, it.provenance ? `${t('gallery_credit')}: ${it.provenance}` : '']
      .filter(Boolean).join(' — ');
    return `
      <button class="gallery-thumb" type="button" data-gallery="${gid}" data-index="${i}"
        aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
        <img class="gallery-thumb-img" src="${escapeHtml(it.url)}" alt="${escapeHtml(it.alt)}" loading="lazy">
        ${it.caption ? `<span class="gallery-thumb-caption">${escapeHtml(it.caption)}</span>` : ''}
      </button>`;
  }).join('');
  return `<div class="gallery-grid ${classPrefix}-gallery" role="group" aria-label="${escapeHtml(t('gallery_grid_label'))}">${thumbs}</div>`;
}

// ── Viewer ────────────────────────────────────────────────────────────────────
// One overlay element, created on first use. It carries the 'open' class
// while visible, which (a) makes router.js's _closeAnyOpenModal() close it on
// the system Back button / Escape instead of leaving the page, and
// (b) makes gestures.js ignore swipes so the Go Deeper tabs don't change
// behind it.

const _galleryViewer = { items: [], index: 0, opener: null, touchX: null };

function _galleryViewerEl() {
  let overlay = document.getElementById('galleryViewerOverlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'galleryViewerOverlay';
  overlay.className = 'gallery-viewer-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', t('gallery_viewer_label'));
  overlay.innerHTML = `
    <div class="gallery-viewer-top">
      <span class="gallery-viewer-counter" aria-live="polite"></span>
      <button type="button" class="gallery-viewer-close" aria-label="${escapeHtml(t('gallery_close'))}">${ICONS.close}</button>
    </div>
    <div class="gallery-viewer-stage">
      <button type="button" class="gallery-viewer-nav gallery-viewer-prev" aria-label="${escapeHtml(t('gallery_previous'))}">${ICONS.chevronRight}</button>
      <img class="gallery-viewer-img" alt="">
      <button type="button" class="gallery-viewer-nav gallery-viewer-next" aria-label="${escapeHtml(t('gallery_next'))}">${ICONS.chevronRight}</button>
    </div>
    <div class="gallery-viewer-text">
      <div class="gallery-viewer-caption"></div>
      <div class="gallery-viewer-credit"></div>
    </div>`;
  overlay.querySelector('.gallery-viewer-close').addEventListener('click', closeGalleryViewer);
  overlay.querySelector('.gallery-viewer-prev').addEventListener('click', () => _galleryShow(_galleryViewer.index - 1));
  overlay.querySelector('.gallery-viewer-next').addEventListener('click', () => _galleryShow(_galleryViewer.index + 1));
  // Swipe left/right. A second finger (pinch) cancels the swipe so native
  // zoom keeps working.
  overlay.addEventListener('touchstart', e => {
    _galleryViewer.touchX = e.touches.length === 1 ? e.touches[0].clientX : null;
  }, { passive: true });
  overlay.addEventListener('touchmove', e => { if (e.touches.length > 1) _galleryViewer.touchX = null; }, { passive: true });
  overlay.addEventListener('touchend', e => {
    if (_galleryViewer.touchX === null) return;
    const dx = e.changedTouches[0].clientX - _galleryViewer.touchX;
    _galleryViewer.touchX = null;
    if (Math.abs(dx) >= GALLERY_SWIPE_MIN_PX) _galleryShow(_galleryViewer.index + (dx < 0 ? 1 : -1));
  });
  overlay.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  _galleryShow(_galleryViewer.index - 1);
    if (e.key === 'ArrowRight') _galleryShow(_galleryViewer.index + 1);
  });
  document.body.appendChild(overlay);
  return overlay;
}

function _galleryShow(index) {
  const items = _galleryViewer.items;
  if (!items.length) return;
  _galleryViewer.index = Math.max(0, Math.min(items.length - 1, index));
  const it = items[_galleryViewer.index];
  const overlay = _galleryViewerEl();
  const img = overlay.querySelector('.gallery-viewer-img');
  img.src = it.url;
  img.alt = it.alt;
  overlay.querySelector('.gallery-viewer-counter').textContent =
    t('gallery_counter', { current: _galleryViewer.index + 1, total: items.length });
  overlay.querySelector('.gallery-viewer-caption').textContent = it.caption;
  overlay.querySelector('.gallery-viewer-credit').textContent =
    it.provenance ? `${t('gallery_credit')}: ${it.provenance}` : '';
  overlay.querySelector('.gallery-viewer-prev').disabled = _galleryViewer.index === 0;
  overlay.querySelector('.gallery-viewer-next').disabled = _galleryViewer.index === items.length - 1;
}

function openGalleryViewer(galleryIdx, index, opener) {
  const items = _galleryRegistry[galleryIdx];
  if (!items || !items.length) return;
  _galleryViewer.items  = items;
  _galleryViewer.opener = opener || null;
  const overlay = _galleryViewerEl();
  _galleryShow(index);
  overlay.classList.add('open');
  document.body.classList.add('gallery-viewer-open');   // locks body scroll
  overlay.querySelector('.gallery-viewer-close').focus();
}

function closeGalleryViewer() {
  const overlay = document.getElementById('galleryViewerOverlay');
  if (!overlay || !overlay.classList.contains('open')) return;
  overlay.classList.remove('open');
  document.body.classList.remove('gallery-viewer-open');
  const opener = _galleryViewer.opener;
  _galleryViewer.opener = null;
  if (opener && opener.isConnected) opener.focus();
}

document.addEventListener('click', e => {
  const thumb = e.target.closest && e.target.closest('.gallery-thumb[data-gallery]');
  if (!thumb) return;
  openGalleryViewer(parseInt(thumb.dataset.gallery, 10), parseInt(thumb.dataset.index, 10), thumb);
});
