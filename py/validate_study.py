#!/usr/bin/env python3
"""Check a Bible Study Reader study against STUDY-FORMAT.md section 13.

Usage:  python3 validate_study.py study.json      (or a .estudy zip)

The app does no validation of its own, so these are the mistakes that fail
silently. Errors mean something will not work; warnings mean a field is
ignored or a habit is risky. Exit status is 1 if there are any errors.
Standard library only.
"""
import json, os, re, sys, unicodedata, zipfile

ID_RE = re.compile(r'^[A-Za-z0-9_.-]+$')
GD_RESERVED = {'chapterNumber', 'backToStudy', 'format', 'title', 'footnotes',
               'previousLabel', 'nextLabel'}
IGNORED_IN_ELEMENTS = ['answerType', 'required', 'commentHint']
IGNORED_IN_METADATA = ['tags', 'createdAt', 'updatedAt', 'shareMessage', 'publishedBy',
                       'year', 'ctaLabel']
errors, warnings = [], []
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
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'js', 'icons.js')
    try:
        src = open(p, encoding='utf-8').read()
        a = src.index('const ICONS_ROUNDED = {')
        return set(re.findall(r'^\s{2}([A-Za-z0-9]+):\s*`', src[a:src.index('\n};', a)], re.M))
    except (OSError, ValueError):
        return None


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
            mp = el.get('mainPoint')
            if isinstance(mp, str) and len(mp) > 2000:
                warn(f'{where}: mainPoint is over 2,000 characters')
            if el.get('type') in ('question', 'callout') and 'elementId' not in el:
                err(f'{where}: missing elementId')
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
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
    for m in errors:
        print('ERROR  ', m)
    for m in warnings:
        print('warning', m)
    print(f'\n{len(errors)} error(s), {len(warnings)} warning(s)')
    sys.exit(1 if errors else 0)
