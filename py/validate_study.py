#!/usr/bin/env python3
"""Check a Bible Study Reader study against STUDY-FORMAT.md section 13.

Usage:  python3 validate_study.py [--explain] study.json      (or a .estudy zip)

--explain also prints, for every sample answer and main point, how it fared in the
answer check: the result, how many keyTerms matched (and which did not), how much of
it repeats the passage, and its length. Use it when rewording an answer.

The app does no validation of its own, so these are the mistakes that fail
silently. Errors mean something will not work; warnings mean a field is
ignored or a habit is risky. Exit status is 1 if there are any errors.
Standard library only. The answer-check test also needs Node.js and the app's own
answer-match.js (in ../app/js/, next to this script, or at the path in the
ANSWER_MATCH_JS environment variable). If either is missing, that is an error: the
test cannot run, and a study is not checked until it can.
"""
import difflib, html, json, os, re, shutil, subprocess, sys, unicodedata, zipfile

ID_RE = re.compile(r'^[A-Za-z0-9_.-]+$')
GD_RESERVED = {'chapterNumber', 'backToStudy', 'format', 'title', 'footnotes',
               'previousLabel', 'nextLabel'}
IGNORED_IN_ELEMENTS = ['answerType', 'required', 'commentHint']
IGNORED_IN_METADATA = ['tags', 'createdAt', 'updatedAt', 'shareMessage', 'publishedBy',
                       'year', 'ctaLabel']
errors, warnings = [], []
explained = []
EXPLAIN = False
ANSWER_CHECK_NOTE = ''
err = lambda m: errors.append(m)
warn = lambda m: warnings.append(m)


def strings(o, path='', out=None):
    """Every (path, string) in a JSON value."""
    out = [] if out is None else out
    if isinstance(o, str):
        out.append((path, o))
    elif isinstance(o, list):
        for i, v in enumerate(o):
            strings(v, f'{path}[{i}]', out)
    elif isinstance(o, dict):
        for k, v in o.items():
            strings(v, f'{path}.{k}' if path else k, out)
    return out


def icon_names():
    """Keys of ICONS_ROUNDED in app/js/icons.js, or None if that file is not found."""
    here = os.path.dirname(os.path.abspath(__file__))
    p = next((q for q in (os.path.join(here, '..', 'app', 'js', 'icons.js'), os.path.join(here, 'icons.js'))
              if os.path.isfile(q)), None)
    try:
        src = open(p, encoding='utf-8').read()
        a = src.index('const ICONS_ROUNDED = {')
        return set(re.findall(r'^\s{2}([A-Za-z0-9]+):\s*`', src[a:src.index('\n};', a)], re.M))
    except (OSError, ValueError, TypeError):
        return None


def shelf_structure():
    """{shelf: {section: [subsection, ...]}} from the English libraryShelvesStructure file, or None if not found."""
    here = os.path.dirname(os.path.abspath(__file__))
    p = next((q for q in (os.path.join(here, '..', 'app', 'js', 'locales', 'en', 'libraryShelvesStructure_en.json'),
                          os.path.join(here, 'libraryShelvesStructure_en.json')) if os.path.isfile(q)), '')
    try:
        data = json.load(open(p, encoding='utf-8'))
        return {sh['shelf']: {sec['section']: [x['name'] if isinstance(x, dict) else x
                                               for x in sec.get('subsections') or []]
                              for sec in sh.get('sections') or []} for sh in data}
    except (OSError, ValueError, KeyError, TypeError):
        return None


def check_shelves(meta):
    """libraryShelves names are matched as text and never verified by the app: a name that is not in the
    shelf list still shows, but as an extra shelf/section after the standard ones, with no description."""
    ls = meta.get('libraryShelves')
    structure = shelf_structure()
    if ls is None or structure is None:
        return
    placements = ls if isinstance(ls, list) else [ls]
    # the app ignores the difference between straight and typographic apostrophes
    nz = lambda s: re.sub('[\u2018\u2019\u02bc]', "'", str(s))
    has = lambda name, options: nz(name) in {nz(o) for o in options}

    def near(name, options):
        close = difflib.get_close_matches(str(name), list(options), n=1, cutoff=0.6)
        return f' (did you mean {close[0]!r}?)' if close else ''

    for i, p in enumerate(placements):
        where = f'studyMetadata.libraryShelves[{i}]'
        if not isinstance(p, dict) or not p.get('Shelf'):
            warn(f'{where}: no Shelf, so this placement is ignored')
            continue
        shelf, sec, sub = p.get('Shelf'), p.get('Section'), p.get('Subsection')
        if not has(shelf, structure):
            warn(f'{where}: Shelf {shelf!r} is not in libraryShelvesStructure_en.json, so it shows as an extra '
                 f'shelf with no description{near(shelf, structure)}')
            continue
        if sub and not sec:
            warn(f'{where}: Subsection {sub!r} has no Section, so it is not shown (the study sits loose under {shelf!r})')
        shelf = next(k for k in structure if nz(k) == nz(shelf))
        if sec and not has(sec, structure[shelf]):
            warn(f'{where}: Section {sec!r} is not in the {shelf!r} shelf, so it shows after the standard '
                 f'sections with no description{near(sec, structure[shelf])}')
            continue
        sec = next((k for k in structure[shelf] if nz(k) == nz(sec)), sec)
        if sec and sub and not has(sub, structure[shelf][sec]):
            warn(f'{where}: Subsection {sub!r} is not in {shelf!r} > {sec!r}, so it shows after the standard '
                 f'subsections with no description{near(sub, structure[shelf][sec])}')


SC_MARKER_RE = re.compile(r'\[\[sc:(.*?)\]\]')
DIVINE_SPAN_RE = re.compile(r'<span\s+class=["\']divine-name["\']', re.I)
BODY_PATH_RE = re.compile(r'(^|\.)body\d*(\[\d+\])?$')


def sc_text_ok(text):
    """[[sc:Text]] allows letters (any script), combining marks, spaces, apostrophes
    and full stops, starting with a letter or mark, at most 60 characters."""
    if not text or len(text) > 60:
        return False
    cat = lambda c: unicodedata.category(c)
    if not (cat(text[0]).startswith('L') or cat(text[0]).startswith('M')):
        return False
    return all(cat(c).startswith(('L', 'M')) or c in " '\u2019." for c in text)


def check_markers(study):
    """[[sc:Text]] must be well formed; a divine-name span is escaped to visible
    text wherever the field is rendered as markdown."""
    for path, s in strings(study):
        for m in SC_MARKER_RE.findall(s):
            if not sc_text_ok(m):
                warn(f'{path}: [[sc:{m}]] has disallowed characters or is too long, so it will show as literal text '
                     '(allowed: letters, spaces, apostrophes, full stops; up to 60 characters)')

    def md_warn(path):
        warn(f'{path}: <span class="divine-name"> in a markdown field shows as literal text; use [[sc:Text]]')

    for ch in study.get('chapters') or []:
        for el in ch.get('elements') or []:
            eid = el.get('elementId', '?')
            if str(el.get('format', '')).lower() == 'markdown':
                for k, v in el.items():
                    if re.match(r'(text|caption|header)\d*$', k) and isinstance(v, str) and DIVINE_SPAN_RE.search(v):
                        md_warn(f'element {eid}.{k}')
            if str(el.get('mainPointFormat', 'markdown')).lower() == 'markdown':
                for k, v in el.items():
                    if re.match(r'mainPoint\d*$', k) and isinstance(v, str) and DIVINE_SPAN_RE.search(v):
                        md_warn(f'element {eid}.{k}')
    for name in ('goDeeperData', 'leadersNotesData'):
        d = study.get(name) or {}
        top = str(d.get('format', '')).lower()
        parts = [('intro', d.get('intro'), top)] + [
            (f'chapter {c.get("chapterNumber")}', c, str(c.get('format', d.get('format', ''))).lower())
            for c in d.get('chapters') or []]
        for label, part, fmt in parts:
            if fmt != 'markdown':
                continue
            for path, s in strings(part):
                if BODY_PATH_RE.search(path) and DIVINE_SPAN_RE.search(s):
                    md_warn(f'{name} {label} {path}')


ELEMENT_TYPES = {'heading', 'text', 'biblePassage', 'question', 'image', 'callout', 'likertScale'}
HEADING_SUBTYPES = {'section', 'subsection', 'reflection'}
CALLOUT_SUBTYPES = {'general', 'misunderstanding', 'highlighted', 'activity'}


def check_structure(study):
    """Shapes that make the app throw or draw nothing: a chapter that is not an
    object, `elements` that is not an array, an element that is null... Each is
    reported, then dropped so the remaining checks can run on what is usable."""
    if not isinstance(study, dict):
        err('the file must hold one JSON object')
        return False
    if not isinstance(study.get('studyMetadata'), dict):
        err('studyMetadata is missing or is not an object')
        study['studyMetadata'] = {}
    chapters = study.get('chapters')
    if isinstance(chapters, list):
        kept = []
        for i, ch in enumerate(chapters):
            if not isinstance(ch, dict):
                err(f'chapters[{i}] is not an object, so the chapter cannot be shown')
                continue
            els = ch.get('elements')
            if els is not None and not isinstance(els, list):
                err(f'chapter {ch.get("chapterNumber", i)}: elements must be an array, so the chapter will not open')
                ch['elements'] = []
            elif els:
                good = []
                for j, el in enumerate(els):
                    if isinstance(el, dict):
                        good.append(el)
                    else:
                        err(f'chapter {ch.get("chapterNumber", i)}: elements[{j}] is not an object, so the whole chapter will not open')
                ch['elements'] = good
            kept.append(ch)
        study['chapters'] = kept
    for name in ('goDeeperData', 'leadersNotesData'):
        d = study.get(name)
        if d is None:
            continue
        if not isinstance(d, dict):
            err(f'{name} must be an object')
            study[name] = {}
            continue
        cs = d.get('chapters')
        if cs is not None and not isinstance(cs, list):
            err(f'{name}.chapters must be an array')
            d['chapters'] = []
        elif cs:
            d['chapters'] = [c for c in cs if isinstance(c, dict)]
            for c in cs:
                if not isinstance(c, dict):
                    err(f'{name}.chapters has an entry that is not an object')
            for c in d['chapters']:
                fns = c.get('footnotes')
                if fns is not None and not (isinstance(fns, list) and all(isinstance(f, dict) for f in fns)):
                    err(f'{name} chapter {c.get("chapterNumber")}: footnotes must be an array of {{id, body}} objects')
                    c['footnotes'] = []
    return True


def numbered(el, base):
    """(key, value) for `base` and its numbered slots (base1, base2 ...)."""
    return [(k, v) for k, v in el.items() if re.fullmatch(re.escape(base) + r'\d*', k)]


def check_element_shapes(where, el):
    """Field shapes the renderers rely on. A wrong one does not stop the study:
    the app shows a warning marker in place of that one item."""
    if 'repeatElement' in el:
        return                      # a pointer to another element: nothing of its own to check
    typ = el.get('type')
    sub = el.get('subtype')
    marker = '(the item is replaced by a warning marker)'

    def need_string(base):
        for k, v in numbered(el, base):
            if v is not None and not isinstance(v, str):
                err(f'{where}: {k} must be a string, not {type(v).__name__} {marker}')

    if typ is None:
        warn(f'{where}: no type, so the item is skipped')
    elif typ not in ELEMENT_TYPES:
        warn(f'{where}: unknown type {typ!r} is skipped (known: {", ".join(sorted(ELEMENT_TYPES))})')
        return
    if typ in ('heading', 'text'):
        need_string('text')
    if typ == 'heading' and sub not in HEADING_SUBTYPES:
        warn(f'{where}: heading subtype {sub!r} renders nothing (use section, subsection or reflection)')
    if typ == 'question' and sub == 'header':
        need_string('header')
    if typ == 'image':
        need_string('caption')
    if typ == 'callout':
        if sub not in CALLOUT_SUBTYPES:
            warn(f'{where}: callout subtype {sub!r} renders nothing (use general, misunderstanding, highlighted or activity)')
        if sub == 'highlighted':
            need_string('body')
    if typ == 'likertScale':
        bipolar = sub == 'bipolar'
        rows_key = 'statementPairs' if bipolar else 'statements'
        rows = numbered(el, rows_key)
        if not any(v for _, v in rows):
            warn(f'{where}: no {rows_key}, so the card has no rows')
        for k, v in rows:
            if not isinstance(v, list):
                err(f'{where}: {k} must be an array {marker}')
            elif bipolar:
                for i, pair in enumerate(v):
                    if not (isinstance(pair, dict) and isinstance(pair.get('left'), str) and isinstance(pair.get('right'), str)):
                        err(f'{where}: {k}[{i}] must be an object with string "left" and "right" (a missing side shows as "undefined")')
            elif not all(isinstance(s, str) for s in v):
                warn(f'{where}: {k} should be an array of strings (other values are shown as written)')
        for k, v in numbered(el, 'scale'):
            if not (isinstance(v, list) and all(isinstance(s, str) for s in v)):
                err(f'{where}: {k} must be an array of label strings {marker}')
        sn = el.get('scaleNumber')
        if sn is not None:
            try:
                ok = 1 <= int(float(sn)) <= 10
            except (TypeError, ValueError):
                ok = False
            if not ok:
                warn(f'{where}: scaleNumber {sn!r} is not between 1 and 10; the app uses its default or clamps it')


# keyTerms is NOT a regular expression (answer-match.js parseKeyTerms): only "|",
# a trailing "$" and a leading "*" mean anything, and every other punctuation
# mark becomes a space. So "moses.*not able" is the phrase "moses not able".
KT_REGEX_RE = re.compile(r'\.[*+?]|\\[A-Za-z]|[\[\]{}^()]|[*+]|\$(?=.)')


def check_key_terms(where, kt):
    for term in kt:
        alts = term.split('|')
        if len(alts) > 10:
            warn(f'{where}: keyTerms entry {term[:40]!r}... has {len(alts)} alternatives; only the first 10 are used')
        for alt in alts:
            core = alt.strip()
            if core.startswith('*'):
                core = core[1:]
            elif core.endswith('$'):
                core = core[:-1]
            if len(core) > 60:
                warn(f'{where}: keyTerms alternative {alt[:40]!r}... is over 60 characters and is cut short')
            if KT_REGEX_RE.search(core):
                plain = re.sub(r'\s+', ' ', re.sub(r'[^\w\s]', ' ', re.sub(r"['\u2019\u02bc]", '', core))).strip().lower()
                warn(f'{where}: keyTerms alternative {alt!r} looks like a regular expression; the app is not one and '
                     f'turns punctuation into spaces, so this only matches the phrase {plain!r} '
                     '(only "|", a trailing "$" and a leading "*" are special)')


def check_translations(study):
    """bibleTranslation1 switches every passage to the numbered fields only."""
    meta = study.get('studyMetadata') or {}
    if not meta.get('bibleTranslation1'):
        return
    for ch in study.get('chapters') or []:
        for el in ch.get('elements') or []:
            if el.get('type') == 'biblePassage' and el.get('passageText') and not el.get('passageText1'):
                err(f'chapter {ch.get("chapterNumber")}, {el.get("elementId")}: studyMetadata.bibleTranslation1 is set, '
                    'so this unnumbered passageText is never read and the passage has no pop-up '
                    '(remove bibleTranslation1 in a single-translation study)')


def check_leaders(study, multilingual):
    ln = study.get('leadersNotesData') or {}
    reserved = {'chapterNumber', 'format', 'title', 'chapterTitle'}
    for c in ln.get('chapters') or []:
        n = c.get('chapterNumber')
        if not isinstance(n, int) or isinstance(n, bool):
            err(f"Leaders' Notes chapterNumber {n!r} must be an integer (otherwise the chapter gets no tab and is never shown)")
        fmt = str(c.get('format', ln.get('format', ''))).lower()
        for k, v in c.items():
            if k in reserved or re.match(r'(title|chapterTitle)\d+$', k):
                continue
            if re.search(r'\d$', k):
                (err if multilingual else warn)(
                    f"Leaders' Notes {n}: block key {k!r} ends in a digit"
                    + (' (a language slot in a multilingual study)' if multilingual else ''))
            for path, s in strings(v):
                if '<table' in s and fmt == 'markdown':
                    err(f"Leaders' Notes {n}: table in a markdown-format chapter is stripped; use format \"HTML\"")


def keys_anywhere(o, names, path='', out=None):
    out = [] if out is None else out
    if isinstance(o, dict):
        for k, v in o.items():
            if k in names:
                out.append(f'{path}.{k}' if path else k)
            keys_anywhere(v, names, f'{path}.{k}' if path else k, out)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            keys_anywhere(v, names, f'{path}[{i}]', out)
    return out


def table_widths(html):
    for t in re.findall(r'<table\b.*?</table>', html, re.S):
        widths = []
        for r in re.findall(r'<tr\b.*?</tr>', t, re.S):
            w = 0
            for attrs in re.findall(r'<t[hd]\b([^>]*)>', r, re.S):
                m = re.search(r'colspan="(\d+)"', attrs)
                w += int(m.group(1)) if m else 1
            widths.append(w)
        yield widths


# ---------------------------------------------------------------------------
# Answer-check test: run each question's sampleAnswer and mainPoint through the
# app's real matcher (answer-match.js), exactly as the app would for a reader who
# typed that text. Both should reach "strong" (or "pass" where there are no
# keyTerms). Otherwise a reader who copies the sample answer or the main point
# can still be told "partial", "off topic" or "repeats the passage".
# Node.js and answer-match.js are used so the result is the app's own, not an
# approximation. Findings are warnings.
AM_RUNNER = r"""
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(process.argv[1], 'utf8') +
  '\n;globalThis.__api = { evaluateAnswer, normaliseText, tokenise, _isContent, parseKeyTerms, matchKeyTerms,' +
  ' countWords, AM_LIMITS, STOPWORDS_BY_LANG };';
const ctx = { console }; vm.createContext(ctx); vm.runInContext(src, ctx);
const A = ctx.__api;
const jobs = JSON.parse(fs.readFileSync(0, 'utf8'));
function detail(j) {
  const lang = String(j.lang || 'en').toLowerCase().split(/[-_]/)[0] || 'en';
  const limit = A.STOPWORDS_BY_LANG[lang] ? A.AM_LIMITS.RATIO_WITH_STOPWORDS : A.AM_LIMITS.RATIO_NO_STOPWORDS;
  const toks = A.tokenise(A.normaliseText(j.answer), lang).filter(t => A._isContent(t, lang, 2));
  const pw = new Set();
  for (const p of (j.passageTexts || [])) for (const t of A.tokenise(A.normaliseText(p), lang)) if (A._isContent(t, lang, 2)) pw.add(t);
  const fresh = toks.filter(t => !pw.has(t));
  const raw = Array.isArray(j.keyTerms) ? j.keyTerms.filter(x => typeof x === 'string' && x !== '') : [];
  const terms = A.parseKeyTerms(j.keyTerms);
  const missed = [];
  terms.forEach((t, i) => { if (A.matchKeyTerms(j.answer, [t], lang).matched === 0) missed.push(raw[i]); });
  let minWords = 6;
  const th = j.shortAnswerThreshold;
  const ov = (typeof th === 'number' || (typeof th === 'string' && th !== '')) ? parseInt(th, 10) : NaN;
  if (Number.isFinite(ov)) minWords = ov;
  else if (j.sampleAnswer) minWords = Math.min(6, Math.round(A.countWords(j.sampleAnswer, lang) * 0.35));
  return { overlap: toks.length ? 1 - fresh.length / toks.length : 0, limit, hasPassage: pw.size > 0,
           fresh: Array.from(new Set(fresh)).slice(0, 12), missed, total: terms.length,
           words: A.countWords(j.answer, lang), minWords };
}
process.stdout.write(JSON.stringify(jobs.map(j => ({ r: A.evaluateAnswer(j), x: detail(j) }))));
"""


def find_answer_match():
    here = os.path.dirname(os.path.abspath(__file__))
    for p in (os.environ.get('ANSWER_MATCH_JS'),
              os.path.join(here, '..', 'app', 'js', 'answer-match.js'),
              os.path.join(here, 'answer-match.js')):
        if p and os.path.isfile(p):
            return p
    return None


def _plain(s):
    """Text a reader would type or see, for a question, sample answer or main point:
    [[sc:Text]] becomes Text, [[icon:name]] goes, tags become spaces, markdown emphasis and
    links lose their marks, entities are decoded."""
    s = re.sub(r'\[\[sc:(.*?)\]\]', r'\1', str(s))
    s = re.sub(r'\[\[icon:[A-Za-z0-9]*\]\]', '', s)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', s)
    s = re.sub(r'[*_`]{1,3}', '', s)
    return re.sub(r'\s+', ' ', html.unescape(s)).strip()


def _plain_passage(raw):
    """A passage as the app compares it (_lvPlainPassage in validation.js): [[sc:Text]] becomes
    Text, a <sup> verse number is dropped, every other tag becomes a space, entities are decoded,
    and a verse number stuck to a word ("21For") is removed."""
    s = re.sub(r'\[\[sc:(.*?)\]\]', r'\1', str(raw))
    s = re.sub(r'<sup\b[^>]*>\s*\d+[a-z]?\s*</sup>', ' ', s, flags=re.I)
    s = re.sub(r'<[^>]*>', ' ', s)
    s = html.unescape(s)
    s = re.sub(r'\b\d+(?=[a-zA-Z])', '', s)
    return re.sub(r'\s+', ' ', s).strip()


def check_answers(study, multilingual, explain=False):
    meta = study.get('studyMetadata') or {}
    global ANSWER_CHECK_NOTE
    lang = str(meta.get('language1' if multilingual else 'language') or 'en')
    slot = '1' if multilingual else ''
    if multilingual:
        ANSWER_CHECK_NOTE = ' (first language only)'
    jobs, labels = [], []
    for ch in study.get('chapters') or []:
        passages = {}
        for el in ch.get('elements') or []:
            if el.get('type') == 'biblePassage':
                for k, v in el.items():
                    m = re.fullmatch(r'bibleRef(\d*)', k)
                    if m and v:
                        txt = el.get('passageText' + m.group(1))
                        if isinstance(txt, str):
                            passages.setdefault(v, []).append(_plain_passage(txt))
                continue
            if el.get('type') != 'question' or el.get('subtype') == 'reflection' and not el.get('linkedPassage'):
                continue
            if el.get('type') == 'question' and el.get('subtype') in ('header',):
                continue
            kt = el.get('keyTerms' + slot)
            sample = el.get('sampleAnswer' + slot)
            main = el.get('mainPoint' + slot)
            if not kt and not sample:
                continue
            base = {'questionText': _plain(el.get('question' + slot, '')),
                    'passageTexts': passages.get(el.get('linkedPassage'), []),
                    'sampleAnswer': sample if isinstance(sample, str) else '',
                    'keyTerms': kt, 'lang': lang,
                    'shortAnswerThreshold': el.get('shortAnswerThreshold' + slot, el.get('shortAnswerThreshold')),
                    'skipBibleVerseCheck': bool(el.get('skipBibleVerseCheck'))}
            where = f'chapter {ch.get("chapterNumber")}, {el.get("elementId")}'
            for field, text in (('sampleAnswer', sample), ('mainPoint', main)):
                if isinstance(text, str) and text.strip():
                    jobs.append(dict(base, answer=_plain(text)))
                    labels.append((where, field))
    if not jobs:
        return
    path = find_answer_match()
    if not path:
        err('answer-check test cannot run: answer-match.js not found (put the app\'s answer-match.js next to this '
            'script, or in ../app/js/, or set ANSWER_MATCH_JS)')
        return
    if not shutil.which('node'):
        err('answer-check test cannot run: Node.js not found')
        return
    try:
        out = subprocess.run(['node', '-e', AM_RUNNER, path], input=json.dumps(jobs), capture_output=True,
                             text=True, timeout=60)
        results = json.loads(out.stdout)
    except Exception as e:  # noqa: BLE001
        err(f'answer-check test could not run: {e}')
        return
    why = {'partial': 'matches too few of its keyTerms, so a reader who copies it is told "partial"',
           'offTopic': 'matches none of its keyTerms',
           'repeatsPassage': 'is flagged as repeating the passage (over 70% of its content words appear in it); '
                             'put it in your own words and give the keyTerms plain-English alternatives',
           'repeatsQuestion': 'is flagged as repeating the question',
           'tooShort': 'is too short for the answer check', 'stuck': 'is treated as a filler answer'}
    for (where, field), item in zip(labels, results):
        r, x = item['r'], item['x']
        code = r.get('code')
        if explain:
            tot = x['total']
            need = max(-(-tot // 2), min(2, tot)) if tot else 0
            bits = [f'{field}: {code}']
            if tot:
                bits.append(f'keyTerms {tot - len(x["missed"])} of {tot} (needs {need})')
            if x['hasPassage']:
                bits.append(f'repeats the passage {round(x["overlap"] * 100)}% (limit {round(x["limit"] * 100)}%)')
            bits.append(f'{x["words"]} words (minimum {x["minWords"]})')
            line = f'{where}: ' + '; '.join(bits)
            if x['missed']:
                line += '; missed: ' + ', '.join(f'"{m}"' for m in x['missed'])
            if code == 'repeatsPassage' and x['fresh']:
                line += '; words not in the passage: ' + ', '.join(x['fresh'])
            elif code == 'repeatsPassage':
                line += '; no words of its own'
            explained.append(line)
        if code in ('strong', 'pass', 'passNoSample'):
            continue
        extra = f' ({r.get("matched")} of {r.get("total")} keyTerms)' if code in ('partial', 'offTopic') else ''
        warn(f'{where}: {field} {why.get(code, "does not pass the answer check: " + str(code))}{extra}')


def load(path):
    zf = None
    if zipfile.is_zipfile(path):
        zf = zipfile.ZipFile(path)
        name = next((n for n in zf.namelist() if n.endswith('study.json')), None)
        if not name:
            err('zip has no study.json')
            return None, zf
        return json.loads(zf.read(name).decode('utf-8')), zf
    with open(path, encoding='utf-8') as f:
        return json.load(f), None


def main(path):
    try:
        study, zf = load(path)
    except Exception as e:  # noqa: BLE001
        err(f'cannot read as JSON: {e}')
        return
    if study is None:
        return
    if not check_structure(study):
        return
    meta = study.get('studyMetadata') or {}
    sid = meta.get('studyId', '')
    if not ID_RE.match(str(sid)):
        err(f'studyId {sid!r} must match [A-Za-z0-9_.-]+')
    sv = meta.get('studyVersion')
    sv_ok = (isinstance(sv, (int, float)) and not isinstance(sv, bool)) or \
            (isinstance(sv, str) and re.fullmatch(r'\d+(\.\d+)?', sv.strip()))
    if not sv_ok:
        warn('studyVersion should be a decimal number with two places, such as 1.03 (1.01 ... 1.09, then 1.10)')
    elif isinstance(sv, str) and sv.strip() != str(sv):
        warn('studyVersion has spaces around it')
    check_shelves(meta)
    multilingual = 'language1' in meta
    chapters = study.get('chapters')
    if not isinstance(chapters, list) or not chapters:
        err('chapters[] is missing or empty')
        chapters = []

    check_markers(study)
    names = icon_names()
    if names:
        for path_, s_ in strings(study):
            for m in re.findall(r'\[\[icon:([A-Za-z0-9]*)\]\]', s_):
                if m not in names:
                    warn(f'{path_}: [[icon:{m}]] is not an app icon and will be removed')

    check_translations(study)
    check_leaders(study, multilingual)
    check_answers(study, multilingual, EXPLAIN)

    seen_ids, nums = {}, set()
    for ch in chapters:
        n = ch.get('chapterNumber')
        if not isinstance(n, int) or isinstance(n, bool):
            err(f'chapterNumber {n!r} must be an integer')
        elif n in nums:
            err(f'duplicate chapterNumber {n}')
        nums.add(n)
        refs_so_far, ids_in_ch = set(), set()
        # A chapter with no biblePassage elements uses linkedPassage as a plain
        # reference label (nothing to tap), which is legitimate.
        chapter_has_passages = any(e.get('type') == 'biblePassage' for e in ch.get('elements', []))
        for el in ch.get('elements', []):
            eid = el.get('elementId')
            where = f'chapter {n}, {eid or el.get("type")}'
            if eid is None:
                if 'repeatElement' not in el:
                    err(f'{where}: no elementId')
            else:
                if not ID_RE.match(str(eid)):
                    err(f'{where}: elementId has characters outside [A-Za-z0-9_.-]')
                if eid in seen_ids:
                    err(f'duplicate elementId {eid} (chapters {seen_ids[eid]} and {n})')
                seen_ids.setdefault(eid, n)
                ids_in_ch.add(eid)
            if el.get('type') == 'biblePassage':
                for k, v in el.items():
                    if re.fullmatch(r'bibleRef\d*', k) and v:
                        refs_so_far.add(v)
            lp = el.get('linkedPassage')
            if lp and el.get('subtype') == 'reflection':
                warn(f'{where}: a reflection with linkedPassage {lp!r} gets the answer-check button; remove it')
            elif lp and lp not in refs_so_far and chapter_has_passages:
                norm = lambda s: re.sub(r'[–—-]', '-', s)
                later = any(norm(lp) == norm(r) for r in refs_so_far)
                err(f'{where}: linkedPassage {lp!r} matches no earlier bibleRef (so it is not tappable)'
                    + (' (differs only in the dash type)' if later else ''))
            kt = el.get('keyTerms')
            if kt is not None:
                if not (isinstance(kt, list) and all(isinstance(x, str) and x.strip() for x in kt)):
                    err(f'{where}: keyTerms must be an array of non-empty strings')
                elif len(kt) > 12:
                    warn(f'{where}: keyTerms has {len(kt)} entries; only 12 are used')
                else:
                    check_key_terms(where, kt)
            hf = el.get('questionHintFirst')
            if hf is not None and not isinstance(hf, str):
                warn(f'{where}: questionHintFirst must be a string; anything else is ignored, so there is no first hint')
            elif isinstance(hf, str) and hf.strip() and hf.strip() == str(el.get('questionHint', '')).strip():
                warn(f'{where}: questionHintFirst is identical to questionHint; the first hint should only nudge')
            mp = el.get('mainPoint')
            if isinstance(mp, str) and len(mp) > 2000:
                warn(f'{where}: mainPoint is over 2,000 characters')
            if el.get('type') in ('question', 'callout') and 'elementId' not in el:
                err(f'{where}: missing elementId')
            check_element_shapes(where, el)
        for el in ch.get('elements', []):
            r = el.get('repeatElement')
            if r and r not in ids_in_ch:
                err(f'chapter {n}: repeatElement {r!r} not found in the same chapter')

    gd = study.get('goDeeperData') or {}
    top_format = str(gd.get('format', '')).lower()
    for ch in gd.get('chapters', []):
        n = ch.get('chapterNumber')
        if not isinstance(n, int) or isinstance(n, bool):
            err(f'Go Deeper chapterNumber {n!r} must be an integer')
        fmt = str(ch.get('format', gd.get('format', ''))).lower()
        footnotes = ch.get('footnotes', [])
        ids = [f.get('id') for f in footnotes]
        if len(set(ids)) != len(ids) or not all(isinstance(i, int) for i in ids):
            err(f'Go Deeper {n}: footnote ids {ids} must be unique integers')
        elif ids != list(range(1, len(ids) + 1)):
            warn(f'Go Deeper {n}: footnote ids {ids} do not run 1..N (works, but 1..N is the convention)')
        body = {k: v for k, v in ch.items() if k != 'footnotes'}
        used = sorted({int(m) for _, s in strings(body) for m in re.findall(r'\[\[fn:(\d+)\]\]', s)})
        if used != sorted(i for i in ids if isinstance(i, int)):
            err(f'Go Deeper {n}: [[fn:N]] markers {used} do not match footnote ids {ids}')
        for k in ch:
            if k in GD_RESERVED or re.match(r'(title|previousLabel|nextLabel)\d+$', k):
                continue
            if re.search(r'\d$', k):
                (err if multilingual else warn)(
                    f'Go Deeper {n}: block key {k!r} ends in a digit'
                    + (' (a language slot in a multilingual study)' if multilingual else ''))
        for path, s in strings(body):
            if '<table' in s:
                if fmt == 'markdown':
                    err(f'Go Deeper {n}: table in a markdown-format chapter is stripped; use format "HTML"')
                for w in table_widths(s):
                    if len(set(w)) > 1:
                        err(f'Go Deeper {n} {path}: table rows have different widths {w}')

    for p, s in strings(study):
        if re.search(r'<script', s, re.I):
            err(f'{p}: <script>')
        if re.search(r'\sstyle\s*=', s, re.I):
            warn(f'{p}: style attribute (unsupported; use a class)')
        if re.search(r'=\s*[’‘“”]', s):
            err(f'{p}: curly quote used as an HTML attribute quote')
    for p, s in strings(study):
        if '${' in s:
            err(f'{p}: unsubstituted template placeholder ${{...}}')
    for ci, ch in enumerate(chapters):
        for el in ch.get('elements', []):
            if el.get('type') == 'callout' and '<table' in str(el.get('answer', '')):
                err(f'chapter {ch.get("chapterNumber")}, {el.get("elementId")}: a table in a callout answer is stripped to run-on text; use a list')
    cd = study.get('copyrightData')
    if isinstance(cd, dict):
        lt = cd.get('licenceText')
        if lt is not None and not (
                (isinstance(lt, str) and lt.strip()) or
                (isinstance(lt, list) and lt and all(isinstance(x, str) and x.strip() for x in lt))):
            err('copyrightData.licenceText must be a non-empty string or an array of non-empty strings')
        if 'licence' in cd:
            warn('copyrightData.licence is ignored; to replace the CC BY-SA text on the copyright page, use licenceText')
        # Only a notice that BEGINS with it: Bible-translation credits end with "All rights reserved."
        # and say nothing about how the study itself may be used.
        elif lt is None and any(re.match(r'\s*(<[^>]+>\s*)*all rights reserved', str(n), re.I) for n in (cd.get('notices') or [])):
            warn('copyrightData says "All rights reserved" but has no licenceText, so the copyright page will also show CC BY-SA 4.0')
    if 'studyAiData' in study:
        warn('studyAiData is deprecated and ignored; remove it')
    for p in keys_anywhere(study, {'apiKey'}):
        err(f'{p}: never ship an API key in a study')
    for p in keys_anywhere(chapters, set(IGNORED_IN_ELEMENTS)):
        warn(f'chapters{p}: field is ignored by the app')
    for k in IGNORED_IN_METADATA:
        if k in meta:
            warn(f'studyMetadata.{k}: field is ignored by the app')
    if 'bibleTranslation' in meta:
        warn('studyMetadata.bibleTranslation is ignored; use bibleTranslation1..N')

    if zf is not None:
        names = set(zf.namelist())
        for ch in chapters:
            for el in ch.get('elements', []):
                if el.get('type') == 'image' and not el.get('src') and f'images/{el.get("elementId")}.webp' not in names:
                    err(f'image {el.get("elementId")}: images/{el.get("elementId")}.webp is not in the zip')
        for _, s in strings(gd):
            if re.fullmatch(r'images/[A-Za-z0-9._-]+\.(webp|png|jpe?g)', s) and s not in names:
                err(f'gallery file {s} is not in the zip')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != '--explain']
    EXPLAIN = '--explain' in sys.argv[1:]
    if len(args) != 1 or len(sys.argv[1:]) - len(args) > 1:
        sys.exit(__doc__)
    main(args[0])
    if EXPLAIN and explained:
        print('Answer-check detail (sampleAnswer and mainPoint, as the app would judge them)' + ANSWER_CHECK_NOTE + ':')
        for m in explained:
            print('  ', m)
        print()
    for m in errors:
        print('ERROR  ', m)
    for m in warnings:
        print('warning', m)
    print(f'\n{len(errors)} error(s), {len(warnings)} warning(s)')
    sys.exit(1 if errors else 0)
