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


ELEMENT_TYPES = {'heading', 'text', 'biblePassage', 'question', 'image', 'callout', 'likertScale', 'video'}
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
    rd = study.get('reviewData')
    if rd is not None and not isinstance(rd, dict):
        err('reviewData must be an object')
        study['reviewData'] = {}
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
    if typ == 'video':
        check_video(where, el)
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


# Sites a video link is expected to point to; any other site gets a warning
# (not an error), in case it is a typing slip.
VIDEO_HOSTS = ('youtube.com', 'youtu.be', 'bibleproject.com', 'vimeo.com')


def check_video(where, v):
    """A `video` element or a Go Deeper / Leaders' Notes block with subtype
    `video` (video.js). title, url, note, fileName and downloadUrl may be numbered."""
    from urllib.parse import urlparse

    def https_ok(k, val):
        if not isinstance(val, str) or not val.strip():
            return False
        u = urlparse(val.strip())
        if u.scheme != 'https' or not u.netloc:
            err(f'{where}: {k} must be an https:// address (this one is ignored)')
            return False
        return True

    titles = [(k, val) for k, val in numbered(v, 'title')]
    if not any(isinstance(val, str) and val.strip() for _, val in titles):
        warn(f'{where}: video has no title, so the card just says "Video"')
    for k, val in titles:
        if val is not None and not isinstance(val, str):
            err(f'{where}: {k} must be a string')
    urls = numbered(v, 'url')
    downloads = numbered(v, 'downloadUrl')
    files = numbered(v, 'fileName')
    if not urls and not downloads and not files:
        err(f'{where}: video needs a url (or a downloadUrl or fileName), so the card is not shown')
    for k, val in urls:
        if https_ok(k, val):
            host = urlparse(val.strip()).netloc.lower()
            if not any(host == h or host.endswith('.' + h) for h in VIDEO_HOSTS):
                warn(f'{where}: {k} is on {host}, not a usual video site; check it is right')
    for k, val in downloads:
        https_ok(k, val)
    for k, val in files:
        if not isinstance(val, str) or '/' in val or '\\' in val:
            warn(f'{where}: {k} should be a plain file name such as Genesis-1-11.mp4 (no folders)')
    m = v.get('minutes')
    if m is None:
        warn(f'{where}: video has no minutes, so the card cannot show its length or data cost')
    elif isinstance(m, bool) or not isinstance(m, (int, float)) or not 0 < m <= 300:
        err(f'{where}: minutes must be a number between 1 and 300')
    mb = v.get('sizeMB')
    if mb is not None and (isinstance(mb, bool) or not isinstance(mb, (int, float)) or mb <= 0):
        err(f'{where}: sizeMB must be a positive number (megabytes to watch online)')
    for k in ('source',):
        if k in v and not isinstance(v[k], str):
            err(f'{where}: {k} must be a string')


# keyTerms is NOT a regular expression (answer-match.js parseKeyTerms): only "|",
# a trailing "$" and a leading "*" mean anything, and every other punctuation
# mark becomes a space. So "moses.*not able" is the phrase "moses not able".
KT_REGEX_RE = re.compile(r'\.[*+?]|\\[A-Za-z]|[\[\]{}^()]|[*+]|\$(?=.)')


def _within_one_slip(a, b):
    """Damerau-Levenshtein distance <= 1, as answer-match.js _withinOneSlip."""
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    i = 0
    while i < la and i < lb and a[i] == b[i]:
        i += 1
    if i == la and i == lb:
        return True
    if la == lb:
        return a[i + 1:] == b[i + 1:] or (i + 1 < la and a[i] == b[i + 1] and a[i + 1] == b[i] and a[i + 2:] == b[i + 2:])
    return a[i + 1:] == b[i:] if la > lb else a[i:] == b[i + 1:]


def _could_be_slip_of(word, key_word):
    """Could the spelling tolerance take `word` for `key_word` (a key-term word of 5+ letters)?"""
    if len(key_word) < 5 or word[:1] != key_word[:1] or word == key_word:
        return False
    return any(n <= len(word) and _within_one_slip(key_word, word[:n]) for n in (len(key_word) - 1, len(key_word), len(key_word) + 1))


def check_not_typos(where, nt, kt):
    key_words = set()
    for term in kt:
        if isinstance(term, str):
            for alt in term.split('|'):
                core = alt.strip().lstrip('*').rstrip('$')
                key_words.update(re.findall(r'[a-z]+', core.lower()))
    for w in nt:
        word = re.sub(r"['\u2019\u02bc]", '', w.strip().lower())
        if ' ' in word:
            warn(f'{where}: notTypos entry {w!r} has a space; list single words')
            continue
        if key_words and not any(_could_be_slip_of(word, k) for k in key_words):
            warn(f'{where}: notTypos entry {w!r} is not one slip from any word of this question\'s keyTerms, so it changes nothing')


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


# --------------------------------------------------------------------------- Review (reviewData)
REVIEW_MIN_WRONG, REVIEW_GOOD_WRONG, REVIEW_MAX_QUESTIONS = 4, 6, 200
REVIEW_AUTO_MIN_CHAPTERS = 4


def _rv_norm(s):
    return re.sub(r'\s+', ' ', str(s).strip().lower())


def _rv_words(s):
    return set(re.findall(r'\w+', _rv_norm(s)))


def check_review(study, multilingual):
    """Shape and quality of reviewData (see REVIEW-QUIZ-SPEC.md). The app never throws on a bad block, it
    just leaves questions out, so every omission is reported here. It cannot tell when a wrong answer is
    accidentally true: a person must read every one."""
    rd = study.get('reviewData')
    meta = study.get('studyMetadata') or {}
    chapters = [c for c in (study.get('chapters') or []) if isinstance(c, dict)]
    nums = {c.get('chapterNumber') for c in chapters}
    nlang = 0
    while meta.get(f'language{nlang + 1}'):
        nlang += 1
    slots = [str(i) for i in range(1, nlang + 1)] if multilingual and nlang else ['']

    auto = rd.get('auto') if isinstance(rd, dict) else None
    if isinstance(rd, dict):
        if auto is not None and not isinstance(auto, dict):
            err('reviewData.auto must be an object such as {"aboutChapter": true, "whichChapter": true}')
            auto = None
        elif isinstance(auto, dict):
            for k, v in auto.items():
                if k not in ('aboutChapter', 'whichChapter'):
                    warn(f'reviewData.auto.{k} is not a known automatic question type (aboutChapter, whichChapter)')
                elif not isinstance(v, bool):
                    err(f'reviewData.auto.{k} must be true or false')
        qs = rd.get('questions')
        if qs is None:
            qs = []
        elif not isinstance(qs, list):
            err('reviewData.questions must be an array')
            qs = []
        if len(qs) > REVIEW_MAX_QUESTIONS:
            warn(f'reviewData has {len(qs)} questions; more than {REVIEW_MAX_QUESTIONS} is a very long pool')
        if not qs and not (isinstance(auto, dict) and any(auto.get(k) is True for k in ('aboutChapter', 'whichChapter'))):
            warn('reviewData has no questions and no automatic question types, so the Review item is never shown')
        ids, corrects = set(), {}
        for i, q in enumerate(qs):
            if not isinstance(q, dict):
                err(f'reviewData.questions[{i}] is not an object')
                continue
            qid = q.get('id')
            where = f'review question {qid if qid else i + 1}'
            if not isinstance(qid, str) or not qid.strip():
                err(f'reviewData.questions[{i}]: id is required (a unique string)')
            elif qid in ids:
                err(f'{where}: duplicate id')
            else:
                ids.add(qid)
            ch = q.get('chapter')
            if ch is not None and ch not in nums:
                err(f'{where}: chapter {ch!r} is not a chapter of this study')
            for slot in slots:
                w = where + (f' (language {slot})' if slot else '')
                question, correct, wrong = q.get('question' + slot), q.get('correct' + slot), q.get('wrong' + slot)
                if not isinstance(question, str) or not question.strip():
                    (warn if slot and slot != '1' else err)(f'{w}: question{slot} is missing' + (' (the app falls back to language 1)' if slot and slot != '1' else ' (the question is left out)'))
                    if not slot or slot == '1':
                        continue
                if not isinstance(correct, str) or not correct.strip():
                    (warn if slot and slot != '1' else err)(f'{w}: correct{slot} is missing' + (' (the app falls back to language 1)' if slot and slot != '1' else ' (the question is left out)'))
                    continue
                if not (isinstance(wrong, list) and all(isinstance(x, str) and x.strip() for x in wrong)):
                    (warn if slot and slot != '1' else err)(f'{w}: wrong{slot} must be an array of non-empty strings')
                    continue
                keyc = _rv_norm(correct)
                if slot in ('', '1'):
                    corrects.setdefault(keyc, qid)
                distinct = []
                for x in wrong:
                    kx = _rv_norm(x)
                    if kx == keyc:
                        err(f'{w}: the right answer {x!r} is also listed as a wrong answer')
                    elif kx in distinct:
                        warn(f'{w}: wrong answer {x!r} is listed twice')
                    else:
                        distinct.append(kx)
                if len(distinct) < REVIEW_MIN_WRONG:
                    err(f'{w}: only {len(distinct)} distinct wrong answers; at least {REVIEW_MIN_WRONG} are needed')
                elif len(distinct) < REVIEW_GOOD_WRONG:
                    warn(f'{w}: {len(distinct)} wrong answers; {REVIEW_GOOD_WRONG} or more gives more variety')
                # near-duplicate wrong answers (or one that is almost the right answer)
                allw = [(keyc, 'the right answer')] + [(k, repr(k)) for k in distinct]
                for a in range(len(allw)):
                    for b in range(a + 1, len(allw)):
                        wa, wb = _rv_words(allw[a][0]), _rv_words(allw[b][0])
                        if len(wa | wb) >= 3 and len(wa & wb) / len(wa | wb) >= 0.8:
                            warn(f'{w}: {allw[a][1]} and {allw[b][1]} are almost the same words; one may be accidentally right too')
                # the giveaway: the right answer much longer, or much shorter, than every wrong one
                lens = [len(x.strip()) for x in wrong if _rv_norm(x) != keyc]
                lc = len(correct.strip())
                if lens and lc >= 25 and lc > 1.6 * max(lens):
                    warn(f'{w}: the right answer is much longer than every wrong answer, which gives it away')
                elif lens and min(lens) >= 25 and min(lens) > 1.6 * lc:
                    warn(f'{w}: the right answer is much shorter than every wrong answer, which gives it away')
                ex = q.get('explain' + slot)
                if isinstance(ex, str) and len(ex) > 400:
                    warn(f'{w}: explain is over 400 characters; keep it to a sentence or two')
        # a wrong answer that is another question's right answer may also be true here
        for q in qs:
            if not isinstance(q, dict):
                continue
            for slot in ([slots[0]] if slots else ['']):
                wrong = q.get('wrong' + slot)
                if isinstance(wrong, list):
                    for x in wrong:
                        if isinstance(x, str) and corrects.get(_rv_norm(x)) not in (None, q.get('id')):
                            warn(f'review question {q.get("id")}: wrong answer {x!r} is the right answer to question {corrects[_rv_norm(x)]}; check it is not also true here')

    # chapter fields used by the automatic question types
    want_about = isinstance(auto, dict) and auto.get('aboutChapter') is True
    want_which = isinstance(auto, dict) and auto.get('whichChapter') is True
    n_sum = n_verse = 0
    for c in chapters:
        n = c.get('chapterNumber')
        for slot in slots:
            s = c.get('reviewSummary' + slot)
            if s is not None and not isinstance(s, str):
                err(f'chapter {n}: reviewSummary{slot} must be a string')
            vs = c.get('reviewVerses' + slot)
            if vs is not None:
                if not (isinstance(vs, list) and all(isinstance(x, str) and x.strip() for x in vs)):
                    err(f'chapter {n}: reviewVerses{slot} must be an array of non-empty strings')
                else:
                    if len(vs) > 3:
                        warn(f'chapter {n}: reviewVerses{slot} has {len(vs)} verses; only the first 3 are used')
                    for x in vs:
                        if len(x) > 400:
                            warn(f'chapter {n}: a reviewVerses{slot} entry is over 400 characters; pick one or two distinctive lines')
        first = slots[0] if slots else ''
        if isinstance(c.get('reviewSummary' + first), str) and c.get('reviewSummary' + first).strip():
            n_sum += 1
        if isinstance(c.get('reviewVerses' + first), list) and c.get('reviewVerses' + first):
            n_verse += 1
        nw = c.get('reviewNotWith')
        if nw is not None:
            if not (isinstance(nw, list) and all(isinstance(x, int) and not isinstance(x, bool) for x in nw)):
                err(f'chapter {n}: reviewNotWith must be an array of chapter numbers')
            else:
                for x in nw:
                    if x not in nums:
                        err(f'chapter {n}: reviewNotWith lists chapter {x}, which does not exist')
    if (want_about or want_which) and len(chapters) < REVIEW_AUTO_MIN_CHAPTERS:
        warn(f'reviewData.auto is on but the study has only {len(chapters)} chapters; the automatic questions need at least {REVIEW_AUTO_MIN_CHAPTERS}')
    if want_about and n_sum < REVIEW_AUTO_MIN_CHAPTERS:
        warn(f'reviewData.auto.aboutChapter is on but only {n_sum} chapters have a reviewSummary (at least {REVIEW_AUTO_MIN_CHAPTERS} are needed)')
    if want_which and n_verse == 0:
        warn('reviewData.auto.whichChapter is on but no chapter has reviewVerses')
    if (n_sum or n_verse) and not (want_about or want_which) and isinstance(rd, dict):
        warn('chapters carry reviewSummary or reviewVerses but reviewData.auto does not switch the automatic questions on')


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
  ' countWords, AM_LIMITS, STOPWORDS_BY_LANG, REAL_WORDS_BY_LANG };';
const ctx = { console }; vm.createContext(ctx); vm.runInContext(src, ctx);
const A = ctx.__api;
const jobs = JSON.parse(fs.readFileSync(0, 'utf8'));
function detail(j) {
  if (j.mode === 'realwords') { const l = String(j.lang || 'en').toLowerCase().split(/[-_]/)[0] || 'en'; return { words: Array.from(A.REAL_WORDS_BY_LANG[l] || []) }; }
  const lang = String(j.lang || 'en').toLowerCase().split(/[-_]/)[0] || 'en';
  const limit = A.STOPWORDS_BY_LANG[lang] ? A.AM_LIMITS.RATIO_WITH_STOPWORDS : A.AM_LIMITS.RATIO_NO_STOPWORDS;
  const toks = A.tokenise(A.normaliseText(j.answer), lang).filter(t => A._isContent(t, lang, 2));
  const pw = new Set();
  for (const p of (j.passageTexts || [])) for (const t of A.tokenise(A.normaliseText(p), lang)) if (A._isContent(t, lang, 2)) pw.add(t);
  const fresh = toks.filter(t => !pw.has(t));
  const raw = Array.isArray(j.keyTerms) ? j.keyTerms.filter(x => typeof x === 'string' && x !== '') : [];
  const terms = A.parseKeyTerms(j.keyTerms);
  const missed = [];
  terms.forEach((t, i) => { if (A.matchKeyTerms(j.answer, [t], lang, { notTypos: j.notTypos }).matched === 0) missed.push(raw[i]); });
  let minWords = 6;
  const th = j.shortAnswerThreshold;
  const ov = (typeof th === 'number' || (typeof th === 'string' && th !== '')) ? parseInt(th, 10) : NaN;
  if (Number.isFinite(ov)) minWords = ov;
  else if (j.sampleAnswer) minWords = Math.min(6, Math.round(A.countWords(j.sampleAnswer, lang) * 0.35));
  return { overlap: toks.length ? 1 - fresh.length / toks.length : 0, limit, hasPassage: pw.size > 0,
           fresh: Array.from(new Set(fresh)).slice(0, 12), missed, total: terms.length,
           words: A.countWords(j.answer, lang), minWords };
}
process.stdout.write(JSON.stringify(jobs.map(j => j.mode === 'realwords' ? detail(j) : ({ r: A.evaluateAnswer(j), x: detail(j) }))));
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
                    'keyTerms': kt, 'notTypos': el.get('notTypos' + slot, el.get('notTypos')), 'lang': lang,
                    'shortAnswerThreshold': el.get('shortAnswerThreshold' + slot, el.get('shortAnswerThreshold')),
                    'skipBibleVerseCheck': bool(el.get('skipBibleVerseCheck'))}
            where = f'chapter {ch.get("chapterNumber")}, {el.get("elementId")}'
            for field, text in (('sampleAnswer', sample), ('mainPoint', main)):
                if isinstance(text, str) and text.strip():
                    jobs.append(dict(base, answer=_plain(text)))
                    labels.append((where, field))
    if not jobs:
        return
    nt_items = [(w, j['notTypos'], j['lang']) for (w, f), j in zip(labels, jobs)
                if f == 'sampleAnswer' and isinstance(j.get('notTypos'), list) and j['notTypos']]
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
    if nt_items:
        try:
            lists = {}
            for lg in {x[2] for x in nt_items}:
                o = subprocess.run(['node', '-e', AM_RUNNER, path], input=json.dumps([{'mode': 'realwords', 'lang': lg}]),
                                   capture_output=True, text=True, timeout=30)
                lists[lg] = set(json.loads(o.stdout)[0]['words'])
            for where, nt, lg in nt_items:
                for w in nt:
                    if isinstance(w, str) and w.strip().lower() in lists.get(lg, set()):
                        warn(f'{where}: notTypos entry {w!r} is already on the {lg} list in answer-match.js; remove it')
        except Exception:  # noqa: BLE001
            pass
    why = {'partial': 'matches too few of its keyTerms, so a reader who copies it is told "partial"',
           'offTopic': 'matches none of its keyTerms',
           'repeatsPassage': 'is flagged as repeating the passage (nearly all of its content words appear in it, or most do and it copies runs of the passage); '
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
    check_review(study, multilingual)
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
            nt = el.get('notTypos')
            if nt is not None:
                if not (isinstance(nt, list) and all(isinstance(x, str) and x.strip() for x in nt)):
                    err(f'{where}: notTypos must be an array of non-empty strings (real words that must never be forgiven as a spelling slip)')
                else:
                    if len(nt) > 30:
                        warn(f'{where}: notTypos has {len(nt)} entries; only 30 are used')
                    check_not_typos(where, nt, kt if isinstance(kt, list) else [])
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

    for name, label in (('goDeeperData', 'Go Deeper'), ('leadersNotesData', "Leaders' Notes")):
        for ch in (study.get(name) or {}).get('chapters', []):
            for key, block in ch.items():
                if isinstance(block, dict) and block.get('subtype') == 'video':
                    check_video(f'{label} chapter {ch.get("chapterNumber")}, {key}', block)

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
