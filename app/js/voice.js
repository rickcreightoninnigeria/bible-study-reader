// ── VOICE INPUT ───────────────────────────────────────────────────────────────

// Returns true if any voice input mechanism is available on this device.
// Checked once at render time to decide whether to show mic buttons at all.
function voiceInputAvailable() {
  return (window.Android && typeof window.Android.startVoiceInput === 'function')
      || !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Called by the mic button on any answer field.
// Priority: Android native bridge → Web Speech API → keyboard fallback toast.
//
// At recording-start we snapshot the three values needed to reconstruct the
// storage key (chapterNumber, data-type, data-index) into
// window._pendingVoiceTranscript. This is done here — before any async gap —
// so that if the user navigates away while recording is in flight the correct
// chapter and field are known when the transcript eventually arrives.
function startVoiceInput(btn) {
  const card     = btn.closest('.question-card');
  const textarea = card ? card.querySelector('.answer-field') : null;
  if (!textarea) return;

  window._voiceTarget = textarea;

  // Snapshot the stable identifiers needed to recover the transcript if the
  // user navigates away before recording finishes. currentChapter is read now
  // (synchronously, before any activity switch) so it reflects the chapter
  // the user was actually on when they tapped the mic.
  const ch = chapters[currentChapter];
  window._pendingVoiceTranscript = ch ? {
    chapterNumber: ch.chapterNumber,
    type:          textarea.dataset.type,
    index:         textarea.dataset.index,
    text:          null,   // filled in by receiveVoiceTranscript()
  } : null;

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
      window._pendingVoiceTranscript = null;
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
  window._pendingVoiceTranscript = null;
  showToast({ message: t('voice_error_no_api'), isManual: false });
}

// Called by the Android bridge (Kotlin side, via evaluateJavascript) or by the
// Web Speech API onresult handler when a transcript is ready.
//
// If the original textarea is still in the DOM, write directly to it (normal
// path). If it has been removed by a chapter navigation that occurred while
// recording was in flight, fall back to the pending-transcript recovery path:
// append the transcript to the localStorage value for that field and show a
// toast so the user knows their answer was not lost.
function receiveVoiceTranscript(transcript) {
  resetVoiceBtn();

  const textarea = window._voiceTarget;

  // ── Normal path: textarea is still attached ────────────────────────────────
  if (textarea && document.contains(textarea)) {
    const current = textarea.value;
    textarea.value = current ? current.trimEnd() + ' ' + transcript : transcript;

    autoResize(textarea);
    textarea.focus();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    window._voiceTarget            = null;
    window._pendingVoiceTranscript = null;
    return;
  }

  // ── Recovery path: textarea was removed by navigation ─────────────────────
  // The user navigated away while recording was in flight. Write the transcript
  // to IDB via a read-modify-write so it is picked up when renderChapter() next
  // loads this field. Uses the same async IIFE pattern as the blur auto-save
  // handler in save.js. The toast fires only after a successful IDB write so
  // the user is not told their answer was saved if the write failed.
  const pending = window._pendingVoiceTranscript;
  if (pending && pending.chapterNumber != null && pending.type && pending.index != null) {
    const studyId = window.activeStudyId;
    if (studyId) {
      (async () => {
        let record;
        try {
          record = await StudyIDB.getChapterAnswers(studyId, pending.chapterNumber);
        } catch (e) {
          console.warn('[voice recovery] IDB read failed; falling back to empty object.', e);
          record = {};
        }

        const fieldKey = answerFieldKey(pending.type, pending.index);
        const current  = record[fieldKey] || '';
        record[fieldKey] = current ? current.trimEnd() + ' ' + transcript : transcript;

        try {
          await StudyIDB.setChapterAnswers(studyId, pending.chapterNumber, record);
        } catch (e) {
          console.warn('[voice recovery] IDB write failed.', e);
          return;
        }

        // Clear the search cache so the recovered answer appears in future searches,
        // mirroring the cache-clear in saveAnswers() and the blur handler.
        if (typeof storageCache !== 'undefined') storageCache.clear();

        // Inform the user their answer was saved even though they navigated away.
        // i18n key: 'voice_transcript_saved_navigate_back'
        // Suggested English value: "Answer recorded — navigate back to see it"
        showToast({ message: t('voice_transcript_saved_navigate_back'), isManual: false });
      })();
    }
  }

  window._voiceTarget            = null;
  window._pendingVoiceTranscript = null;
}

// Resets the mic button to its idle state after recording ends.
function resetVoiceBtn() {
  const btn = window._voiceBtn;
  if (btn && document.contains(btn)) {
    btn.classList.remove('mic-btn-active');
    btn.innerHTML = ICONS.mic;
  }
  window._voiceBtn        = null;
  window._voiceRecogniser = null;
}
