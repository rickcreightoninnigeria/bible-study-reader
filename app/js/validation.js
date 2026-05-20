// ── VALIDATION ────────────────────────────────────────────────────────────────
// Two independent answer-validation strands in one module.
//
// ── STRAND 1: AI TUTOR ────────────────────────────────────────────────────────
// Provides inline conversational AI feedback on question answers.
//
// Entry point:  openAiTutorForCard(buttonEl)
//   Called by the checkAnswer button injected into each question card.
//   Finds the card, reads the current answer, and opens (or focuses) the
//   inline tutor thread below the textarea.
//
// Conversation format (stored in localStorage as part of the answer):
//   The tutor thread is appended to the answer text using sentinel lines:
//     \n\n--- AI Tutor ---\nYou: <user message>\nAI Tutor: <response>\n...
//   This means conversations travel with the answer through save/share/print.
//   The textarea always shows the full text; the tutor UI reads/writes it.
//
// API key obfuscation:
//   Keys stored in studyAiData.apiKey may be plain or obfuscated.
//   Obfuscated keys are prefixed with "bsr1." followed by a XOR+base64 payload.
//   _resolveApiKey() detects the prefix and decodes automatically.
//   Plain keys (no prefix) are used as-is, so existing studies keep working.
//   To generate an obfuscated key, call aiTutorObfuscateKey(plainKey) from
//   the browser console and paste the result into the study JSON.
//
//   ⚠ This obfuscation deters casual inspection only — it is NOT secure storage.
//   See the "Key obfuscation" section below for full details and the recommended
//   server-side proxy approach for real key protection.
//
// ── STRAND 2: LOCAL VALIDATE ──────────────────────────────────────────────────
// A lightweight, fully offline answer check for bible-study question cards.
//
// Entry point:  openLocalValidateForCard(buttonEl)
//   Called by the localValidate button injected into each bible-question card.
//   Reads the current answer, runs heuristic checks, and shows the result in
//   a self-dismissing toast. Nothing is persisted or appended to the answer.
//
// The local-validate icon is:
//   • Always visible on eligible cards (independent of AI availability)
//   • Disabled when the answer field is empty
//   • Hidden on non-bible question subtypes (reflection, deeper, etc.)
//
// sampleAnswer (optional, per question):
//   If a question element carries a sampleAnswer field in the study JSON, the
//   renderer should pass it as data-sample-answer on the .question-card element.
//   _localValidate reads it from the DOM if present and uses it for thematic
//   checking. It is never rendered visibly to the user.
//
// shortAnswerThreshold (optional, per question):
//   Overrides the default minimum word count used in the short-answer check
//   (step 2) for a specific question. Useful when a genuinely short answer is
//   the correct form of response (e.g. "name one word", "which option best
//   describes you?").
//
//   The renderer resolves the effective threshold and writes it as
//   data-short-answer-threshold on the .question-card element:
//
//   Monolingual studies:
//     element.shortAnswerThreshold  →  data-short-answer-threshold
//
//   Multilingual studies (languageN suffix convention):
//     Resolution order for the active language suffix N:
//       1. element.shortAnswerThresholdN  (per-language override)
//       2. element.shortAnswerThreshold   (cross-language default)
//       3. Attribute omitted              (built-in default logic applies)
//
//   Values:
//     Integer ≥ 1  — use as the minimum word count for this question
//     0            — disable the short-answer check entirely for this question
//     Absent       — use the existing default (35% of sampleAnswer length, ≤ 6)
//
// skipBibleVerseCheck (optional, per question):
//   Disables the passage-repetition check (step 4) for a specific question.
//   Use when the correct answer is expected to quote the passage directly —
//   e.g. "What does Paul say about X?" or "Copy out the memory verse."
//
//   Set as a boolean attribute on the .question-card element:
//     data-skip-bible-verse-check="true"  →  step 4 is skipped
//     Absent or any other value           →  step 4 runs as normal
//
//   Unlike shortAnswerThreshold, this is a simple boolean with no per-language
//   variant — it applies to all languages for the question.
//
// ── SHARED DEPENDENCIES (globals) ────────────────────────────────────────────
//   ICONS, showToast, chapters, currentChapter, storageKey,
//   saveAnswers, window.studyAiData, window.leadersNotesData, verseData
// ─────────────────────────────────────────────────────────────────────────────


/* [For Google API]
# System Instructions: AI Socratic Tutor

## Identity
You are a warm, thoughtful tutor for a Bible study series. You evaluate student answers using the Socratic method to encourage deep engagement without lecturing.

## Input Format
You will receive input in the following structured format: 
`Context: [Session Topic] | Study-specific Prompt: [The Prompt] | Question: [The Question] | Passage: [The Verse(s)] | Student Answer: [The Response]`

## Task
Evaluate the `Student Answer` based on the provided `Context`, `Question`, and `Passage`. 

## The Keyword Ban (Socratic Constraint)
* **Identify the "Win":** Internally identify the primary theological term, key person, or core concept that constitutes the "correct" answer based on the `Passage` and `Study-specific Prompt`.
* **The Restriction:** You are strictly **forbidden** from using that specific keyword or core concept in your response unless the student has already used it correctly.
* **The Redirection:** If the student is missing the point, point them to a specific verse number or a secondary phrase within the passage to help them discover the keyword themselves (e.g., "Look at the verb used in the middle of verse 4...").

## Response Protocols for "Passage-Based" Questions
Identify if the student has made one of these three errors and respond accordingly:
1. **Verbatim Copying:** If they just quote the verse, say: "That is the right verse, but I'm looking for your own explanation. Try answering the question in your own words using what that verse says."
2. **Insufficient Depth:** If the answer is too brief, say: "Can you expand on that a bit? I'd love to hear more of your thinking to make sure I'm following you."
3. **Off-Topic/Tangential:** Gently redirect. Point them back to the specific phrase in the passage and the heart of the question.

## Scoring & Feedback
* **Good Answer:** Provide warm, brief encouragement. Re-emphasize the key point they grasped to lock in the learning. Do not be sycophantic.
* **Partial Answer:** Affirm the correct portion, then ask a Socratic question to lead them to the missing piece without breaking the **Keyword Ban**.
* **NEVER** answer the question for them.

## Response Protocols for "Reflection" Questions
* Affirm honest engagement.
* Reflect their sentiment back to them to show you have "listened."
* Ask one (and only one) follow-up question to deepen the reflection.

## Formatting Constraints
* **Length:** 1 short paragraph (2 absolute max).
* **Tone:** Grounded, supportive, and peer-like. 
* **No "AI-speak":** Avoid "I'm here to help," "As an AI," or generic filler like "Great job on this session." Jump straight into the feedback.
*/


// ═════════════════════════════════════════════════════════════════════════════
// STRAND 1 — AI TUTOR
// ═════════════════════════════════════════════════════════════════════════════

// ── Constants ─────────────────────────────────────────────────────────────────

const AI_TUTOR_SEPARATOR  = '\n\n--- AI Tutor ---';
// const AI_TUTOR_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
const AI_TUTOR_API_URL    = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent';
const AI_TUTOR_KEY_PREFIX = 'bsr1.';

const AI_TUTOR_FALLBACK_SYSTEM =
  'You are a warm, thoughtful tutor for a Bible study series. ' +
  'You have been given the session context and the question the person was answering. ' +
  'Respond as a good tutor would: affirm honest engagement, reflect their answer back, ' +
  'and ask one good follow-up question if appropriate. ' +
  'Keep your response to 1–4 short paragraphs maximum. ' +
  'Do not lecture or give a sermon. Do not assume more than the person has said.';


// ── Key obfuscation ───────────────────────────────────────────────────────────
//
// Scheme: XOR each character of the plain key against a repeating passphrase,
// then base64-encode the result, then prepend the prefix "bsr1.".
//
// ⚠ SECURITY NOTICE — READ BEFORE USING IN PRODUCTION ⚠
// ────────────────────────────────────────────────────────
// This is NOT cryptographic security. It is shallow obfuscation only.
//
// Because this app runs entirely client-side, the passphrase (_AI_TUTOR_XOR_PASS),
// the prefix ("bsr1."), and both _xorString/_decodeKey functions are all delivered
// to the browser in plain text. Anyone who opens DevTools → Sources can:
//   1. Read _AI_TUTOR_XOR_PASS directly from this file.
//   2. Call aiTutorObfuscateKey() or _decodeKey() from the console to recover
//      any key stored in a .estudy file in under 10 seconds.
//
// What this DOES provide:
//   ✓ A key in a .estudy file is not immediately copy-pasteable.
//   ✓ Deters casual inspection of shared study JSON files.
//   ✓ Slightly raises the bar for non-technical users.
//
// What this does NOT provide:
//   ✗ Any protection against a motivated user or developer.
//   ✗ Any protection if DevTools access is possible (i.e. always, in a browser).
//   ✗ Rate-limiting, usage quotas, or key revocation.
//
// FOR REAL KEY PROTECTION, use a server-side proxy:
//   – Deploy a small server function (e.g. Firebase Function, Cloudflare Worker,
//     Vercel Edge Function) that holds the API key in a server environment variable.
//   – The client sends only the user's prompt to your proxy endpoint.
//   – The proxy attaches the key, forwards to Gemini, and returns the response.
//   – The key never leaves the server and is never visible in the browser.
//   – This is the only approach that provides meaningful API key protection.
//
// This obfuscation scheme should not be described or marketed as "secure".
// It is a convenience feature, not a security control.
//
// Passphrase is kept short and app-specific. Changing it would break all
// previously obfuscated keys, so treat it as fixed once deployed.

const _AI_TUTOR_XOR_PASS = 'bsrStudyApp2025';

function _xorString(str, pass) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    out += String.fromCharCode(
      str.charCodeAt(i) ^ pass.charCodeAt(i % pass.length)
    );
  }
  return out;
}

// Decodes an obfuscated key. Returns the plain key string.
// Throws if the base64 payload is malformed.
function _decodeKey(obfuscated) {
  const payload = obfuscated.slice(AI_TUTOR_KEY_PREFIX.length);
  const xored   = atob(payload);                           // base64 → XOR'd bytes
  return _xorString(xored, _AI_TUTOR_XOR_PASS);            // XOR back → plain key
}

// Resolves whatever is stored in studyAiData.apiKey to a usable plain key.
// If the value starts with the prefix, decode it; otherwise return as-is.
function _resolveApiKey(stored) {
  const s = (stored || '').trim();
  if (!s) return '';
  if (s.startsWith(AI_TUTOR_KEY_PREFIX)) {
    try {
      return _decodeKey(s);
    } catch (e) {
      console.error('[AI Tutor] Failed to decode obfuscated API key:', e);
      return ''; // treat as missing; API call will fail gracefully
    }
  }
  return s; // plain key — use as-is
}

// ── PUBLIC HELPER — call from browser console to generate obfuscated keys ─────
//
// Usage:
//   aiTutorObfuscateKey('AIzaSy...')
//   → "bsr1.XXXXXXXXXXXXXXXXXX"
//
// Copy the output and paste it as the apiKey value in your study JSON.
//
// ⚠ NOTE: The result is obfuscated, not encrypted. Anyone with access to this
// source file can decode it. See the "Key obfuscation" section above for the
// full security notice and the recommended server-side proxy alternative.
function aiTutorObfuscateKey(plainKey) {
  const xored   = _xorString(plainKey, _AI_TUTOR_XOR_PASS);
  const encoded = btoa(xored);
  return AI_TUTOR_KEY_PREFIX + encoded;
}


// ── Public API ────────────────────────────────────────────────────────────────

// Returns true if AI tutor should be shown (non-empty apiKey in studyAiData).
// Works for both plain and obfuscated keys.
function aiTutorAvailable() {
  const aiData = window.studyAiData || {};
  return !!(aiData.apiKey && aiData.apiKey.trim());
}

// Called by the checkAnswer button on a question card.
// buttonEl — the button DOM element that was tapped.
function openAiTutorForCard(buttonEl) {
  const card = buttonEl.closest('.question-card');
  if (!card) return;

  // If a tutor panel already exists on this card, just focus the input
  const existing = card.querySelector('.ai-tutor-panel');
  if (existing) {
    const inp = existing.querySelector('.ai-tutor-input');
    if (inp) inp.focus();
    return;
  }

  _buildTutorPanel(card);
}


// ── Panel builder ─────────────────────────────────────────────────────────────

function _buildTutorPanel(card) {
  const textarea  = card.querySelector('.answer-field');
  const elementId = textarea ? textarea.dataset.index : null;
  const ch        = chapters[currentChapter];

  // ── Read existing conversation from stored answer text ──────────────────────
  const fullText       = textarea ? textarea.value : '';
  const sepIdx         = fullText.indexOf(AI_TUTOR_SEPARATOR);
  const userAnswerOnly = sepIdx >= 0 ? fullText.slice(0, sepIdx).trim() : fullText.trim();
  const existingConvo  = sepIdx >= 0 ? fullText.slice(sepIdx + AI_TUTOR_SEPARATOR.length).trim() : '';

  // Parse existing conversation turns: [{role:'user'|'tutor', text}]
  const history = _parseHistory(existingConvo);

  // ── Build panel HTML ────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'ai-tutor-panel';
  panel.setAttribute('data-element-id', elementId || '');

  panel.innerHTML = `
    <div class="ai-tutor-header">
      <span class="ai-tutor-eyebrow">${t('validation_tutor_eyebrow')}</span>
      <button class="ai-tutor-close" title="${t('validation_tutor_close_title')}" onclick="this.closest('.ai-tutor-panel').remove()">${ICONS.close}</button>
    </div>
    <div class="ai-tutor-thread"></div>
    <div class="ai-tutor-composer">
      <textarea class="ai-tutor-input" placeholder="${t('validation_tutor_input_placeholder')}" rows="2"></textarea>
      <button class="ai-tutor-send" onclick="_aiTutorSend(this)">${ICONS.checkAnswer}</button>
    </div>`;

  // Append after the answer-action-row (last child of card before we added this)
  card.appendChild(panel);

  // ── Render any existing conversation ───────────────────────────────────────
  const thread = panel.querySelector('.ai-tutor-thread');
  history.forEach(turn => _appendTurn(thread, turn.role, turn.text));

  // ── Store context on panel for use by _aiTutorSend ─────────────────────────
  // (Must be set before any call to _aiTutorSend, including the auto-send below)
  panel._questionText   = _getQuestionText(card);
  panel._chapterContext = _buildChapterContext(ch);
  panel._history        = history;  // live reference, mutated by _aiTutorSend
  panel._elementId      = elementId;
  panel._textarea       = textarea;
  panel._card           = card;

  const inputEl = panel.querySelector('.ai-tutor-input');
  const sendBtn = panel.querySelector('.ai-tutor-send');

  // ── First-turn bootstrapping ────────────────────────────────────────────────
  if (history.length === 0 && userAnswerOnly) {
    // No prior conversation and the user already has an answer written —
    // send it immediately so they get feedback without an extra tap.
    _aiTutorSend(sendBtn, userAnswerOnly);
  } else {
    // Returning to an existing conversation: just focus the reply input.
    inputEl.focus();
  }
}


// ── Send / receive ────────────────────────────────────────────────────────────

// sendBtn      — the send button DOM element (used to locate the panel)
// textOverride — optional string; if provided, used as the message instead of
//                reading the input field. Used by the auto-send on first open.
async function _aiTutorSend(sendBtn, textOverride) {
  const panel    = sendBtn.closest('.ai-tutor-panel');
  const inputEl  = panel.querySelector('.ai-tutor-input');
  const thread   = panel.querySelector('.ai-tutor-thread');
  const userText = (textOverride !== undefined ? textOverride : inputEl.value).trim();
  if (!userText) return;

  // Disable UI while waiting
  inputEl.disabled = true;
  sendBtn.disabled = true;
  inputEl.value    = '';

  // Show user turn immediately
  _appendTurn(thread, 'user', userText);
  panel._history.push({ role: 'user', text: userText });

  // Show typing indicator
  const typingEl = _appendTyping(thread);

  try {
    const responseText = await _callGemini(
      panel._chapterContext,
      panel._questionText,
      panel._history
    );

    typingEl.remove();
    _appendTurn(thread, 'tutor', responseText);
    panel._history.push({ role: 'tutor', text: responseText });

    // Persist conversation back into the textarea + localStorage
    _persistConversation(panel._textarea, panel._history, panel._elementId);

  } catch (err) {
    typingEl.remove();
    // Full error is already logged by _callGemini; log again here only if
    // it is a non-HTTP error (network failure, JSON parse error, etc.)
    if (!err.httpStatus) console.error('[AI Tutor]', err);

    const status = err.httpStatus;
    let toastMsg;
    if (err.name === 'NetworkError' || err.message === 'Failed to fetch') {
      toastMsg = t('validation_tutor_err_network');
    } else if (status === 429) {
      toastMsg = t('validation_tutor_err_429');
    } else if (status === 401 || status === 403) {
      toastMsg = t('validation_tutor_err_auth');
    } else if (status === 404) {
      toastMsg = t('validation_tutor_err_404');
    } else if (status >= 500) {
      toastMsg = t('validation_tutor_err_500');
    } else if (status) {
      toastMsg = t('validation_tutor_err_status', { status });
    } else {
      toastMsg = t('validation_tutor_err_unknown');
    }
    showToast({ message: toastMsg, isManual: true });

    // Roll back the user turn so the conversation stays clean for a retry.
    // The AI tutor catch block no longer falls back to local validate — that
    // is now a separate, user-initiated strand with its own dedicated icon.
    panel._history.pop();

  } finally {
    inputEl.disabled = false;
    sendBtn.disabled = false;
    inputEl.focus();
    _autoResizeTutorInput(inputEl);
  }
}


// ── Gemini API call ───────────────────────────────────────────────────────────

async function _callGemini(chapterContext, questionText, history) {
  const aiData = window.studyAiData || {};
  const apiKey = _resolveApiKey(aiData.apiKey);
  const system = (aiData.aiTutorPrompt || AI_TUTOR_FALLBACK_SYSTEM).trim();

  if (!apiKey) {
    const err = new Error('No API key configured in studyAiData.apiKey');
    err.httpStatus = 403; // treated as "key problem" by the catch block
    throw err;
  }

  // Build the contents array for Gemini.
  //
  // Structure:
  //   [0] user  — system prompt + chapter context + question being studied
  //   [1] model — acknowledgement (simulates a system role, which the basic
  //               generateContent API does not have)
  //   [2..n]    — the actual conversation history, alternating user / model
  //
  // The full history (including the latest user turn just pushed by _aiTutorSend)
  // is appended after the setup pair, so the model always sees what to reply to.

  const systemSetup = [
    {
      role: 'user',
      parts: [{
        text:
          system +
          '\n\nSession context:\n' + chapterContext +
          '\n\nQuestion the student is working on:\n' + questionText
      }]
    },
    {
      role: 'model',
      // NOTE: This acknowledgement string is part of the Gemini API prompt
      // format and must remain in English. It is not a UI string.
      parts: [{ text: 'Understood. I have the context and the question. I am ready to respond to the student.' }]
    }
  ];

  // Map our internal role names ('tutor' / 'user') to Gemini's ('model' / 'user')
  const convoTurns = history.map(turn => ({
    role:  turn.role === 'tutor' ? 'model' : 'user',
    parts: [{ text: turn.text }]
  }));

  const body = {
    contents: [...systemSetup, ...convoTurns],
    generationConfig: {
      maxOutputTokens: 800,
      temperature:     0.7,
    }
  };

  const res = await fetch(`${AI_TUTOR_API_URL}?key=${encodeURIComponent(apiKey)}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body)
  });

  if (!res.ok) {
    // Parse the raw API message for the console log, but attach the HTTP
    // status separately so the catch block can map it to a short toast message.
    let rawMsg = `API error ${res.status}`;
    try {
      const errBody = await res.json();
      rawMsg = errBody?.error?.message || rawMsg;
    } catch (_) {}
    console.error('[AI Tutor] API error:', rawMsg);
    const err = new Error(rawMsg);
    err.httpStatus = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from AI tutor');
  return text.trim();
}


// ── Persistence ───────────────────────────────────────────────────────────────

// Rebuilds the full textarea value (user answer + conversation) and saves it.
function _persistConversation(textarea, history, elementId) {
  if (!textarea) return;

  // Separate out the user's original answer (everything before the separator)
  const fullText   = textarea.value;
  const sepIdx     = fullText.indexOf(AI_TUTOR_SEPARATOR);
  const answerOnly = sepIdx >= 0 ? fullText.slice(0, sepIdx).trim() : fullText.trim();

  if (history.length === 0) {
    textarea.value = answerOnly;
  } else {
    // NOTE: 'AI Tutor: ' and 'You: ' are storage-format sentinels parsed by
    // _parseHistory(). They must not be translated — they are not UI strings.
    const convoLines = history.map(t =>
      (t.role === 'tutor' ? 'AI Tutor: ' : 'You: ') + t.text
    ).join('\n\n');
    textarea.value = answerOnly + AI_TUTOR_SEPARATOR + '\n' + convoLines;
  }

  // Resize and save
  if (typeof autoResize === 'function') autoResize(textarea);
  saveAnswers(false);
}


// ── History parser ────────────────────────────────────────────────────────────

// Parses the stored conversation string back into [{role, text}] turns.
function _parseHistory(convoText) {
  if (!convoText || !convoText.trim()) return [];

  const turns  = [];
  // Split on blank lines that begin a new speaker label.
  // NOTE: 'You: ' and 'AI Tutor: ' are storage-format sentinels — not UI strings.
  const chunks = convoText.split(/\n\n(?=You: |AI Tutor: )/);

  chunks.forEach(chunk => {
    chunk = chunk.trim();
    if (chunk.startsWith('AI Tutor: ')) {
      turns.push({ role: 'tutor', text: chunk.slice('AI Tutor: '.length).trim() });
    } else if (chunk.startsWith('You: ')) {
      turns.push({ role: 'user',  text: chunk.slice('You: '.length).trim()      });
    }
  });

  return turns;
}


// ── Context builders ──────────────────────────────────────────────────────────

// Extracts the question text from the card DOM.
function _getQuestionText(card) {
  const el = card.querySelector('.question-text');
  return el ? el.innerText.trim() : '(question not found)';
}

// Builds a compact context string from the chapter's leaders notes (if available).
function _buildChapterContext(ch) {
  if (!ch) return 'No additional context available.';

  const lnd     = window.leadersNotesData || {};
  const chNotes = (lnd.chapters || []).find(c => c.chapterNumber === ch.chapterNumber);

  const parts = [];

  if (ch.chapterTitle) {
    parts.push('Chapter: ' + ch.chapterTitle);
  }

  if (chNotes) {
    if (chNotes.keyPoints) {
      parts.push('Key themes:\n' + _stripHtml(chNotes.keyPoints));
    }
    if (chNotes.pastorals) {
      parts.push('Pastoral context:\n' + _stripHtml(chNotes.pastorals));
    }
  }

  return parts.join('\n\n') || 'No additional context available.';
}


// ── DOM helpers (AI tutor) ────────────────────────────────────────────────────

function _appendTurn(thread, role, text) {
  const div = document.createElement('div');
  div.className = role === 'tutor'
    ? 'ai-tutor-turn ai-tutor-turn--tutor'
    : 'ai-tutor-turn ai-tutor-turn--user';

  const label = document.createElement('div');
  label.className   = 'ai-tutor-turn-label';
  // NOTE: 'AI Tutor' and 'You' here are display labels shown in the chat thread.
  label.textContent = role === 'tutor' ? t('validation_tutor_label_tutor') : t('validation_tutor_label_user');

  const body = document.createElement('div');
  body.className = 'ai-tutor-turn-body';
  // Render double-newlines as paragraph breaks
  body.innerHTML = text.split(/\n\n+/).map(p =>
    '<p>' + _escHtml(p.trim()) + '</p>'
  ).join('');

  div.appendChild(label);
  div.appendChild(body);
  thread.appendChild(div);
  thread.scrollTop = thread.scrollHeight;
  return div;
}

function _appendTyping(thread) {
  const div = document.createElement('div');
  div.className = 'ai-tutor-turn ai-tutor-turn--tutor ai-tutor-turn--typing';
  div.innerHTML = `
    <div class="ai-tutor-turn-label">${t('validation_tutor_label_tutor')}</div>
    <div class="ai-tutor-typing-dots"><span></span><span></span><span></span></div>`;
  thread.appendChild(div);
  thread.scrollTop = thread.scrollHeight;
  return div;
}

function _autoResizeTutorInput(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}


// ═════════════════════════════════════════════════════════════════════════════
// STRAND 2 — LOCAL VALIDATE
// ═════════════════════════════════════════════════════════════════════════════
//
// Lightweight offline answer checking for bible-study question cards.
// Triggered by a dedicated icon in the answer-action-row — completely
// independent of the AI tutor. Results appear in a short-lived toast only;
// nothing is persisted or appended to the answer.
//
// Question subtypes that local validate handles:
//   standard, header   — full heuristic checks + sampleAnswer thematic check
//
// Question subtypes that local validate skips (hidden icon):
//   reflection, deeper — these are personal/devotional; heuristic checks
//                        would be misleading or patronising
//
// sampleAnswer:
//   An optional, study-author-supplied model answer stored in the element JSON.
//   The renderer should write it as data-sample-answer on the .question-card
//   element IF it is present. _localValidate reads it from there if available.
//   It is never rendered visibly to the user anywhere in the UI.
//
// shortAnswerThreshold:
//   An optional per-question override for the minimum word count checked in
//   step 2. The renderer resolves the effective value (honouring the
//   shortAnswerThresholdN / shortAnswerThreshold multilingual fallback chain)
//   and writes it as data-short-answer-threshold on the .question-card element.
//   0 = disable the short-answer check entirely for this question.
//   Absent = use the built-in default (35% of sampleAnswer length, capped at 6).
//
// ── Eligibility check ─────────────────────────────────────────────────────────

// Question subtypes that local validate should run on.
// Add further eligible subtypes here as needed.
const _LV_ELIGIBLE_SUBTYPES = new Set(['standard', '']);

// Returns true if this card should show the local validate icon.
// Rules (either condition is sufficient):
//   (a) type=question, subtype is in _LV_ELIGIBLE_SUBTYPES
//   (b) type=question, any subtype, where data-linked-passage is present and non-empty
function localValidateEligible(card) {
  if (!card) return false;
  const subtype       = (card.dataset.questionSubtype || '').toLowerCase().trim();
  const linkedPassage = (card.dataset.linkedPassage   || '').trim();
  return _LV_ELIGIBLE_SUBTYPES.has(subtype) || linkedPassage.length > 0;
}


// ── Public entry point ────────────────────────────────────────────────────────

// Scrolls the card to the centre of the viewport, then shows the toast.
// Centralising first ensures the toast never obscures the answer field,
// regardless of where on the screen the card started.
function _localValidateShowFeedback(card, feedback) {
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  showToast({ message: feedback, duration: 10000, elementId: 'validate-toast', isManual: true });
}

// Called by the localValidate button injected into each eligible question card.
// buttonEl — the button DOM element that was tapped.
function openLocalValidateForCard(buttonEl) {
  const card = buttonEl.closest('.question-card');
  if (!card) return;

  const textarea = card.querySelector('.answer-field');
  const answer   = textarea ? textarea.value.trim() : '';

  // Guard: icon should be disabled when empty, but double-check here
  if (!answer) return;

  const questionText          = _getQuestionText(card);
  const sampleAnswer          = card.dataset.sampleAnswer || null;
  const questionHint          = card.dataset.questionHint || null;
  const shortAnswerThreshold  = card.dataset.shortAnswerThreshold ?? null;
  const skipBibleVerseCheck   = card.dataset.skipBibleVerseCheck === 'true';

  const feedback = _localValidate(answer, questionText, card, sampleAnswer, questionHint, shortAnswerThreshold, skipBibleVerseCheck);

  // feedback is always a non-null string (either a problem message or a
  // positive confirmation). Scroll card to centre first so the toast
  // never covers the answer field, then display.
  _localValidateShowFeedback(card, feedback);
}

// Called from the textarea's blur handler (in render-chapter.js) when
// localValidate mode is 'auto'. Runs validation only if the answer has
// changed since the last time validation ran on this card.
//
// We store the last-validated answer text in a data attribute on the card
// so we can diff on the next blur without any external state.
function localValidateAutoTrigger(textareaEl) {
  if ((appSettings.localValidateMode || 'manual') !== 'auto') return;

  const card = textareaEl.closest('.question-card');
  if (!card) return;

  // Only fire if card has a validate button (i.e. it is eligible)
  const lvBtn = card.querySelector('.local-validate-btn');
  if (!lvBtn) return;

  const answer = textareaEl.value.trim();
  if (!answer) return;                            // nothing to check

  const lastValidated = card.dataset.lvLastAnswer ?? null;
  if (answer === lastValidated) return;           // answer unchanged — skip

  // Record the answer we are about to validate so next blur can diff
  card.dataset.lvLastAnswer = answer;

  const questionText          = _getQuestionText(card);
  const sampleAnswer          = card.dataset.sampleAnswer || null;
  const questionHint          = card.dataset.questionHint || null;
  const shortAnswerThreshold  = card.dataset.shortAnswerThreshold ?? null;
  const skipBibleVerseCheck   = card.dataset.skipBibleVerseCheck === 'true';

  const feedback = _localValidate(answer, questionText, card, sampleAnswer, questionHint, shortAnswerThreshold, skipBibleVerseCheck);
  _localValidateShowFeedback(card, feedback);
}

// ── Core validation logic ─────────────────────────────────────────────────────
//
// Returns a feedback string in all cases — never null.
// Callers decide how to display it (toast, thread, etc.).
//
// Parameters:
//   userAnswer           — the raw answer text from the textarea
//   questionText         — the question text (plain, from DOM)
//   card                 — the .question-card element (for passage lookup)
//   sampleAnswer         — optional model answer string (from data-sample-answer)
//   questionHint         — optional hint string (from data-question-hint)
//   shortAnswerThreshold — optional string from data-short-answer-threshold:
//                            '0'        → disable the short-answer check
//                            '1', '2'…  → use as the minimum word count
//                            null       → use built-in default logic

function _localValidate(userAnswer, questionText, card, sampleAnswer, questionHint, shortAnswerThreshold, skipBibleVerseCheck = false) {
  const answer = userAnswer.trim();

  // ── Shared utilities ────────────────────────────────────────────────────────
  // Appends the questionHint to withMsg as a new sentence if one is available; otherwise falls back to withoutMsg
  const withHint = (withMsg, withoutMsg) => questionHint
    ? withMsg + ' ' + questionHint
    : withoutMsg;


  const normalise = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

  // Words to exclude from overlap and thematic comparisons.
  // Biblical text is saturated with these, so they inflate overlap ratios falsely.
  const STOPWORDS = new Set([
    'the','a','an','and','or','but','in','on','of','to','is','it','he','his',
    'was','for','with','that','this','are','as','at','by','from','have','had',
    'not','be','has','were','they','we','you','i','my','our','their','him','her',
    'its','so','if','then','will','would','can','could','should','all','one',
    'who','what','which','when','how','do','did','been','more','no','up','out',
    // High-frequency biblical vocabulary that appears in almost every passage
    'god','jesus','lord','christ','said','went','came','upon','into','them',
    'him','us','me','thy','thee','thou','ye','unto','hath','doth','shall'
  ]);

  const contentWords = str =>
    new Set(normalise(str).split(' ').filter(w => w.length > 1 && !STOPWORDS.has(w)));

  // ── 1. Low-engagement filler ────────────────────────────────────────────────
  // Catches non-answers before the word-count check.
  const LOW_ENGAGEMENT = /^(i\s+don'?t\s+know|not\s+sure|not\s+really\s+sure|not\s+sure\s+about\s+this|no\s+idea|no\s+idea\s+at\s+all|no\s+clue|idk|idc|n\/a|yes|no|maybe|yeah|yep|nope|nah|ok|okay|sure|fine|true|false|dunno|duno|don'?t\s+know|tbh|tbd|tbc|t\.b\.c\.|todo|to\s+do|later|will\s+do|come\s+back\s+to\s+this|revisit|unsure|pass|skip|test|testing|asdf|qwerty|aaa+|xxx+|123+|--|[-?]|\?|\.{2,})\.?$/i;
  if (LOW_ENGAGEMENT.test(answer)) {
    return withHint(
      t('validation_lv_stuck_hint'),
      t('validation_lv_stuck_no_hint')
    );
  }

  // ── 2. Very short answer ────────────────────────────────────────────────────
  // Minimum words calibrated against sampleAnswer length if available.
  // shortAnswerThreshold (from data-short-answer-threshold on the card) overrides
  // the default when present. 0 = skip this check entirely for this question.
  const wordCount = answer.split(/\s+/).filter(Boolean).length;
  const minWords  = shortAnswerThreshold !== null
    ? parseInt(shortAnswerThreshold, 10)                         // author-supplied override
    : sampleAnswer
      ? Math.min(6, Math.round(sampleAnswer.split(/\s+/).filter(Boolean).length * 0.35))
      : 6;
  if (minWords > 0 && wordCount < minWords) {
    return withHint(
      t('validation_lv_too_short'),
      t('validation_lv_too_short')
    );
  }

  // ── 3. Answer repeats the question ─────────────────────────────────────────
  const normAnswer   = normalise(answer);
  const normQuestion = normalise(questionText);
  if (normQuestion.length > 20) {
    const qWords     = contentWords(normQuestion);
    const aWordList  = normAnswer.split(' ').filter(w => !STOPWORDS.has(w));
    const overlap    = aWordList.filter(w => qWords.has(w)).length;
    const ratio      = aWordList.length > 0 ? overlap / aWordList.length : 0;
    if (ratio > 0.70) {
      return withHint(
        t('validation_lv_repeats_question'),
        t('validation_lv_repeats_question')
      );
    }
  }

  // ── 4. Answer repeats the linked Bible passage ──────────────────────────────
  // Skipped when skipBibleVerseCheck is true (author has flagged that a direct
  // quote is the expected form of answer, e.g. "What does Paul say about X?").
  if (!skipBibleVerseCheck) {
    const refEl      = card && card.querySelector('.question-ref span[data-ref]');
    const passageRef = refEl ? refEl.dataset.ref : null;
    // Build the union of content words across all translations for this passage.
    // Multilingual studies store multiple translations in the translations array
    // (one per bibleTranslationN). Checking all of them means that pasting any
    // translation — not just the first — is correctly caught.
    const passageEntry   = passageRef && typeof verseData !== 'undefined' && verseData[passageRef];
    const translations   = passageEntry?.translations || [];
    const passageStrings = translations
      .map(tr => _stripHtml(tr.text || '')
        // Strip inline verse numbers (digits at a word boundary before text,
        // e.g. "21For" → "For", "22adultery" → "adultery").
        .replace(/\b\d+(?=[a-zA-Z])/g, ''))
      .filter(s => s.length > 20);

    if (passageStrings.length > 0) {
      // Union of content words from every translation
      const pWords    = new Set(passageStrings.flatMap(s => [...contentWords(s)]));
      const aWordList = normAnswer.split(' ').filter(w => w.length > 1 && !STOPWORDS.has(w));
      const overlap   = aWordList.filter(w => pWords.has(w)).length;

      // Direction 1: what fraction of the answer's content words are from the passage?
      // Catches answers that are mostly or entirely copied verse text.
      const ratioAnswer = aWordList.length > 0 ? overlap / aWordList.length : 0;

      // Direction 2: does the answer contain ANY content words not in ANY translation?
      // Catches a pure copy of any translation with no original contribution.
      const hasOriginalWords = aWordList.some(w => !pWords.has(w));

      if (ratioAnswer > 0.70 || !hasOriginalWords) {
        return withHint(
          t('validation_lv_repeats_passage'),
          t('validation_lv_repeats_passage')
        );
      }
    }
  }

  // ── 5. Thematic check against sampleAnswer (if present) ────────────────────
  //
  // This check is intentionally lenient. Its purpose is not to mark the answer
  // right or wrong, but to catch answers that are completely off-topic —
  // i.e. those that share no meaningful vocabulary with a model answer at all.
  //
  // Threshold is low (≥ 1 shared content word out of the sample's content words)
  // so that paraphrase, personal reflection, and creative expression all pass
  // without penalty. Only truly unrelated answers are flagged.
  if (sampleAnswer && sampleAnswer.trim().length > 10) {
    const sampleContentWords = contentWords(sampleAnswer);
    if (sampleContentWords.size >= 3) {
      const aWords    = contentWords(answer);
      const thematic  = [...aWords].filter(w => sampleContentWords.has(w)).length;
      if (thematic === 0) {
        return withHint(
          t('validation_lv_off_topic_hint'),
          t('validation_lv_off_topic_no_hint')
        );
      }
    }
    // ── 6a. Passes all checks including thematic ───────────────────────────────
    return t('validation_lv_pass_thematic');
  }

  // ── 6b. Passes all checks — no thematic check available ────────────────────
  return withHint(
    t('validation_lv_pass_no_sample_hint'),
    t('validation_lv_pass_no_sample_no_hint')
  );
}


// ═════════════════════════════════════════════════════════════════════════════
// SHARED UTILITIES
// ═════════════════════════════════════════════════════════════════════════════

function _stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').trim();
}

function _escHtml(str) {
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}
