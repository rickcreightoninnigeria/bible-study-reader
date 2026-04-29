"""
populate_passage_texts.py

For each biblePassage element in a study JSON file, populate any empty
passageTextN fields by extracting the relevant passage from a Paratext
SFM file, using the translation code in studyMetadata.bibleTranslationN.

The NET translation slot is also populated if its passageText is empty,
regardless of which index (1, 2, 3, ...) it occupies.

The book name and chapter/verse range are always derived from the bibleRefN
whose corresponding bibleTranslation is "NET" — that field is always in English.
For non-English slots the chapter/verse are read from the same reference parsed
from the NET slot (book/chapter/verses are the same across all translations).

SFM files are expected at:
    /home/rick/SFM/<CODE>/<NN><BOOK>BT<CODE>.SFM
The ENGLISH_TO_SFM dict below encodes the exact paths with "XXX" as placeholder
for the translation code.

Usage:
    python populate_passage_texts.py <input.json> [<input2.json> ...]

Output is written as <stem>_updated_passages.json alongside each input file.
"""

import json
import re
import sys
import io
import contextlib
import os
from pathlib import Path

# ---------------------------------------------------------------------------
# Hardcoded SFM path templates  (XXX = translation code placeholder)
# ---------------------------------------------------------------------------

ENGLISH_TO_SFM = {
    "Genesis":          "/home/rick/SFM/XXX/01GENBTXXX.SFM",
    "Exodus":           "/home/rick/SFM/XXX/02EXOBTXXX.SFM",
    "Leviticus":        "/home/rick/SFM/XXX/03LEVBTXXX.SFM",
    "Numbers":          "/home/rick/SFM/XXX/04NUMBTXXX.SFM",
    "Deuteronomy":      "/home/rick/SFM/XXX/05DEUBTXXX.SFM",
    "Joshua":           "/home/rick/SFM/XXX/06JOSBTXXX.SFM",
    "Judges":           "/home/rick/SFM/XXX/07JDGBTXXX.SFM",
    "Ruth":             "/home/rick/SFM/XXX/08RUTBTXXX.SFM",
    "1 Samuel":         "/home/rick/SFM/XXX/091SABTXXX.SFM",
    "2 Samuel":         "/home/rick/SFM/XXX/102SABTXXX.SFM",
    "1 Kings":          "/home/rick/SFM/XXX/111KIBTXXX.SFM",
    "2 Kings":          "/home/rick/SFM/XXX/122KIBTXXX.SFM",
    "1 Chronicles":     "/home/rick/SFM/XXX/131CHBTXXX.SFM",
    "2 Chronicles":     "/home/rick/SFM/XXX/142CHBTXXX.SFM",
    "Ezra":             "/home/rick/SFM/XXX/15EZRBTXXX.SFM",
    "Nehemiah":         "/home/rick/SFM/XXX/16NEHBTXXX.SFM",
    "Esther":           "/home/rick/SFM/XXX/17ESTBTXXX.SFM",
    "Job":              "/home/rick/SFM/XXX/18JOBBTXXX.SFM",
    "Psalm":            "/home/rick/SFM/XXX/19PSABTXXX.SFM",
    "Psalms":           "/home/rick/SFM/XXX/19PSABTXXX.SFM",
    "Proverbs":         "/home/rick/SFM/XXX/20PROBTXXX.SFM",
    "Ecclesiastes":     "/home/rick/SFM/XXX/21ECCBTXXX.SFM",
    "Song of Solomon":  "/home/rick/SFM/XXX/22SNGBTXXX.SFM",
    "Isaiah":           "/home/rick/SFM/XXX/23ISABTXXX.SFM",
    "Jeremiah":         "/home/rick/SFM/XXX/24JERBTXXX.SFM",
    "Lamentations":     "/home/rick/SFM/XXX/25LAMBTXXX.SFM",
    "Ezekiel":          "/home/rick/SFM/XXX/26EZKBTXXX.SFM",
    "Daniel":           "/home/rick/SFM/XXX/27DANBTXXX.SFM",
    "Hosea":            "/home/rick/SFM/XXX/28HOSBTXXX.SFM",
    "Joel":             "/home/rick/SFM/XXX/29JOLBTXXX.SFM",
    "Amos":             "/home/rick/SFM/XXX/30AMOBTXXX.SFM",
    "Obadiah":          "/home/rick/SFM/XXX/31OBABTXXX.SFM",
    "Jonah":            "/home/rick/SFM/XXX/32JONBTXXX.SFM",
    "Micah":            "/home/rick/SFM/XXX/33MICBTXXX.SFM",
    "Nahum":            "/home/rick/SFM/XXX/34NAHBTXXX.SFM",
    "Habakkuk":         "/home/rick/SFM/XXX/35HABBTXXX.SFM",
    "Zephaniah":        "/home/rick/SFM/XXX/36ZEPBTXXX.SFM",
    "Haggai":           "/home/rick/SFM/XXX/37HAGBTXXX.SFM",
    "Zechariah":        "/home/rick/SFM/XXX/38ZECBTXXX.SFM",
    "Malachi":          "/home/rick/SFM/XXX/39MALBTXXX.SFM",
    "Matthew":          "/home/rick/SFM/XXX/41MATBTXXX.SFM",
    "Mark":             "/home/rick/SFM/XXX/42MRKBTXXX.SFM",
    "Luke":             "/home/rick/SFM/XXX/43LUKBTXXX.SFM",
    "John":             "/home/rick/SFM/XXX/44JHNBTXXX.SFM",
    "Acts":             "/home/rick/SFM/XXX/45ACTBTXXX.SFM",
    "Romans":           "/home/rick/SFM/XXX/46ROMBTXXX.SFM",
    "1 Corinthians":    "/home/rick/SFM/XXX/471COBTXXX.SFM",
    "2 Corinthians":    "/home/rick/SFM/XXX/482COBTXXX.SFM",
    "Galatians":        "/home/rick/SFM/XXX/49GALBTXXX.SFM",
    "Ephesians":        "/home/rick/SFM/XXX/50EPHBTXXX.SFM",
    "Philippians":      "/home/rick/SFM/XXX/51PHPBTXXX.SFM",
    "Colossians":       "/home/rick/SFM/XXX/52COLBTXXX.SFM",
    "1 Thessalonians":  "/home/rick/SFM/XXX/531THBTXXX.SFM",
    "2 Thessalonians":  "/home/rick/SFM/XXX/542THBTXXX.SFM",
    "1 Timothy":        "/home/rick/SFM/XXX/551TIBTXXX.SFM",
    "2 Timothy":        "/home/rick/SFM/XXX/562TIBTXXX.SFM",
    "Titus":            "/home/rick/SFM/XXX/57TITBTXXX.SFM",
    "Philemon":         "/home/rick/SFM/XXX/58PHMBTXXX.SFM",
    "Hebrews":          "/home/rick/SFM/XXX/59HEBBTXXX.SFM",
    "James":            "/home/rick/SFM/XXX/60JASBTXXX.SFM",
    "1 Peter":          "/home/rick/SFM/XXX/611PEBTXXX.SFM",
    "2 Peter":          "/home/rick/SFM/XXX/622PEBTXXX.SFM",
    "1 John":           "/home/rick/SFM/XXX/631JNBTXXX.SFM",
    "2 John":           "/home/rick/SFM/XXX/642JNBTXXX.SFM",
    "3 John":           "/home/rick/SFM/XXX/653JNBTXXX.SFM",
    "Jude":             "/home/rick/SFM/XXX/66JUDBTXXX.SFM",
    "Revelation":       "/home/rick/SFM/XXX/67REVBTXXX.SFM",
}

# ---------------------------------------------------------------------------
# Reference parsing  (English refs only, used for NET bibleRef slot)
# ---------------------------------------------------------------------------

_BOOK_NAMES_LONGEST_FIRST = sorted(ENGLISH_TO_SFM.keys(), key=len, reverse=True)


def _strip_letter_suffix(s: str) -> int:
    """
    Convert a verse token that may carry a letter suffix to an int.
    e.g. "21b" → 21, "20a" → 20, "7" → 7.
    Raises ValueError if the numeric part cannot be parsed.
    """
    return int(re.sub(r'[a-zA-Z]+$', '', s.strip()))


def parse_english_ref(ref: str):
    """
    Parse an English Bible reference such as "Colossians 1:3",
    "Psalm 90:2, 4", "John 11:25, 43-44", "Romans 7:21–23",
    "Romans 1:21b", "Titus 3:3a", "Luke 15:19-20a",
    or "James 3:16, 4:1-2" (multi-chapter).

    Handles:
      - En-dashes (–) as range separators (treated identically to hyphens).
      - Letter suffixes (a/b) on verse numbers, stripped before int conversion.
      - Multi-chapter references: only the first chapter and its verses are
        used; any segments belonging to a subsequent chapter are ignored.

    Returns (book_name, chapter_int, verse_groups) where verse_groups is a
    list of (start_verse, end_verse) integer tuples representing contiguous
    ranges.  Single verses are (v, v).  Non-contiguous groups are separate
    entries.

    Returns (None, None, None) on failure.
    """
    ref = ref.strip()
    if not ref:
        return None, None, None

    for book in _BOOK_NAMES_LONGEST_FIRST:
        if ref.startswith(book):
            remainder = ref[len(book):].strip()

            # Accept digits, letters a/b, commas, spaces, hyphens, en-dashes,
            # and colons (colons appear in multi-chapter refs like "3:16, 4:1-2").
            m = re.match(r'^(\d+):([\d\s,\-–:a-zA-Z]+)$', remainder,
                         re.UNICODE)
            if not m:
                print(f"  WARNING: Cannot parse chapter/verse from '{ref}' "
                      f"(remainder: '{remainder}')")
                return None, None, None

            chapter = int(m.group(1))

            # Normalise en-dashes to hyphens for uniform splitting.
            verse_str = m.group(2).replace('–', '-')

            # Split on commas to get segments; each segment may be:
            #   "21b"          single verse with suffix
            #   "7-8"          hyphen range
            #   "19-20a"       range with suffix on end
            #   "4:1-2"        new-chapter segment — stop processing here
            verse_groups = []
            for segment in verse_str.split(','):
                segment = segment.strip()

                # Multi-chapter segment (contains a colon) — we've already
                # captured the first chapter's verses, so stop.
                if ':' in segment:
                    print(f"  WARNING: '{ref}' spans multiple chapters — "
                          f"only chapter {chapter} verses included; "
                          f"'{segment.strip()}' and any further segments skipped.")
                    break

                # Normalise en-dash (already done above) then split on hyphen.
                if '-' in segment:
                    parts = segment.split('-', 1)
                    try:
                        v_start = _strip_letter_suffix(parts[0])
                        v_end   = _strip_letter_suffix(parts[1])
                    except ValueError:
                        print(f"  WARNING: Cannot parse verse range '{segment}' "
                              f"in '{ref}'")
                        return None, None, None
                else:
                    try:
                        v_start = v_end = _strip_letter_suffix(segment)
                    except ValueError:
                        print(f"  WARNING: Cannot parse verse '{segment}' "
                              f"in '{ref}'")
                        return None, None, None

                # If contiguous with the previous group, merge.
                if verse_groups and v_start == verse_groups[-1][1] + 1:
                    verse_groups[-1] = (verse_groups[-1][0], v_end)
                else:
                    verse_groups.append((v_start, v_end))

            if not verse_groups:
                print(f"  WARNING: No verse groups parsed from '{ref}'")
                return None, None, None

            return book, chapter, verse_groups

    print(f"  WARNING: Unrecognised book name in reference '{ref}'")
    return None, None, None


# ---------------------------------------------------------------------------
# SFM file loading & caching
# ---------------------------------------------------------------------------

# Cache: (sfm_path_str) → USJ dict  (or None if file missing / parse failed)
_sfm_cache: dict = {}


def load_sfm(sfm_path: str):
    """Return the parsed USJ dict for an SFM file, with caching.

    usfm_grammar prints token-level diagnostics directly to stdout (and
    sometimes stderr) even when ignore_errors=True.  We suppress both
    file descriptors at the OS level so nothing leaks through.
    """
    if sfm_path in _sfm_cache:
        return _sfm_cache[sfm_path]

    p = Path(sfm_path)
    if not p.exists():
        p = Path(sfm_path)
        print(f"  DEBUG: Looking for: {sfm_path}  exists={p.exists()}")
        print(f"  WARNING: SFM file not found: {sfm_path}")
        _sfm_cache[sfm_path] = None
        return None

    try:
        from usfm_grammar import USFMParser
        text = p.read_text(encoding="utf-8", errors="replace")

        # Suppress stdout AND stderr at the file-descriptor level so that
        # usfm_grammar's C-level / tree-sitter diagnostics are silenced.
        devnull_fd = os.open(os.devnull, os.O_WRONLY)
        old_stdout_fd = os.dup(1)
        old_stderr_fd = os.dup(2)
        try:
            os.dup2(devnull_fd, 1)
            os.dup2(devnull_fd, 2)
            with contextlib.redirect_stdout(io.StringIO()), \
                 contextlib.redirect_stderr(io.StringIO()):
                parser = USFMParser(text)
                usj = parser.to_usj(ignore_errors=True)
        finally:
            os.dup2(old_stdout_fd, 1)
            os.dup2(old_stderr_fd, 2)
            os.close(devnull_fd)
            os.close(old_stdout_fd)
            os.close(old_stderr_fd)

        _sfm_cache[sfm_path] = usj
        return usj
    except Exception as exc:
        print(f"  WARNING: Failed to parse SFM file {sfm_path}: {exc}")
        _sfm_cache[sfm_path] = None
        return None


# ---------------------------------------------------------------------------
# USJ traversal — build a flat verse-text map for one chapter
# ---------------------------------------------------------------------------

def _extract_text_from_node(node) -> str:
    """
    Recursively extract plain text from a USJ node or string,
    ignoring structural/milestone markers and collecting only text content
    from char nodes and bare strings.
    """
    if isinstance(node, str):
        return node
    if isinstance(node, dict):
        node_type = node.get("type", "")
        # Skip verse milestone markers (they carry no text themselves)
        if node_type == "verse":
            return ""
        # For char nodes and paras: recurse into content
        content = node.get("content", [])
        return "".join(_extract_text_from_node(c) for c in content)
    return ""


def _parse_verse_number(raw: str):
    """
    Parse a verse marker number which may be a single verse ("3") or a
    bridged range ("7-8").  Returns a list of all integer verse numbers
    covered, e.g. [3] or [7, 8].
    """
    raw = raw.strip()
    if '-' in raw:
        parts = raw.split('-', 1)
        try:
            v_start = int(parts[0].strip())
            v_end   = int(parts[1].strip())
            return list(range(v_start, v_end + 1))
        except ValueError:
            pass
    try:
        return [int(raw)]
    except ValueError:
        return []


def build_verse_map(usj: dict, target_chapter: int) -> dict:
    """
    Walk the USJ content and return a dict {verse_number: text_string}
    for all verses in target_chapter.  Text is stripped of surrounding
    whitespace.  Only verse-level text is collected (no section headings etc.).

    Bridged verses (e.g. \\v 7-8) are stored under every verse number they
    cover, so a request for verse 7 or verse 8 will both find the text.
    """
    verse_map = {}
    in_target_chapter = False

    for block in usj.get("content", []):
        if not isinstance(block, dict):
            continue

        block_type = block.get("type", "")

        # Track which chapter we are in
        if block_type == "chapter":
            chapter_num = int(block.get("number", 0))
            in_target_chapter = (chapter_num == target_chapter)
            continue

        if not in_target_chapter:
            continue

        # Para-level blocks that may contain verses
        if block_type == "para":
            para_content = block.get("content", [])
            current_verses = []   # list of ints (may be >1 for bridges)
            verse_parts = []

            for item in para_content:
                if isinstance(item, dict) and item.get("type") == "verse":
                    # Save text accumulated for the previous verse(s)
                    if current_verses:
                        text = re.sub(r'\s+', ' ',
                                      " ".join(verse_parts)).strip()
                        for v in current_verses:
                            existing = verse_map.get(v, "")
                            verse_map[v] = (existing + " " + text).strip() \
                                           if existing else text
                    current_verses = _parse_verse_number(item.get("number", ""))
                    if not current_verses:
                        print(f"  WARNING: Could not parse verse marker "
                              f"number '{item.get('number', '')}' — skipping")
                    verse_parts = []
                else:
                    verse_parts.append(_extract_text_from_node(item))

            # Save the last verse(s) in this para
            if current_verses:
                text = re.sub(r'\s+', ' ', " ".join(verse_parts)).strip()
                for v in current_verses:
                    existing = verse_map.get(v, "")
                    verse_map[v] = (existing + " " + text).strip() \
                                   if existing else text

    return verse_map


# ---------------------------------------------------------------------------
# Build the HTML passage string from a verse map + verse groups
# ---------------------------------------------------------------------------

def build_passage_html(verse_map: dict, verse_groups: list,
                        ref: str) -> str:
    """
    Build an HTML string like:
        <sup>3</sup>Verse text here. <sup>4</sup>Next verse.

    For non-contiguous groups, insert " ... " between them.
    Returns empty string if any requested verse is missing.
    """
    group_htmls = []

    for (v_start, v_end) in verse_groups:
        parts = []
        for v in range(v_start, v_end + 1):
            text = verse_map.get(v)
            if text is None:
                print(f"  WARNING: Verse {v} not found in SFM for '{ref}'")
                return ""
            parts.append(f"<sup>{v}</sup>{text}")
        group_htmls.append(" ".join(parts))

    return " ... ".join(group_htmls)


# ---------------------------------------------------------------------------
# Core: get passage HTML for one (translation_code, book, chapter, groups)
# ---------------------------------------------------------------------------

def get_passage_html(translation_code: str, book: str,
                     chapter: int, verse_groups: list,
                     ref_for_logging: str) -> str:
    """
    Look up the SFM file, parse it, and return the HTML passage string.
    Returns empty string on any failure.
    """
    sfm_template = ENGLISH_TO_SFM.get(book)
    if sfm_template is None:
        print(f"  WARNING: No SFM template for book '{book}'")
        return ""

    sfm_path = sfm_template.replace("XXX", translation_code)
    usj = load_sfm(sfm_path)
    if usj is None:
        return ""

    verse_map = build_verse_map(usj, chapter)
    return build_passage_html(verse_map, verse_groups, ref_for_logging)


# ---------------------------------------------------------------------------
# Process a single biblePassage element
# ---------------------------------------------------------------------------

def process_element(el: dict, translations: dict) -> None:
    """
    translations: {index: translation_code}  e.g. {1: 'HAU79', 2: 'HCL', ...}

    Find the NET slot (the index whose translation code is 'NET').
    Parse book/chapter/verses from that bibleRef (it's always English).
    Then for every slot N that has an empty passageTextN, fetch from SFM.

    NET is treated no differently from any other slot: if passageTextN is
    absent or empty and bibleRefN is present, we attempt to populate it.
    """
    # Find the NET index
    net_index = None
    for idx, code in translations.items():
        if code.upper() == "NET":
            net_index = idx
            break

    if net_index is None:
        print(f"  WARNING: No NET translation found in studyMetadata "
              f"for element {el.get('elementId', '?')} — skipping")
        return

    # Get the English reference from the NET bibleRef slot
    net_ref_key = f"bibleRef{net_index}"
    net_ref = el.get(net_ref_key, "").strip()
    if not net_ref:
        print(f"  WARNING: {net_ref_key} is empty for element "
              f"{el.get('elementId', '?')} — skipping")
        return

    book, chapter, verse_groups = parse_english_ref(net_ref)
    if book is None:
        return  # warning already printed

    # Iterate over every translation slot, including NET itself.
    # A slot is processed if its passageText is absent or empty.
    for idx, translation_code in translations.items():
        text_key = f"passageText{idx}"
        ref_key  = f"bibleRef{idx}"

        # Skip if passageText already populated
        existing_text = el.get(text_key, "")
        if isinstance(existing_text, str) and existing_text.strip():
            continue

        # For NET, we already have the parsed ref; for other slots we
        # still need a non-empty bibleRef to confirm the slot is active.
        if idx == net_index:
            # NET slot: always use the already-parsed ref
            slot_ref = net_ref
        else:
            slot_ref = el.get(ref_key, "").strip()
            if not slot_ref:
                continue  # no reference, slot not active for this element

        # Skip if no translation code
        if not translation_code:
            continue

        html = get_passage_html(
            translation_code, book, chapter, verse_groups,
            ref_for_logging=slot_ref
        )
        if html:
            el[text_key] = html


# ---------------------------------------------------------------------------
# Process one JSON file
# ---------------------------------------------------------------------------

def process_file(input_path: Path) -> None:
    print(f"\nProcessing: {input_path}")

    with input_path.open(encoding="utf-8") as f:
        data = json.load(f)

    meta = data.get("studyMetadata", {})

    # Build translations dict: discover all bibleTranslationN keys dynamically
    translations = {}
    for key, value in meta.items():
        m = re.match(r'^bibleTranslation(\d+)$', key)
        if m and value:
            translations[int(m.group(1))] = value

    if not translations:
        print("  ERROR: No bibleTranslation fields found in studyMetadata.")
        return

    print(f"  Translations: { {i: translations[i] for i in sorted(translations)} }")

    passage_count = 0
    for chapter in data.get("chapters", []):
        for el in chapter.get("elements", []):
            if el.get("type") == "biblePassage":
                process_element(el, translations)
                passage_count += 1

    output_path = input_path.with_name(
        input_path.stem + "_updated_passages" + input_path.suffix
    )
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"  Done — {passage_count} biblePassage elements processed.")
    print(f"  Output: {output_path}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print("Usage: python populate_passage_texts.py <file.json> [...]")
        sys.exit(1)

    for arg in sys.argv[1:]:
        p = Path(arg)
        if not p.exists():
            print(f"ERROR: File not found: {p}")
            continue
        if p.suffix.lower() != ".json":
            print(f"ERROR: Not a JSON file: {p}")
            continue
        process_file(p)


if __name__ == "__main__":
    main()
