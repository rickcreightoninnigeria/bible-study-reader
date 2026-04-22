// ── VOICE INPUT ───────────────────────────────────────────────────────────────

// Returns true if any voice input mechanism is available on this device.
// Checked once at render time to decide whether to show mic buttons at all.
function voiceInputAvailable() {
  return (window.Android && typeof window.Android.startVoiceInput === 'function')
      || !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Called by the mic button on any answer field.
// Priority: Android native bridge → Web Speech API → keyboard fallback toast.
function startVoiceInput(btn) {
  const card     = btn.closest('.question-card');
  const textarea = card ? card.querySelector('.answer-field') : null;
  if (!textarea) return;

  window._voiceTarget = textarea;

  // ── Path 1: Android native bridge ──────────────────────────────────────────
  if (window.Android && typeof window.Android.startVoiceInput === 'function') {
    btn.classList.add('mic-btn-active');
    btn.innerHTML = ICONS.micStop;
    window._voiceBtn = btn;
    window.Android.startVoiceInput();
    return;
  }

  // ── Path 2: Web Speech API ──────────────────────────────────────────────────
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    if (window._voiceRecogniser) {
      window._voiceRecogniser.stop();
      return;
    }

    const rec = new SR();
    rec.lang            = 'en-US';
    rec.interimResults  = false;
    rec.maxAlternatives = 1;

    window._voiceRecogniser = rec;
    btn.classList.add('mic-btn-active');
    btn.innerHTML = ICONS.micStop;
    window._voiceBtn = btn;

    rec.onresult = e => receiveVoiceTranscript(e.results[0][0].transcript);
    rec.onerror  = e => {
      console.warn('Speech recognition error:', e.error);
      resetVoiceBtn();
      if (e.error === 'not-allowed') showToast({ message: t('voice_error_mic_denied'), isManual: false });
    };
    rec.onend = () => {
      window._voiceRecogniser = null;
      resetVoiceBtn();
    };

    rec.start();
    return;
  }

  // ── Path 3: Neither available ───────────────────────────────────────────────
  showToast({ message: t('voice_error_no_api'), isManual: false });
}

// Called by the Android bridge (Kotlin side, via evaluateJavascript) or by the Web Speech
// API onresult handler when a transcript is ready.
function receiveVoiceTranscript(transcript) {
  resetVoiceBtn();
  const textarea = window._voiceTarget;
  if (!textarea) return;

  const current = textarea.value;
  textarea.value = current ? current.trimEnd() + ' ' + transcript : transcript;

  autoResize(textarea);
  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));

  window._voiceTarget = null;
}

// Resets the mic button to its idle state after recording ends.
function resetVoiceBtn() {
  const btn = window._voiceBtn;
  if (btn) {
    btn.classList.remove('mic-btn-active');
    btn.innerHTML = ICONS.mic;
    window._voiceBtn = null;
  }
  window._voiceRecogniser = null;
}
