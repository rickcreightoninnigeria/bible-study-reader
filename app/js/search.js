// ── SEARCH ────────────────────────────────────────────────────────────────────
// Full-text search over all chapter content (questions, bridge text, reflections)
// and the user's saved answers. Includes the search overlay open/close functions,
// debouncing, theological keyword config, query helpers, scoring, and the main
// search runner.
//
// Dependencies (all available as globals before this file loads):
//   ICONS                         – icons.js
//   chapters                      – state.js
//   answerFieldKey                – state.js
//   StudyIDB                      – idb.js
//   goToChapter                   – navigation.js
//   closeMenu, saveLastPosition   – main.js / utils.js (called at runtime only)
//   isNonChapterPage              – state.js
//   window._titleBeforeSearch     – state.js
//   window.activeTabPage          – state.js
//   window.activeStudyId          – state.js

// ── OPEN / CLOSE ──────────────────────────────────────────────────────────────

function openSearch() {
  closeMenu();
  saveLastPosition();
  isNonChapterPage = true;
  document.getElementById('searchOverlay').classList.add('open');
  const searchBtn = document.getElementById('navSearchBtn');
  if (searchBtn) { searchBtn.innerHTML = ICONS.close; searchBtn.onclick = () => closeSearch(); }
  window._titleBeforeSearch = document.getElementById('header-title').innerText;
  document.getElementById('header-title').innerText = t('search_header_title');
  document.getElementById('searchInput').value = '';
  document.getElementById('searchResults').innerHTML =
    `<div class="search-empty">${t('search_empty_prompt')}</div>`;
  setTimeout(() => document.getElementById('searchInput').focus(), 100);
}

function closeSearch() {
  document.getElementById('searchOverlay').classList.remove('open');
  document.getElementById('searchInput').blur();
  if (!window.activeTabPage) isNonChapterPage = false;
  const searchBtn = document.getElementById('navSearchBtn');
  if (searchBtn) { searchBtn.innerHTML = ICONS.search; searchBtn.onclick = () => navSearchClick(); }
  if (window._titleBeforeSearch) {
    document.getElementById('header-title').innerText = window._titleBeforeSearch;
    window._titleBeforeSearch = null;
  }
}

function highlightMatch(text, query) {
  const safeText = escapeHtml(text);
  if (!query) return safeText;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safeText.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, '');
}

// ── DEBOUNCE ──────────────────────────────────────────────────────────────────

function debounce(fn, delay = 250) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// debouncedRunSearch is wired to the search input's oninput event.
// runSearchCore is async; the debounced wrapper fires it and lets the
// promise float — search results update the DOM when the await resolves.
const debouncedRunSearch = debounce(runSearchCore, 250);

// ── CONFIG ────────────────────────────────────────────────────────────────────

const THEO_KEYWORDS = [
  'conversion', 'repentance', 'faith', 'grace', 'sin', 'righteousness',
  'justification', 'new birth', 'born again', 'regeneration',
  'christ', 'gospel', 'salvation', 'kingdom', 'belief', 'trust',
  'redemption', 'atonement', 'reconciliation', 'propitiation', 'adoption',
  'sanctification', 'glorification', 'mercy', 'forgiveness', 'holiness',

  // --- Christology & Trinitarian Terms ---
  'jesus', 'messiah', 'lord', 'savior', 'trinity', 'father', 'son',
  'holy spirit', 'incarnation', 'resurrection', 'ascension', 'divinity',
  'humanity', 'mediator', 'advocate', 'intercession', 'logos', 'word',

  // --- Biblical Books (Commonly Referenced) ---
  'genesis', 'exodus', 'leviticus', 'numbers', 'deuteronomy', 'psalms',
  'proverbs', 'isaiah', 'jeremiah', 'daniel', 'matthew', 'mark', 'luke',
  'john', 'acts', 'romans', 'corinthians', 'galatians', 'ephesians',
  'philippians', 'colossians', 'thessalonians', 'timothy', 'hebrews',
  'james', 'peter', 'revelation',

  // --- Key Biblical Figures ---
  'adam', 'eve', 'noah', 'abraham', 'isaac', 'jacob', 'joseph', 'moses',
  'joshua', 'samuel', 'david', 'solomon', 'elijah', 'elisha', 'mary',
  'joseph', 'peter', 'paul', 'barnabas', 'silas', 'stephen', 'nicodemus',

  // --- Theology & Hermeneutics ---
  'covenant', 'testament', 'scripture', 'revelation', 'inspiration',
  'authority', 'canon', 'doctrine', 'theology', 'eschatology', 'judgement',
  'providence', 'sovereignty', 'creation', 'fall', 'stewardship',
  'hermeneutics', 'exegesis', 'parable', 'prophecy', 'typology',

  // --- The Christian Life & Ecclesiology ---
  'discipleship', 'apostle', 'disciple', 'church', 'body', 'bride',
  'communion', 'baptism', 'sacrament', 'ordinance', 'worship', 'prayer',
  'fasting', 'fellowship', 'mission', 'evangelism', 'witness', 'martyr',
  'servant', 'deacon', 'elder', 'pastor', 'bishop', 'ministry', 'spiritual gifts',
  'fruit of the spirit', 'patience', 'humility', 'love', 'charity', 'peace',
  'joy', 'hope', 'perseverance', 'temptation', 'flesh', 'spirit',

  // --- Hebrew/Greek Concepts ---
  'agape', 'logos', 'shalom', 'shema', 'ekklesia', 'koinonia', 'hallelujah',
  'amen', 'hosanna', 'maranatha', 'abba'
];

const SYNONYMS = {
  'conversion': ['new birth', 'born again', 'regeneration', 'metanoia'],
  'repentance': ['turn', 'turning', 'remorse', 'change of mind'],
  'faith': ['belief', 'trust', 'confidence', 'assurance', 'pistis'],
  'grace': ['favor', 'unmerited gift', 'charis'],
  'salvation': ['deliverance', 'rescue', 'soteria'],
  'gospel': ['good news', 'evangelion', 'kerygma'],
  'justification': ['declared righteous', 'acquittal'],
  'sin': ['iniquity', 'transgression', 'trespass', 'falling short', 'hamartia', 'debt'],
  'evil': ['wickedness', 'darkness', 'depravity'],
  'christ': ['jesus', 'messiah', 'anointed one', 'son of man', 'lamb of God'],
  'lord': ['kyrios', 'master', 'sovereign'],
  'holy spirit': ['paraclete', 'comforter', 'advocate', 'spirit of truth', 'pneuma'],
  'god': ['father', 'creator', 'yahweh', 'elohim', 'the almighty'],
  'bible': ['scripture', 'word of god', 'holy writ', 'the text'],
  'old testament': ['tanakh', 'hebrew scriptures', 'the law and the prophets'],
  'new testament': ['greek scriptures', 'apostolic writings'],
  'covenant': ['testament', 'agreement', 'promise', 'berit'],
  'church': ['body of christ', 'ekklesia', 'congregation', 'assembly'],
  'worship': ['praise', 'adoration', 'liturgy', 'service'],
  'love': ['agape', 'charity', 'steadfast love', 'hesed'],
  'peace': ['shalom', 'tranquility', 'reconciliation'],
  'holiness': ['sanctification', 'purity', 'set apart'],
  'prayer': ['supplication', 'intercession', 'petition', 'communion with god'],
  'heaven': ['paradise', 'new jerusalem', 'kingdom of god'],
  'hell': ['sheol', 'hades', 'gehenna', 'outer darkness'],
  'second coming': ['parousia', 'return of christ', 'last days'],
  'judgment': ['reckoning', 'final account', 'tribunal']
};

// ── HELPERS ───────────────────────────────────────────────────────────────────

function normalize(text) {
  return text.toLowerCase();
}

function expandQuery(query) {
  const words = normalize(query).split(/\s+/).filter(w => w.length > 0);
  const expanded = new Set();
  words.forEach(word => {
    expanded.add(word);
    if (SYNONYMS[word]) {
      SYNONYMS[word].forEach(syn => expanded.add(syn.toLowerCase()));
    }
  });
  return Array.from(expanded);
}

function levenshtein(a, b) {
  const m = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] = b[i-1] === a[j-1]
        ? m[i-1][j-1]
        : Math.min(m[i-1][j-1] + 1, m[i][j-1] + 1, m[i-1][j] + 1);
    }
  }
  return m[b.length][a.length];
}

function getSuggestion(query) {
  if (query.length > 12) return null;
  let best = null;
  let bestDist = Infinity;
  THEO_KEYWORDS.forEach(k => {
    const d = levenshtein(query, k);
    if (d < bestDist && d <= 2) { bestDist = d; best = k; }
  });
  return best;
}

// ── ANSWER CACHE ──────────────────────────────────────────────────────────────
// In-memory cache of IDB chapter answer objects for the current search session.
// Keyed by chapter number. Populated once per runSearchCore() call via
// _loadAnswerCache(), then read synchronously during the search pass.
// Cleared by saveAnswers() in save.js so the next search sees fresh data.
//
// The Map is exported as `storageCache` to preserve the existing clear() call
// in save.js — no change needed there.
const storageCache = new Map();

// Loads all chapter answer objects for the active study into storageCache.
// Keyed by chapter number (integer). Returns a Promise that resolves when all
// reads are complete. Called once at the start of each runSearchCore() execution.
async function _loadAnswerCache() {
  storageCache.clear();
  const studyId = window.activeStudyId;
  if (!studyId) return;
  await Promise.all(
    chapters.map(async ch => {
      try {
        const record = await StudyIDB.getChapterAnswers(studyId, ch.chapterNumber);
        storageCache.set(ch.chapterNumber, record);
      } catch (e) {
        storageCache.set(ch.chapterNumber, {});
      }
    })
  );
}

// Returns the saved answer for a field within a chapter, reading from the
// in-memory cache populated by _loadAnswerCache().
function _getCachedAnswer(chapterNum, fieldKey) {
  const record = storageCache.get(chapterNum);
  return record ? (record[fieldKey] || '') : '';
}

// ── SCORING ───────────────────────────────────────────────────────────────────

function scoreResult({ text, ref, type, answer }, queries, originalQuery) {
  const tNorm = normalize(text);
  const normOriginal = normalize(originalQuery);
  let score = 0;

  queries.forEach(q => {
    let multiplier = (q === normOriginal) ? 1.5 : 1.0;
    if (tNorm === q)              score += (120 * multiplier);
    else if (tNorm.startsWith(q)) score += (80  * multiplier);
    else if (tNorm.includes(q))   score += (40  * multiplier);
    if (ref && normalize(ref).includes(q)) score += (100 * multiplier);
  });

  if (type === 'question') score += 60;
  if (type === 'answer')   score += 80;
  if (type === 'bridge')   score += 25;

  THEO_KEYWORDS.forEach(k => { if (tNorm.includes(k)) score += 20; });

  score += Math.max(0, 50 - text.length / 10);
  if (answer) score += 25;

  return score;
}

// ── MAIN SEARCH CORE ──────────────────────────────────────────────────────────
// Full-text search over all chapter content and saved answers.
// Now async: loads all chapter answer objects from IDB once at the start,
// then the search pass runs synchronously over the in-memory cache.
// Called via debouncedRunSearch() (wired to the search input's oninput event).

async function runSearchCore(query) {
  const resultsEl = document.getElementById('searchResults');
  const originalQuery = query.trim();

  if (originalQuery.length < 2) {
    resultsEl.innerHTML =
      `<div class="search-empty">${t('search_empty_prompt')}</div>`;
    return;
  }

  // Pre-load all chapter answer objects from IDB into storageCache.
  // This is the single async step — everything after is synchronous.
  await _loadAnswerCache();

  const queries = expandQuery(originalQuery);
  const results = [];

  chapters.forEach((ch, chIdx) => {
    (ch.sections || []).forEach((sec, sIdx) => {
      // 1. Search bridge text
      if (sec.bridge) {
        const plain = stripHtml(sec.bridge);
        const norm = normalize(plain);
        if (queries.some(q => norm.includes(q))) {
          results.push({
            chIdx, chNum: ch.chapterNumber, chTitle: ch.chapterTitle,
            text: plain.substring(0, 120) + '…',
            type: 'bridge',
            cardId: null,
            score: scoreResult({ text: plain, type: 'bridge' }, queries, originalQuery)
          });
        }
      }

      // 2. Search questions and their saved answers
      (sec.questions || []).forEach((question, qIdx) => {
        const qText = stripHtml(question.text);
        const ref   = question.ref;
        const eid   = question.elementId || `${sIdx}_${qIdx}`;
        const savedAnswer = _getCachedAnswer(ch.chapterNumber, answerFieldKey('q', eid));

        const combined     = qText + ' ' + ref + ' ' + savedAnswer;
        const normCombined = normalize(combined);

        if (queries.some(q => normCombined.includes(q))) {
          results.push({
            chIdx, chNum: ch.chapterNumber, chTitle: ch.chapterTitle, ref,
            text: qText,
            answer: savedAnswer,
            type: 'question',
            cardId: eid,
            score: scoreResult({ text: combined, ref, type: 'question', answer: savedAnswer }, queries, originalQuery)
          });
        }

        if (savedAnswer) {
          const normAns = normalize(savedAnswer);
          if (queries.some(q => normAns.includes(q))) {
            results.push({
              chIdx, chNum: ch.chapterNumber, chTitle: ch.chapterTitle, ref,
              questionText: qText,
              answer: savedAnswer,
              type: 'answer',
              cardId: eid,
              score: scoreResult({ text: savedAnswer, ref, type: 'answer', answer: savedAnswer }, queries, originalQuery)
            });
          }
        }
      });
    });

    // 3. Search reflection answers
    (ch.elements || [])
      .filter(e => e.type === 'question' && e.subtype === 'reflection' && !e.repeatElement)
      .forEach((el, rIdx) => {
        const savedAnswer = _getCachedAnswer(ch.chapterNumber, answerFieldKey('r', el.elementId));
        if (savedAnswer) {
          const norm = normalize(savedAnswer);
          if (queries.some(q => norm.includes(q))) {
            const questionText = stripHtml(el.question || el.question1 || '');
            results.push({
              chIdx, chNum: ch.chapterNumber, chTitle: ch.chapterTitle,
              ref: t('search_reflection_ref', { num: rIdx + 1 }),
              questionText,
              answer: savedAnswer,
              type: 'answer',
              cardId: el.elementId,
              score: scoreResult({ text: savedAnswer, type: 'answer', answer: savedAnswer }, queries, originalQuery)
            });
          }
        }
      });
  });

  // Fuzzy fallback
  if (results.length === 0 && originalQuery.length <= 10) {
    const suggestion = getSuggestion(originalQuery);
    if (suggestion && suggestion !== originalQuery) return runSearchCore(suggestion);
  }

  results.sort((a, b) => b.score - a.score);

  if (results.length === 0) {
    const suggestion   = getSuggestion(originalQuery);
    const safeQuery      = escapeHtml(originalQuery);
    const safeSuggestion = suggestion ? escapeHtml(suggestion) : '';
    resultsEl.innerHTML = `
      <div class="search-empty">
        ${t('search_no_results', { query: safeQuery })}<br>
        ${safeSuggestion ? t('search_did_you_mean_inline', { suggestion: safeSuggestion }) : ''}
      </div>`;
    return;
  }

  let html = '';
  const suggestion = getSuggestion(originalQuery);
  if (suggestion && suggestion !== normalize(originalQuery)) {
    html += `<div class="search-section-label">${t('search_did_you_mean_label', { suggestion: escapeHtml(suggestion) })}</div>`;
  }

  results.slice(0, 50).forEach(r => {
    const cardArg = r.cardId ? `'${r.cardId}'` : 'null';
    html += `
      <div class="search-result-item" onclick="searchNavigate(${r.chIdx}, ${cardArg})">
        <div class="search-result-meta">
          ${t('search_result_meta', { chNum: r.chNum, chTitle: escapeHtml(r.chTitle) })}${r.ref ? ' · ' + escapeHtml(r.ref) : ''}
        </div>
        <div class="search-result-text">
          ${highlightMatch(r.text || r.questionText, originalQuery)}
        </div>
        ${r.answer ? `
          <div class="search-result-answer">
            "${highlightMatch(r.answer.substring(0, 120), originalQuery)}"
          </div>` : ''}
      </div>`;
  });

  resultsEl.innerHTML = html;
}

// Closes the search overlay, navigates to the given chapter index, then scrolls
// to the specific card if cardId is provided.
function searchNavigate(chIdx, cardId) {
  closeSearch();
  Router.navigate({ page: 'chapter', idx: chIdx });
  if (cardId) {
    setTimeout(() => {
      const card = document.getElementById(cardId);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  }
}
