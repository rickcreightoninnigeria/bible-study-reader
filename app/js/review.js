// ── REVIEW (a multiple-choice recap at the end of a study) ───────────────────
// An optional page in the Contents menu, between Study Group and Leaders'
// Notes, for studies that carry a top-level `reviewData` block (see
// STUDY-FORMAT.md and REVIEW-QUIZ-SPEC.md). It is for recall, not assessment:
// no timer, nothing sent anywhere, and the only thing kept is the reader's best
// score for each number of questions, on this device.
//
// How a question is served: the reader taps "Show answers", then taps one of
// four options: the right answer plus three wrong ones drawn at random from
// the question's pool of wrong answers, shuffled afresh every time.
//
// Two parts:
//   1. Pure logic (no DOM, no globals) at the top: building the pool, choosing
//      questions and options, scoring bands, best-score records. Tested in
//      testing/tests/review.test.js by running this file in a sandbox.
//   2. The page: start screen, question view, summary. Reads window.reviewData,
//      window.chapters, studyText (render-chapter-elements.js), StudyIDB
//      (idb.js), t (i18n.js).
//
// Globals defined here (all on window, called from onclick handlers):
//   renderReview, reviewStepCount, reviewSetOrder, reviewStart, reviewShow,
//   reviewChoose, reviewNext, reviewRetryMissed, reviewAnother, reviewEnd,
//   reviewVisibleInMenu, reviewIsDone
//
// Study-level resolution of language slots follows STUDY-FORMAT.md section 2
// (question1/correct1/wrong1/explain1, falling back to slot 1).

// ══════════════════════════════════════════════════════════════════════════════
// 1. PURE LOGIC
// ══════════════════════════════════════════════════════════════════════════════

const REVIEW_LIMITS = {
  DEFAULT_COUNT:   10,   // questions offered by default
  MIN_COUNT:        3,   // fewest the reader can choose (or the whole pool if smaller)
  WRONG_SHOWN:      3,   // wrong answers served with the right one
  AUTO_MIN_CHAPTERS: 4,  // automatic question types need this many chapters
  MAX_VERSES_PER_CHAPTER: 3,
};

// Fisher-Yates on a copy. `rnd` is injectable so tests are repeatable.
function reviewShuffle(list, rnd) {
  const r = typeof rnd === 'function' ? rnd : Math.random;
  const a = Array.isArray(list) ? list.slice() : [];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function _reviewNorm(s) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
}

// The four (or fewer) options for one question: the right answer plus up to
// WRONG_SHOWN wrong ones, drawn at random without repeats and never equal to
// the right answer (ignoring case and spacing), in a random order.
// Returns [{ text, correct }].
function reviewPickOptions(q, rnd) {
  const correct = String((q && q.correct) || '');
  const seen = new Set([_reviewNorm(correct)]);
  const wrong = [];
  for (const w of (q && Array.isArray(q.wrong) ? q.wrong : [])) {
    const key = _reviewNorm(w);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    wrong.push(String(w));
  }
  const drawn = reviewShuffle(wrong, rnd).slice(0, REVIEW_LIMITS.WRONG_SHOWN);
  const options = [{ text: correct, correct: true }, ...drawn.map(text => ({ text, correct: false }))];
  return reviewShuffle(options, rnd);
}

// Which questions this round uses. `ordered` keeps the pool's order; otherwise
// a random sample without repeats. n is clamped to 1..pool length.
function reviewSelect(pool, n, ordered, rnd) {
  const list = Array.isArray(pool) ? pool : [];
  const count = Math.max(1, Math.min(list.length, Math.floor(Number(n)) || 0));
  if (list.length === 0) return [];
  return (ordered ? list.slice() : reviewShuffle(list, rnd)).slice(0, count);
}

// The pool: written questions first, then (if switched on and the study has
// enough chapters) the automatic ones. `chapters` is already resolved for the
// reader's language: [{ number, title, summary, verses[], notWith[] }].
// `labels` builds the text that is not in the study:
//   { about(n, title), which(), chapterOption(n, title) }
function reviewBuildPool(written, auto, chapters, labels) {
  const pool = [];
  for (const q of (Array.isArray(written) ? written : [])) {
    if (!q || !q.question || !q.correct || !Array.isArray(q.wrong) || q.wrong.length === 0) continue;
    pool.push({ id: q.id, question: q.question, correct: q.correct, wrong: q.wrong, explain: q.explain || '', chapter: q.chapter || null, quote: '' });
  }
  const chs = (Array.isArray(chapters) ? chapters : []).filter(c => c && c.number != null);
  const a = auto && typeof auto === 'object' ? auto : {};
  if (chs.length >= REVIEW_LIMITS.AUTO_MIN_CHAPTERS && labels) {
    if (a.aboutChapter) {
      const withSummary = chs.filter(c => c.summary);
      if (withSummary.length >= REVIEW_LIMITS.AUTO_MIN_CHAPTERS) {
        for (const c of withSummary) {
          const banned = new Set((c.notWith || []).map(Number));
          const wrong = withSummary.filter(o => o.number !== c.number && !banned.has(Number(o.number)) && _reviewNorm(o.summary) !== _reviewNorm(c.summary)).map(o => o.summary);
          if (wrong.length === 0) continue;
          pool.push({ id: `auto-about-${c.number}`, question: labels.about(c.number, c.title), correct: c.summary, wrong, explain: '', chapter: c.number, quote: '' });
        }
      }
    }
    if (a.whichChapter) {
      for (const c of chs) {
        const verses = (Array.isArray(c.verses) ? c.verses : []).filter(Boolean).slice(0, REVIEW_LIMITS.MAX_VERSES_PER_CHAPTER);
        if (verses.length === 0) continue;
        const wrong = chs.filter(o => o.number !== c.number).map(o => labels.chapterOption(o.number, o.title));
        verses.forEach((v, i) => pool.push({ id: `auto-which-${c.number}-${i + 1}`, question: labels.which(), correct: labels.chapterOption(c.number, c.title), wrong, explain: '', chapter: c.number, quote: String(v) }));
      }
    }
  }
  return pool;
}

// Score bands for the gentle summary wording.
function reviewBand(score, total) {
  if (!total) return 'low';
  if (score === total) return 'all';
  const p = score / total;
  return p >= 0.8 ? 'high' : p >= 0.5 ? 'mid' : 'low';
}

// The saved record for a study: { done, best: { "10": 8 } } (best by question
// count, because 8 of 10 and 8 of 20 cannot be compared).
function reviewParseRecord(raw) {
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object') {
      const best = {};
      if (o.best && typeof o.best === 'object') {
        for (const [k, v] of Object.entries(o.best)) if (Number.isFinite(Number(v)) && Number(v) >= 0) best[String(parseInt(k, 10))] = Number(v);
      }
      return { done: o.done === true, best };
    }
  } catch (e) { /* no record yet, or damaged: start again */ }
  return { done: false, best: {} };
}

// Fold one finished round into the record. Returns
// { record, previous (number|null), status: 'first' | 'new' | 'matched' | 'below' }.
function reviewApplyResult(record, count, score) {
  const rec = { done: true, best: { ...((record && record.best) || {}) } };
  const key = String(count);
  const previous = Object.prototype.hasOwnProperty.call(rec.best, key) ? rec.best[key] : null;
  let status = 'below';
  if (previous === null) status = 'first';
  else if (score > previous) status = 'new';
  else if (score === previous) status = 'matched';
  if (previous === null || score > previous) rec.best[key] = score;
  return { record: rec, previous, status };
}

function reviewRecordKey(studyId) {
  return `${studyId}_review_best`;
}


// ══════════════════════════════════════════════════════════════════════════════
// 2. THE PAGE
// ══════════════════════════════════════════════════════════════════════════════

let _rv = null;   // the state of the page now on screen

function _rvText(s) {
  const safe = escapeHtml(String(s == null ? '' : s));
  return typeof expandInlineMarkers === 'function' ? expandInlineMarkers(safe) : safe;
}

function _rvArray(v) {
  return Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim() !== '') : [];
}

// The study's pool for the language the reader is using.
function reviewBuildPoolFromStudy() {
  const d = window.reviewData;
  if (!d || typeof d !== 'object') return [];
  const written = (Array.isArray(d.questions) ? d.questions : []).map(el => ({
    id:       String((el && el.id) || ''),
    question: studyText(el, 'question'),
    correct:  studyText(el, 'correct'),
    wrong:    _rvArray(studyText(el, 'wrong')),
    explain:  studyText(el, 'explain'),
    chapter:  Number(el && el.chapter) || null,
  }));
  const chapters = (window.chapters || []).map(ch => ({
    number:  ch.chapterNumber,
    title:   studyText(ch, 'chapterTitle'),
    summary: studyText(ch, 'reviewSummary'),
    verses:  _rvArray(studyText(ch, 'reviewVerses')),
    notWith: Array.isArray(ch.reviewNotWith) ? ch.reviewNotWith : [],
  }));
  const labels = {
    about:         (n, title) => t('review_about_chapter_q', { n }),
    which:         () => t('review_which_chapter_q'),
    chapterOption: (n, title) => title ? t('review_chapter_option', { n, title }) : t('review_chapter_option_notitle', { n }),
  };
  return reviewBuildPool(written, d.auto, chapters, labels);
}

async function reviewLoadRecord() {
  try {
    const raw = await StudyIDB.getAnswerRaw(reviewRecordKey(window.activeStudyId));
    return reviewParseRecord(raw);
  } catch (e) {
    console.warn('[review] could not read the saved best score.', e);
    return { done: false, best: {} };
  }
}

async function reviewSaveRecord(record) {
  try {
    await StudyIDB.setAnswerRaw(reviewRecordKey(window.activeStudyId), JSON.stringify(record));
  } catch (e) {
    console.warn('[review] could not save the best score.', e);
  }
}

// Shown in the Contents menu: the study has a review, the reader's setting is
// on (default), and the interface mode is Intermediate or Advanced.
function reviewVisibleInMenu() {
  const d = window.reviewData;
  const hasQuestions = !!d && typeof d === 'object' && ((Array.isArray(d.questions) && d.questions.length > 0) || !!d.auto);
  return hasQuestions && appSettings.showPageReview !== false && getInterfaceMode() !== 'basic';
}

async function reviewIsDone() {
  return (await reviewLoadRecord()).done === true;
}

function _rvTitle() {
  const d = window.reviewData || {};
  return studyText(d, 'title') || t('review_default_title');
}

async function renderReview() {
  closeMenu();
  _resetNonChapterPageState();
  isNonChapterPage = true;
  window.activeTabPage = 'review';
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.parentElement.style.display = 'none';
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('header-title').innerText = _rvTitle();

  const pool = reviewBuildPoolFromStudy();
  const record = await reviewLoadRecord();
  _rv = {
    pool, record, phase: 'start',
    count: Math.min(REVIEW_LIMITS.DEFAULT_COUNT, pool.length),
    ordered: false,
    session: [], idx: 0, score: 0, missed: [], isRetry: false, revealed: false, answered: false,
  };

  document.getElementById('mainContent').innerHTML = `
    <div class="howto-page review-page">
      <div class="howto-header">
        <div class="howto-eyebrow">${_rvText(t('review_eyebrow'))}</div>
        <div class="howto-title">${_rvText(_rvTitle())}</div>
      </div>
      <div id="reviewBody" class="review-body" aria-live="polite"></div>
      <div class="page-close-bar" id="reviewBar"></div>
      <div style="height: 40px;"></div>
    </div>`;
  window.scrollTo(0, 0);
  _rvStartView();
}

function _rvBody() { return document.getElementById('reviewBody'); }

function _rvBar(html) {
  const bar = document.getElementById('reviewBar');
  if (bar) bar.innerHTML = html;
}

function _rvCloseBtn() {
  return `<button class="page-close-btn" onclick="Router.back()"><span>${ICONS.close}</span> ${_rvText(t('renderpages_close_btn'))}</button>`;
}

// ── Start screen ─────────────────────────────────────────────────────────────

function _rvCountLabel(n) {
  return n === 1 ? t('review_count_one') : t('review_count_many', { count: n });
}

function _rvStartView() {
  const body = _rvBody();
  if (!body || !_rv) return;
  _rv.phase = 'start';
  const pool = _rv.pool;
  if (pool.length === 0) {
    body.innerHTML = `<p class="review-intro">${_rvText(t('review_no_questions'))}</p>`;
    _rvBar(_rvCloseBtn());
    return;
  }
  const intro = studyText(window.reviewData || {}, 'intro') || t('review_default_intro');
  const best = _rv.record.best[String(_rv.count)];
  const bestLine = best != null ? `<div class="review-best">${_rvText(t('review_best_line', { best, count: _rv.count }))}</div>` : '';
  const canChoose = pool.length > REVIEW_LIMITS.MIN_COUNT;
  body.innerHTML = `
    <p class="review-intro">${_rvText(intro)}</p>
    ${canChoose ? `
    <div class="review-setting">
      <div class="review-setting-label" id="reviewCountLabel">${_rvText(t('review_how_many'))}</div>
      <div class="review-stepper" role="group" aria-labelledby="reviewCountLabel">
        <button class="review-step-btn" onclick="reviewStepCount(-1)" aria-label="${_rvText(t('review_fewer'))}"${_rv.count <= REVIEW_LIMITS.MIN_COUNT ? ' disabled' : ''}>−</button>
        <div class="review-step-value" id="reviewCountValue">${_rvText(_rvCountLabel(_rv.count))}</div>
        <button class="review-step-btn" onclick="reviewStepCount(1)" aria-label="${_rvText(t('review_more'))}"${_rv.count >= pool.length ? ' disabled' : ''}>+</button>
      </div>
    </div>
    <div class="review-setting">
      <div class="review-setting-label" id="reviewOrderLabel">${_rvText(t('review_order_label'))}</div>
      <div class="settings-seg review-seg" role="group" aria-labelledby="reviewOrderLabel">
        <button class="settings-seg-btn${_rv.ordered ? '' : ' active'}" onclick="reviewSetOrder(false)" aria-pressed="${!_rv.ordered}">${_rvText(t('review_order_random'))}</button>
        <button class="settings-seg-btn${_rv.ordered ? ' active' : ''}" onclick="reviewSetOrder(true)" aria-pressed="${_rv.ordered}">${_rvText(t('review_order_set'))}</button>
      </div>
    </div>` : ''}
    <div id="reviewBestLine">${bestLine}</div>
    <button class="review-big-btn" onclick="reviewStart()">${_rvText(t('review_start_btn'))}</button>`;
  _rvBar(_rvCloseBtn());
}

function reviewStepCount(delta) {
  if (!_rv || _rv.phase !== 'start') return;
  _rv.count = Math.max(Math.min(REVIEW_LIMITS.MIN_COUNT, _rv.pool.length), Math.min(_rv.pool.length, _rv.count + delta));
  _rvStartView();
}

function reviewSetOrder(ordered) {
  if (!_rv || _rv.phase !== 'start') return;
  _rv.ordered = !!ordered;
  _rvStartView();
}

// ── A round ──────────────────────────────────────────────────────────────────

function _rvBeginRound(questions, isRetry) {
  _rv.session = questions.map(q => ({ q, options: [] }));
  _rv.idx = 0;
  _rv.score = 0;
  _rv.missed = [];
  _rv.isRetry = !!isRetry;
  _rv.phase = 'question';
  _rvQuestionView();
}

function reviewStart() {
  if (!_rv || _rv.pool.length === 0) return;
  _rvBeginRound(reviewSelect(_rv.pool, _rv.count, _rv.ordered), false);
}

function _rvQuestionView() {
  const body = _rvBody();
  if (!body || !_rv) return;
  const item = _rv.session[_rv.idx];
  item.options = reviewPickOptions(item.q);
  _rv.revealed = false;
  _rv.answered = false;
  const total = _rv.session.length;
  document.getElementById('progressBar').style.width = `${Math.round((_rv.idx / total) * 100)}%`;
  body.innerHTML = `
    <div class="review-progress">${_rvText(t('review_progress', { n: _rv.idx + 1, total }))}</div>
    <div class="review-question">${_rvText(item.q.question)}</div>
    ${item.q.quote ? `<blockquote class="review-quote">${_rvText(item.q.quote)}</blockquote>` : ''}
    <div id="reviewOptions"></div>
    <div id="reviewFeedback" role="status"></div>
    <button class="review-big-btn" id="reviewShowBtn" onclick="reviewShow()">${_rvText(t('review_show_answers'))}</button>`;
  _rvBar(`<button class="page-close-btn" onclick="reviewEnd()"><span>${ICONS.close}</span> ${_rvText(t('review_end_btn'))}</button>`);
  window.scrollTo(0, 0);
}

function reviewShow() {
  if (!_rv || _rv.phase !== 'question' || _rv.revealed) return;
  _rv.revealed = true;
  const item = _rv.session[_rv.idx];
  const holder = document.getElementById('reviewOptions');
  const showBtn = document.getElementById('reviewShowBtn');
  if (showBtn) showBtn.remove();
  holder.innerHTML = item.options.map((o, i) =>
    `<button class="review-option" id="reviewOpt${i}" onclick="reviewChoose(${i})"><span class="review-mark" aria-hidden="true"></span><span class="review-option-text">${_rvText(o.text)}</span></button>`
  ).join('');
}

function reviewChoose(i) {
  if (!_rv || _rv.phase !== 'question' || !_rv.revealed || _rv.answered) return;
  const item = _rv.session[_rv.idx];
  const picked = item.options[i];
  if (!picked) return;
  _rv.answered = true;
  item.options.forEach((o, k) => {
    const btn = document.getElementById(`reviewOpt${k}`);
    if (!btn) return;
    btn.disabled = true;
    const mark = btn.querySelector('.review-mark');
    if (o.correct) {
      btn.classList.add('review-option--correct');
      if (mark) mark.textContent = '✓';
      btn.setAttribute('aria-label', `${t('review_a11y_correct')}: ${o.text}`);
    } else if (k === i) {
      btn.classList.add('review-option--wrong');
      if (mark) mark.textContent = '✗';
      btn.setAttribute('aria-label', `${t('review_a11y_wrong')}: ${o.text}`);
    }
  });
  if (picked.correct) _rv.score++;
  else _rv.missed.push(item.q);

  const last = _rv.idx >= _rv.session.length - 1;
  const explain = item.q.explain ? `<div class="review-explain">${_rvText(item.q.explain)}</div>` : '';
  const seeChapter = !item.q.explain && item.q.chapter ? `<div class="review-explain">${_rvText(t('review_see_chapter', { n: item.q.chapter }))}</div>` : '';
  document.getElementById('reviewFeedback').innerHTML = `
    <div class="review-verdict ${picked.correct ? 'review-verdict--right' : 'review-verdict--wrong'}">${_rvText(picked.correct ? t('review_correct') : t('review_not_quite'))}</div>
    ${explain}${seeChapter}
    <button class="review-big-btn" onclick="reviewNext()">${_rvText(last ? t('review_finish') : t('review_next'))}</button>`;
}

function reviewNext() {
  if (!_rv || _rv.phase !== 'question' || !_rv.answered) return;
  if (_rv.idx >= _rv.session.length - 1) { _rvSummaryView(); return; }
  _rv.idx++;
  _rvQuestionView();
}

// Leaving a round part-way asks once, then goes back to the start screen.
async function reviewEnd() {
  if (!_rv) return;
  let leave = true;
  if (typeof Swal !== 'undefined') {
    const r = await Swal.fire({
      title: t('review_leave_title'), text: t('review_leave_text'), icon: 'question',
      showCancelButton: true, confirmButtonText: t('review_leave_confirm'), cancelButtonText: t('review_leave_cancel'),
    });
    leave = !!r.isConfirmed;
  }
  if (!leave || !_rv) return;
  document.getElementById('progressBar').style.width = '0%';
  _rvStartView();
}

// ── Summary ──────────────────────────────────────────────────────────────────

async function _rvSummaryView() {
  const body = _rvBody();
  if (!body || !_rv) return;
  _rv.phase = 'summary';
  const total = _rv.session.length;
  const score = _rv.score;
  document.getElementById('progressBar').style.width = '100%';

  let bestMsg = '';
  if (!_rv.isRetry) {
    const res = reviewApplyResult(_rv.record, total, score);
    _rv.record = res.record;
    await reviewSaveRecord(res.record);
    if (res.status === 'new') bestMsg = t('review_new_best', { previous: res.previous });
    else if (res.status === 'matched') bestMsg = t('review_matched_best', { best: res.previous, total });
    else if (res.status === 'below') bestMsg = t('review_beat_best', { best: res.previous, total });
  } else {
    bestMsg = t('review_retry_note');
  }
  if (!_rv || _rv.phase !== 'summary') return;   // the reader left while the score was saving

  const missed = _rv.missed;
  const missedList = missed.length ? `
    <div class="review-missed">
      <div class="review-missed-heading">${_rvText(t('review_missed_heading'))}</div>
      <ul>${missed.map(q => `<li><div class="review-missed-q">${_rvText(q.question)}${q.quote ? ` <span class="review-missed-quote">“${_rvText(q.quote)}”</span>` : ''}</div><div class="review-missed-a">${_rvText(q.correct)}</div></li>`).join('')}</ul>
    </div>` : '';
  body.innerHTML = `
    <div class="review-result">
      <div class="review-score">${_rvText(t('review_score', { score, total }))}</div>
      <div class="review-band">${_rvText(t(`review_band_${reviewBand(score, total)}`))}</div>
      ${bestMsg ? `<div class="review-best-msg">${_rvText(bestMsg)}</div>` : ''}
    </div>
    ${missedList}
    ${missed.length ? `<button class="review-big-btn" onclick="reviewRetryMissed()">${_rvText(t('review_retry_missed'))}</button>` : ''}
    <button class="review-big-btn${missed.length ? ' review-big-btn--quiet' : ''}" onclick="reviewAnother()">${_rvText(t('review_another'))}</button>`;
  _rvBar(`<button class="page-close-btn" onclick="Router.back()"><span>${ICONS.close}</span> ${_rvText(t('review_done'))}</button>`);
  window.scrollTo(0, 0);
}

function reviewRetryMissed() {
  if (!_rv || _rv.phase !== 'summary' || _rv.missed.length === 0) return;
  _rvBeginRound(_rv.missed.slice(), true);
}

function reviewAnother() {
  if (!_rv || _rv.phase !== 'summary') return;
  document.getElementById('progressBar').style.width = '0%';
  _rvStartView();
}
