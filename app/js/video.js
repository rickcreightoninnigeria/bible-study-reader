// ── VIDEOS ────────────────────────────────────────────────────────────────────
// A study can point to a video (for example a BibleProject overview), as a
// `video` element in a chapter or a `video` block in Go Deeper / Leaders'
// Notes (STUDY-FORMAT.md). Nothing is bundled or embedded: the card offers
//
//   ▶ Play from my phone   a copy the reader has linked (Android), played in
//                          the phone's own video player, free and offline
//   ▶ Watch online         the url, opened outside the app, with the data
//                          cost shown on the card (and explained once)
//   📁 I have this video    links a copy already on the phone, for example one
//                          a leader downloaded on Wi-Fi and shared by Xender
//   ⬇ Download (Wi-Fi)     the author's downloadUrl, when given
//
// Android keeps permission to a linked file (Storage Access Framework; bridge
// pickVideoFile / playVideoFile / releaseVideoFile in the Kotlin wrapper), so
// the reader links it once. Links are remembered per video url
// (localStorage VIDEO_FILES_KEY), so a video linked in one study plays in any
// study that uses the same video. Browsers keep no permission to files, so
// there the reader picks the file each time and it plays in the page.
//
// Card fields travel in data-* attributes, so the buttons need no registry.

const VIDEO_FILES_KEY        = 'bsr_video_files';
const VIDEO_DATA_TIP_KEY     = 'bsr_video_data_tip_seen';
const VIDEO_DOWNLOAD_TIP_KEY = 'bsr_video_download_tip_seen';
const VIDEO_MB_PER_MINUTE    = 8;      // streaming at about 480p

function _hasVideoBridge() {
  return !!(window.Android && typeof window.Android.pickVideoFile === 'function'
    && typeof window.Android.playVideoFile === 'function');
}

function _videoFiles() {
  try {
    const map = JSON.parse(localStorage.getItem(VIDEO_FILES_KEY) || '{}');
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  } catch (_) { return {}; }
}

function _saveVideoFiles(map) {
  safeSetItem(VIDEO_FILES_KEY, JSON.stringify(map));
}

function _safeHttps(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'https:' ? u.href : '';
  } catch (_) { return ''; }
}

// Approximate data to watch online: the author's sizeMB, else from the length.
function videoEstimateMB(v) {
  const mb = Number(v.sizeMB);
  if (Number.isFinite(mb) && mb > 0) return Math.round(mb);
  const min = Number(v.minutes);
  return Number.isFinite(min) && min > 0 ? Math.max(1, Math.round(min * VIDEO_MB_PER_MINUTE)) : 0;
}

// v: { title, url, minutes, sizeMB, source, note, fileName, downloadUrl }
// (already resolved for the active language). Returns '' when there is
// nothing to watch or play.
function buildVideoCardHtml(v, noPad = '') {
  const url = _safeHttps(v.url);
  const downloadUrl = _safeHttps(v.downloadUrl);
  const title = String(v.title || '').trim() || t('video_eyebrow');
  const fileName = String(v.fileName || '').trim();
  if (!url && !downloadUrl && !fileName) return '';
  const linked = url ? _videoFiles()[url] : null;
  const mb = videoEstimateMB(v);
  const minutes = Number(v.minutes) > 0 ? t('video_minutes', { minutes: Math.round(Number(v.minutes)) }) : '';
  const meta = [minutes, url && mb ? t('video_size_stream', { mb }) : ''].filter(Boolean).join(' · ');
  const bridge = _hasVideoBridge();
  const btn = (cls, fn, label) => `<button class="video-btn ${cls}" onclick="${fn}(this)">${label}</button>`;
  const actions = [
    linked && bridge ? btn('video-btn-primary', 'videoPlayLinked', `▶ ${t('video_play_phone_btn')}`) : '',
    url ? btn(linked && bridge ? '' : 'video-btn-primary', 'videoWatchOnline', `▶ ${t('video_watch_online_btn')}`) : '',
    bridge && url ? btn('video-btn-quiet', 'videoLinkFile', `📁 ${t(linked ? 'video_change_file_btn' : 'video_link_file_btn')}`) : '',
    !bridge ? btn('video-btn-quiet', 'videoPlayFromDevice', `📁 ${t('video_play_device_btn')}`) : '',
    downloadUrl ? btn('video-btn-quiet', 'videoDownload', `⬇ ${t('video_download_btn')}`) : '',
  ].filter(Boolean).join('');
  const hint = linked && bridge
    ? t('video_linked', { name: linked.name || '' })
    : (fileName ? t('video_look_for', { name: fileName }) : '');
  const attr = (k, val) => (val ? ` data-${k}="${escapeHtml(String(val))}"` : '');
  return `
    <div class="video-card"${noPad}${attr('title', title)}${attr('url', url)}${attr('download', downloadUrl)}${attr('file', fileName)}${attr('mb', mb)}${attr('minutes', v.minutes)}${attr('source', v.source)}${attr('note', v.note)}>
      <div class="video-card-icon" aria-hidden="true">▶</div>
      <div class="video-card-main">
        <div class="video-card-eyebrow">${escapeHtml(t('video_eyebrow'))}${v.source ? ` · ${escapeHtml(String(v.source))}` : ''}</div>
        <div class="video-card-title">${escapeHtml(title)}</div>
        ${meta ? `<div class="video-card-meta">${escapeHtml(meta)}</div>` : ''}
        ${v.note ? `<div class="video-card-note">${escapeHtml(String(v.note))}</div>` : ''}
        <div class="video-card-actions">${actions}</div>
        ${hint ? `<div class="video-card-hint">${escapeHtml(hint)}</div>` : ''}
        <div class="video-card-print">${escapeHtml(url || downloadUrl)}</div>
      </div>
    </div>`;
}

function _videoFromCard(el) {
  const card = el.closest('.video-card');
  const d = card ? card.dataset : {};
  return {
    card,
    v: { title: d.title, url: d.url, downloadUrl: d.download, fileName: d.file, sizeMB: d.mb, minutes: d.minutes, source: d.source, note: d.note },
  };
}

function _redrawVideoCard(card, v) {
  if (!card) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = buildVideoCardHtml(v);
  const fresh = tmp.firstElementChild;
  if (fresh) card.replaceWith(fresh);
}

function _openOutside(url) {
  if (window.Android && typeof window.Android.openUrl === 'function') window.Android.openUrl(url);
  else window.open(url, '_blank', 'noopener');
}

// ▶ Watch online — explains the data cost the first time.
async function videoWatchOnline(btn) {
  const { v } = _videoFromCard(btn);
  if (!v.url) return;
  if (navigator.onLine === false) {
    showToast({ message: t('video_offline'), isManual: true });
    return;
  }
  if (!localStorage.getItem(VIDEO_DATA_TIP_KEY)) {
    const { isConfirmed } = await Swal.fire({
      title: t('video_data_title'),
      text: t('video_data_body', { mb: Number(v.sizeMB) || '?' }),
      showCancelButton: true,
      confirmButtonText: t('video_data_watch_btn'),
      cancelButtonText: t('video_cancel'),
      reverseButtons: true,
    });
    if (!isConfirmed) return;
    safeSetItem(VIDEO_DATA_TIP_KEY, '1');
  }
  _openOutside(v.url);
}

// ⬇ Download (use Wi-Fi) — explains sharing the file the first time.
async function videoDownload(btn) {
  const { v } = _videoFromCard(btn);
  if (!v.downloadUrl) return;
  if (navigator.onLine === false) {
    showToast({ message: t('video_offline'), isManual: true });
    return;
  }
  if (!localStorage.getItem(VIDEO_DOWNLOAD_TIP_KEY)) {
    const { isConfirmed } = await Swal.fire({
      title: t('video_download_title'),
      text: t('video_download_body'),
      showCancelButton: true,
      confirmButtonText: t('video_download_go_btn'),
      cancelButtonText: t('video_cancel'),
      reverseButtons: true,
    });
    if (!isConfirmed) return;
    safeSetItem(VIDEO_DOWNLOAD_TIP_KEY, '1');
  }
  _openOutside(v.downloadUrl);
}

// 📁 Link a copy on the phone (Android). The wrapper opens the system file
// picker and calls onVideoFilePicked(requestId, uri, name) when it closes.
const _pendingVideoPicks = new Map();
let _videoPickCounter = 0;

function videoLinkFile(btn) {
  const { card, v } = _videoFromCard(btn);
  if (!v.url || !_hasVideoBridge()) return;
  const requestId = `v${Date.now()}_${++_videoPickCounter}`;
  _pendingVideoPicks.set(requestId, { url: v.url, cardTitle: v.title, v, card });
  window.Android.pickVideoFile(requestId);
}

function onVideoFilePicked(requestId, uri, name) {
  const pending = _pendingVideoPicks.get(requestId);
  _pendingVideoPicks.delete(requestId);
  if (!pending || !uri) return;
  const map = _videoFiles();
  const old = map[pending.url];
  if (old && old.uri !== uri && typeof window.Android?.releaseVideoFile === 'function') {
    // Free the old file's permission unless another video still uses it.
    if (!Object.entries(map).some(([k, f]) => k !== pending.url && f.uri === old.uri)) window.Android.releaseVideoFile(old.uri);
  }
  map[pending.url] = { uri, name: String(name || '').slice(0, 200), linkedAt: Date.now() };
  _saveVideoFiles(map);
  // Redraw every card for this video on the page (the same video can appear twice).
  document.querySelectorAll('.video-card').forEach(card => {
    if (card.dataset.url === pending.url) _redrawVideoCard(card, _videoFromCard(card).v);
  });
  showToast({ message: t('video_linked', { name: name || '' }), isManual: true });
}

// ▶ Play from my phone (Android): the phone's video player. If the file has
// been moved or deleted, offer to link it again.
async function videoPlayLinked(btn) {
  const { card, v } = _videoFromCard(btn);
  const f = _videoFiles()[v.url];
  if (!f || !_hasVideoBridge()) return;
  let ok = false;
  try { ok = window.Android.playVideoFile(f.uri) === true; } catch (_) { ok = false; }
  if (ok) return;
  const { isConfirmed } = await Swal.fire({
    icon: 'warning',
    title: t('video_missing_title'),
    text: t('video_missing_body'),
    showCancelButton: true,
    confirmButtonText: t('video_relink_btn'),
    cancelButtonText: t('video_cancel'),
    reverseButtons: true,
  });
  const map = _videoFiles();
  delete map[v.url];
  _saveVideoFiles(map);
  _redrawVideoCard(card, v);
  if (isConfirmed) {
    const fresh = [...document.querySelectorAll('.video-card')].find(c => c.dataset.url === v.url);
    if (fresh) videoLinkFile(fresh);
  }
}

// 📁 Play a copy on this device (browsers): pick the file, play it in the page.
function videoPlayFromDevice(btn) {
  const { v } = _videoFromCard(btn);
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/*';
  input.style.display = 'none';
  input.onchange = () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    const src = URL.createObjectURL(file);
    Swal.fire({
      title: escapeHtml(v.title || t('video_eyebrow')),
      html: `<video class="video-player" src="${src}" controls autoplay playsinline></video>`,
      width: 'min(96vw, 900px)',
      confirmButtonText: t('video_close_btn'),
      didOpen: () => {
        const vid = document.querySelector('.video-player');
        if (vid) vid.onerror = () => showToast({ message: t('video_open_failed'), isManual: true });
      },
      willClose: () => {
        const vid = document.querySelector('.video-player');
        if (vid) vid.pause();
        URL.revokeObjectURL(src);
      },
    });
  };
  document.body.appendChild(input);
  input.click();
}
