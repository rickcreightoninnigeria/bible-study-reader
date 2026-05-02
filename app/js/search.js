// ── SEARCH ────────────────────────────────────────────────────────────────────
// Full-text search over all chapter content (questions, bridge text, reflections)
// and the user's saved answers. Includes the search overlay open/close functions,
// debouncing, theological keyword config, query helpers, scoring, and the main
// search runner.
//
// Dependencies (all available as globals before this file loads):
//   ICONS                         – icons.js
//   chapters                      – window.chapters (state.js)
//   storageKey                    – main.js STATE section
//   goToChapter                   – main.js NAVIGATION section
//   closeMenu, saveLastPosition   – main.js (called at runtime only)
//   isNonChapterPage              – main.js STATE section (local let)
//   window._titleBeforeSearch     – state.js
//   window.activeTabPage          – state.js

// ── OPEN / CLOSE ──────────────────────────────────────────────────────────────

// Opens the search overlay. Saves scroll position, sets isNonChapterPage, and
// changes the Search button to ✕. Does not disturb any other button's state.
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

// Closes the search overlay and resets only the Search button.
// Other nav buttons are unaffected — whatever was behind Search remains as-is.
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

// Wraps all occurrences of 'query' in 'text' with <mark> tags for highlighting
// in search results. Escapes regex special characters in the query first.
function highlightMatch(text, query) {
  // Always HTML-escape the input text first so that answer content containing
  // '<', '>', or '&' cannot inject markup into the search results innerHTML.
  const safeText = escapeHtml(text);
  if (!query) return safeText;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safeText.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
}

// Strips all HTML tags from a string, returning plain text.
// Used to make verse/question HTML safe to search and display as plain text.
function stripHtml(html) {
  return html.replace(/<[^>]+>/g, '');
}

// ── DEBOUNCE ──────────────────────────────────────────────────────────────────
// Prevents runSearchCore() from firing on every keystroke. The returned function
// delays execution by 'delay' ms, resetting the timer if called again before it fires.
function debounce(fn, delay = 250) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// debouncedRunSearch is wired to the search input's oninput event.
// It wraps runSearchCore so the actual search only fires 250ms after the
// user stops typing, avoiding redundant work on every keystroke.
const debouncedRunSearch = debounce(runSearchCore, 250);

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Theological keywords used for two purposes:
//   1. Scoring: any result whose text contains one of these gets a bonus score.
//   2. Fuzzy suggestion: if a query matches one of these within edit-distance 2,
//      it is offered as a "Did you mean?" suggestion.

// Theological keywords — expanded set covering doctrine, biblical books, figures, and liturgical terms.
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

// Synonym map: if the user's query exactly matches a key, the corresponding
// array of synonyms is added to the query expansion so results for related
// terms are also surfaced (e.g. searching "faith" also finds "belief", "trust").
const SYNONYMS = {
  // --- Core Soteriology ---
  'conversion': ['new birth', 'born again', 'regeneration', 'metanoia'],
  'repentance': ['turn', 'turning', 'remorse', 'change of mind'],
  'faith': ['belief', 'trust', 'confidence', 'assurance', 'pistis'],
  'grace': ['favor', 'unmerited gift', 'charis'],
  'salvation': ['deliverance', 'rescue', 'soteria'],
  'gospel': ['good news', 'evangelion', 'kerygma'],
  'justification': ['declared righteous', 'acquittal'],

  // --- The Nature of Sin ---
  'sin': ['iniquity', 'transgression', 'trespass', 'falling short', 'hamartia', 'debt'],
  'evil': ['wickedness', 'darkness', 'depravity'],

  // --- Christology ---
  'christ': ['jesus', 'messiah', 'anointed one', 'son of man', 'lamb of God'],
  'lord': ['kyrios', 'master', 'sovereign'],
  'holy spirit': ['paraclete', 'comforter', 'advocate', 'spirit of truth', 'pneuma'],
  'god': ['father', 'creator', 'yahweh', 'elohim', 'the almighty'],

  // --- Bible & Scripture ---
  'bible': ['scripture', 'word of god', 'holy writ', 'the text'],
  'old testament': ['tanakh', 'hebrew scriptures', 'the law and the prophets'],
  'new testament': ['greek scriptures', 'apostolic writings'],
  'covenant': ['testament', 'agreement', 'promise', 'berit'],

  // --- Christian Life & Virtues ---
  'church': ['body of christ', 'ekklesia', 'congregation', 'assembly'],
  'worship': ['praise', 'adoration', 'liturgy', 'service'],
  'love': ['agape', 'charity', 'steadfast love', 'hesed'],
  'peace': ['shalom', 'tranquility', 'reconciliation'],
  'holiness': ['sanctification', 'purity', 'set apart'],
  'prayer': ['supplication', 'intercession', 'petition', 'communion with god'],

  // --- End Times & Hope ---
  'heaven': ['paradise', 'new jerusalem', 'kingdom of god'],
  'hell': ['sheol', 'hades', 'gehenna', 'outer darkness'],
  'second coming': ['parousia', 'return of christ', 'last days'],
  'judgment': ['reckoning', 'final account', 'tribunal']
};

// ── HELPERS ───────────────────────────────────────────────────────────────────

// Lowercases text for case-insensitive comparison throughout the search pipeline.
function normalize(text) {
  return text.toLowerCase();
}

/**
 * expandQuery:
 * Takes a query string and returns an array of unique terms to search for,
 * including synonyms from the SYNONYMS map.
 * For example, "faith" becomes ["faith", "belief", "trust", "assurance", "pistis"].
 */
function expandQuery(query) {
  const words = normalize(query).split(/\s+/).filter(w => w.length > 0);
  const expanded = new Set();

  words.forEach(word => {
    // Add the original word
    expanded.add(word);
    // Add all synonyms if they exist in our map
    if (SYNONYMS[word]) {
      SYNONYMS[word].forEach(syn => expanded.add(syn.toLowerCase()));
    }
  });

  return Array.from(expanded);
}

// Computes the Levenshtein edit distance between strings a and b.
// Used only by getSuggestion() for fuzzy keyword matching; not called
// on every search result, so the O(m×n) cost is acceptable here.
function levenshtein(a, b) {
  const m = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j++) m[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] = b[i-1] === a[j-1]
        ? m[i-1][j-1]
        : Math.min(
            m[i-1][j-1] + 1,
            m[i][j-1] + 1,
            m[i-1][j] + 1
          );
    }
  }
  return m[b.length][a.length];
}

// Returns the closest THEO_KEYWORDS entry to 'query' if the edit distance
// is ≤ 2 (and the query is ≤ 12 chars), or null if no close match exists.
// Used to power "Did you mean X?" suggestions in the results panel.
function getSuggestion(query) {
  if (query.length > 12) return null;

  let best = null;
  let bestDist = Infinity;

  THEO_KEYWORDS.forEach(k => {
    const d = levenshtein(query, k);
    if (d < bestDist && d <= 2) {
      bestDist = d;
      best = k;
    }
  });

  return best;
}

// In-memory cache of localStorage values read during a search pass.
// Avoids repeated localStorage.getItem() calls for the same key within
// a single runSearchCore() execution — a significant performance gain
// when the user has many saved answers.
const storageCache = new Map();

// Returns the localStorage value for 'key', reading from the in-memory
// cache first and falling back to localStorage on a miss.
function getCachedStorage(key) {
  if (storageCache.has(key)) return storageCache.get(key);
  const val = localStorage.getItem(key) || '';
  storageCache.set(key, val);
  return val;
}

// ── SCORING ───────────────────────────────────────────────────────────────────
// Assigns a relevance score to a single result candidate.
// Higher scores surface the result closer to the top of the list.
// Scoring factors (cumulative):
//   – Exact / prefix / substring match on the result text (+120/80/40)
//   – Match on the Bible reference string (+100)
//   – Result type bonus: answer (+80) > question (+60) > bridge (+25)
//   – Theological keyword presence in text (+20 each)
//   – Shorter text length bonus (rewards concise matches)
//   – Having a saved answer (+25, encourages answer results)

function scoreResult({ text, ref, type, answer }, queries, originalQuery) {
  const t = normalize(text);
  const normOriginal = normalize(originalQuery);
  let score = 0;

  // 1. Match scoring with multiplier — boost the original (unexpanded) word
  queries.forEach(q => {
    let multiplier = (q === normOriginal) ? 1.5 : 1.0;

    if (t === q)            score += (120 * multiplier);
    else if (t.startsWith(q)) score += (80  * multiplier);
    else if (t.includes(q))   score += (40  * multiplier);

    if (ref && normalize(ref).includes(q)) score += (100 * multiplier);
  });

  // 2. Result type bonus (crucial for relevance ordering)
  if (type === 'question') score += 60;
  if (type === 'answer')   score += 80;
  if (type === 'bridge')   score += 25;

  // 3. Theological keyword bonus — rewards theologically rich content
  THEO_KEYWORDS.forEach(k => {
    if (t.includes(k)) score += 20;
  });

  // 4. Length and answer adjustments
  score += Math.max(0, 50 - text.length / 10); // shorter text = higher boost
  if (answer) score += 25;

  return score;
}

// ── MAIN SEARCH CORE ──────────────────────────────────────────────────────────
// Full-text search over all chapter content and saved answers.
// Called via debouncedRunSearch() (wired to the search input's oninput event).
//
// Search pools (in one pass over chapters[]):
//   bridge text  – section explanatory paragraphs
//   questions    – question text and Bible reference strings
//   answers      – user's saved answers to questions and reflections
//
// After gathering candidates, results are scored and sorted. If no results are
// found and the query is short, a fuzzy fallback re-runs the search using the
// closest THEO_KEYWORDS suggestion.

function runSearchCore(query) {
  const resultsEl = document.getElementById('searchResults');
  const originalQuery = query.trim();

  if (originalQuery.length < 2) {
    resultsEl.innerHTML =
      `<div class="search-empty">${t('search_empty_prompt')}</div>`;
    return;
  }

  const queries = expandQuery(originalQuery);
  const results = [];

  chapters.forEach((ch, chIdx) => {
    ch.sections.forEach((sec, sIdx) => {
      // 1. Search bridge text (explanatory paragraphs between questions)
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
      sec.questions.forEach((question, qIdx) => {
        const qText = stripHtml(question.text);
        const ref = question.ref;
        const eid = question.elementId || `${sIdx}_${qIdx}`;
        const key = storageKey(ch.chapterNumber, 'q', eid);
        const savedAnswer = getCachedStorage(key);

        const combined = qText + ' ' + ref + ' ' + savedAnswer;
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

    // 3. Search reflection answers.
    // Iterate directly over reflection elements so elementId is read from the
    // element itself — exactly as renderQuestion() does when saving answers.
    // The previous approach filtered elements into reflEls[] then used the
    // ch.reflection[] loop index to index into reflEls[], which misaligned
    // whenever repeatElement entries or non-reflection elements interleaved
    // with reflection elements in ch.elements[].
    (ch.elements || [])
      .filter(e => e.type === 'question' && e.subtype === 'reflection' && !e.repeatElement)
      .forEach((el, rIdx) => {
        const key = storageKey(ch.chapterNumber, 'r', el.elementId);
        const savedAnswer = getCachedStorage(key);
        if (savedAnswer) {
          const norm = normalize(savedAnswer);
          if (queries.some(q => norm.includes(q))) {
            // Question text lives on the element (el.question for mono-lingual,
            // el.question1/2/3 for multilingual). stripHtml guards against any
            // inline HTML in the question string.
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

  // Fuzzy fallback: if no results and the query is short, retry with the
  // closest theological keyword match (e.g. "fait" → "faith")
  if (results.length === 0 && originalQuery.length <= 10) {
    const suggestion = getSuggestion(originalQuery);
    if (suggestion && suggestion !== originalQuery) return runSearchCore(suggestion);
  }

  results.sort((a, b) => b.score - a.score);

  if (results.length === 0) {
    const suggestion = getSuggestion(originalQuery);
    resultsEl.innerHTML = `
      <div class="search-empty">
        ${t('search_no_results', { query: originalQuery })}<br>
        ${suggestion ? t('search_did_you_mean_inline', { suggestion }) : ''}
      </div>`;
    return;
  }

  // Render results (capped at 50 to keep the list manageable)
  let html = '';
  const suggestion = getSuggestion(originalQuery);
  if (suggestion && suggestion !== normalize(originalQuery)) {
    html += `<div class="search-section-label">${t('search_did_you_mean_label', { suggestion })}</div>`;
  }

  results.slice(0, 50).forEach(r => {
    const cardArg = r.cardId ? `'${r.cardId}'` : 'null';
    html += `
      <div class="search-result-item" onclick="searchNavigate(${r.chIdx}, ${cardArg})">
        <div class="search-result-meta">
          ${t('search_result_meta', { chNum: r.chNum, chTitle: r.chTitle })}${r.ref ? ' · ' + r.ref : ''}
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
// to the specific card if cardId is provided. The 300ms timeout allows
// renderChapter() to complete its DOM writes before scrollIntoView() is called.
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
