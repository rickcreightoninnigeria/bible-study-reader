// ── TEXT-TO-SPEECH ────────────────────────────────────────────────────────────
// Speaks the given text using the Web Speech API. Strips HTML tags first.
// Cancels any current speech before starting, so calling speak() always
// interrupts whatever is playing. The active speak button (if any) is tracked
// in window._ttsBtn so it can be reset when speech ends or is cancelled.
//
// Long-text handling: the Web Speech API silently fails above ~4,000 characters
// on many WebView/browser implementations. Text is therefore split into
// sentence-sized chunks and queued sequentially. speechSynthesis.cancel()
// clears the entire queue, so ttsStop() still works correctly mid-passage.

const TTS_LONG_THRESHOLD = 200; // characters above which 'long' mode shows button
const TTS_CHUNK_MAX      = 200; // max characters per utterance chunk (safe across all known WebView limits)

function ttsAvailable() {
  return !!(window.Android?.speak) || !!(window.speechSynthesis);
}

function ttsShouldShow(plainTextLength) {
  const mode = appSettings.ttsMode || 'never';
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  return plainTextLength >= TTS_LONG_THRESHOLD;
}

// Decodes all named and numeric HTML entities (e.g. &mdash; &rsquo; &#8220;)
// by delegating to the browser/WebView HTML parser. <textarea> is used rather
// than <div> because it treats its content as plain text — no child HTML is
// parsed or executed — making it safe to assign arbitrary HTML strings to
// .innerHTML without XSS risk.
function _ttsDecodeEntities(str) {
  const el = document.createElement('textarea');
  el.innerHTML = str;
  return el.value;
}

function ttsStripHtml(html) {
  if (!html) return '';

  // 1. Decode all HTML entities first (handles &mdash; &rsquo; &hellip; etc.)
  html = _ttsDecodeEntities(html);

  // 1b. Convert numeric ranges (hyphen/en-dash/em-dash between numbers) to "to"
  //     Handles verse refs (3:15–16), plain ranges (15-16), and prefixed refs (pp. 15-16).
  //     \u2013 = en dash, \u2014 = em dash. Placed after entity decoding so that
  //     &ndash; / &mdash; are already resolved to their actual characters.
  html = html.replace(/(\d)\s*[-\u2013\u2014]\s*(\d)/g, '$1 to $2');

  return html
    // 2. Remove <sup> tags and everything inside them (verse numbers)
    .replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, '')

    // 3. Replace block tags (div, p, br, li) with a space to prevent words clumping
    .replace(/<(?:p|div|br|li|h[1-6])[^>]*>/gi, ' ')

    // 4. Strip all remaining HTML tags
    .replace(/<[^>]+>/g, '')

    // 5. Clean up whitespace: convert tabs/newlines/multiple spaces into one single space
    .replace(/\s+/g, ' ')
    .trim();
}

// Split plain text into chunks small enough for the Web Speech API.
// Splits on sentence boundaries first; falls back to comma boundaries, then
// hard word-wrap for any remaining oversized segments.
function ttsSplitIntoChunks(text, maxLen = TTS_CHUNK_MAX) {
  const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text];
  const chunks = [];

  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;

    if (s.length <= maxLen) {
      chunks.push(s);
    } else {
      // Sentence is too long — try splitting on commas first
      const parts = s.match(new RegExp(`.{1,${maxLen}}(?:\\s|$)`, 'g')) || [s];
      parts.forEach(p => { if (p.trim()) chunks.push(p.trim()); });
    }
  }

  return chunks;
}

function ttsSpeak(rawHtml, btn) {
  if (!ttsAvailable()) return;

  // If already speaking this button, stop
  if (window._ttsBtn === btn && (window.speechSynthesis?.speaking || window.Android?.isSpeaking?.())) {
    ttsStop();
    return;
  }

  ttsStop();

  const plainText = ttsStripHtml(rawHtml);

  if (window.Android?.speak) {
    // Android WebView path — delegates to native TTS.
    // Note: if very long passages still fail here, chunking needs to be
    // applied on the native (Java/Kotlin) side using TextToSpeech QUEUE_ADD.
    window.Android.speak(plainText);
  } else {
    // Browser path — Web Speech API, with chunked queuing to avoid silent
    // failures on long text and Chrome's background-tab pause bug.
    const chunks = ttsSplitIntoChunks(plainText);
    let index = 0;

    const speakNext = () => {
      if (index >= chunks.length || !window._ttsBtn) return; // finished or stopped externally
      const utterance = new SpeechSynthesisUtterance(chunks[index++]);
      utterance.onend = () => {
        if (index < chunks.length) {
          speakNext();
        } else {
          ttsReset(); // all chunks done
        }
      };
      utterance.onerror = (e) => {
        // 'interrupted' fires when ttsStop() cancels mid-chunk — not a real error
        if (e.error !== 'interrupted') ttsReset();
      };
      window.speechSynthesis.speak(utterance);
    };

    speakNext();
  }

  window._ttsBtn = btn;
  if (btn) { btn.innerHTML = ICONS.speakStop; btn.classList.add('speak-btn-active'); }
}

function ttsStop() {
  if (window.Android?.stopSpeaking) {
    window.Android.stopSpeaking();
  } else {
    window.speechSynthesis?.cancel(); // clears entire chunk queue
  }
  ttsReset();
}

function ttsReset() {
  if (window._ttsBtn) {
    window._ttsBtn.innerHTML = ICONS.speak;
    window._ttsBtn.classList.remove('speak-btn-active');
    window._ttsBtn = null;
  }
}