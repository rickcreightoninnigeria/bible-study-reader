"""
populate_passage_sfm.py  —  v1.0

Finds the bibleTranslationN slot whose value is "NET" in studyMetadata,
then for every biblePassage element whose passageText1 (or whichever
passageTextN corresponds to the NET slot) is empty, extracts the passage
text from the matching Paratext SFM file and writes it as HTML.

Only the NET slot is populated. Other translation slots (HAU79, HCL, etc.)
are not touched by this script.

Output HTML format (matching pre-populated passages in the JSON):

    <p><sup>3</sup>Verse text. <sup>4</sup>Next verse.</p>
    <br>
    <p style='text-align: right; font-size: 0.8em;'>
      <a href='https://www.biblegateway.com/…'>(NET — see context ↗)</a>
    </p>

For non-contiguous verse groups (e.g. Acts 18:1–3, 18–19, 24–26) a
paragraph break with " … " is inserted between groups.

SFM files are expected at:
    /home/rick/SFM/<CODE>/<NN><BOOK>BT<CODE>.SFM
where <CODE> is the translation code (e.g. NET) and the path template
per book is defined in ENGLISH_TO_SFM below.

Usage:
    python populate_passage_sfm.py <input.json> [<input2.json> ...]

Output is written as <stem>_updated_passages.json alongside each input.
"""

import contextlib
import io
import json
import os
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# SFM path templates  (XXX = translation-code placeholder)
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

_BOOK_NAMES_LONGEST_FIRST = sorted(ENGLISH_TO_SFM.keys(), key=len, reverse=True)

# ---------------------------------------------------------------------------
# Reference parsing
# ---------------------------------------------------------------------------

def _strip_letter_suffix(s: str) -> int:
    """Convert a verse token that may carry a letter suffix to an int.
    e.g. "21b" → 21, "20a" → 20, "7" → 7."""
    return int(re.sub(r'[a-zA-Z]+$', '', s.strip()))


def parse_english_ref(ref: str):
    """
    Parse an English Bible reference into (book_name, chapter_int, verse_groups).

    verse_groups is a list of (start_verse, end_verse) integer tuples.
    Single verses are (v, v).  Contiguous segments are merged.
    Non-contiguous segments become separate tuples — the caller inserts
    " … " between them in the output HTML.

    Handles:
      - En-dashes (–) as range separators
      - Letter suffixes (a/b) stripped before int conversion
      - Multi-chapter refs (e.g. "James 3:16, 4:1-2"): only chapter N
        verses are included; segments from later chapters are dropped with
        a warning.

    Returns (None, None, None) on failure.
    """
    ref = ref.strip()
    if not ref:
        return None, None, None

    for book in _BOOK_NAMES_LONGEST_FIRST:
        if ref.startswith(book):
            remainder = ref[len(book):].strip()
            m = re.match(
                r'^(\d+):([\d\s,\-–:a-zA-Z]+)$', remainder, re.UNICODE
            )
            if not m:
                print(f"  WARNING: Cannot parse chapter/verse from '{ref}' "
                      f"(remainder: '{remainder}')")
                return None, None, None

            chapter = int(m.group(1))
            verse_str = m.group(2).replace('–', '-')

            verse_groups = []
            for segment in verse_str.split(','):
                segment = segment.strip()

                # Multi-chapter segment — stop here
                if ':' in segment:
                    print(f"  WARNING: '{ref}' spans multiple chapters — "
                          f"only chapter {chapter} verses included; "
                          f"'{segment}' and further segments skipped.")
                    break

                if '-' in segment:
                    parts = segment.split('-', 1)
                    try:
                        v_start = _strip_letter_suffix(parts[0])
                        v_end   = _strip_letter_suffix(parts[1])
                    except ValueError:
                        print(f"  WARNING: Cannot parse verse range "
                              f"'{segment}' in '{ref}'")
                        return None, None, None
                else:
                    try:
                        v_start = v_end = _strip_letter_suffix(segment)
                    except ValueError:
                        print(f"  WARNING: Cannot parse verse "
                              f"'{segment}' in '{ref}'")
                        return None, None, None

                # Merge if contiguous with the previous group
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
# SFM loading (with caching)
# ---------------------------------------------------------------------------

_sfm_cache: dict = {}


def load_sfm(sfm_path: str):
    """Return the parsed USJ dict for an SFM file, with caching.
    usfm_grammar emits noise to stdout/stderr even with ignore_errors=True;
    both file descriptors are suppressed at the OS level."""
    if sfm_path in _sfm_cache:
        return _sfm_cache[sfm_path]

    p = Path(sfm_path)
    if not p.exists():
        print(f"  WARNING: SFM file not found: {sfm_path}")
        _sfm_cache[sfm_path] = None
        return None

    try:
        from usfm_grammar import USFMParser

        text = p.read_text(encoding="utf-8", errors="replace")

        devnull_fd    = os.open(os.devnull, os.O_WRONLY)
        old_stdout_fd = os.dup(1)
        old_stderr_fd = os.dup(2)
        try:
            os.dup2(devnull_fd, 1)
            os.dup2(devnull_fd, 2)
            with contextlib.redirect_stdout(io.StringIO()), \
                 contextlib.redirect_stderr(io.StringIO()):
                parser = USFMParser(text)
                usj    = parser.to_usj(ignore_errors=True)
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
# USJ traversal — build flat {verse_int: text} map for one chapter
# ---------------------------------------------------------------------------

def _extract_text(node) -> str:
    """Recursively extract plain text from a USJ node, ignoring verse
    milestone markers (which carry no text themselves)."""
    if isinstance(node, str):
        return node
    if isinstance(node, dict):
        if node.get("type") == "verse":
            return ""
        return "".join(_extract_text(c) for c in node.get("content", []))
    return ""


def _parse_verse_number(raw: str) -> list:
    """Parse a verse marker value that may be a bridge (e.g. "7-8").
    Returns a list of all integer verse numbers covered."""
    raw = raw.strip()
    if '-' in raw:
        parts = raw.split('-', 1)
        try:
            return list(range(int(parts[0].strip()), int(parts[1].strip()) + 1))
        except ValueError:
            pass
    try:
        return [int(raw)]
    except ValueError:
        return []


def build_verse_map(usj: dict, target_chapter: int) -> dict:
    """Walk USJ content and return {verse_int: text} for target_chapter.
    Bridged verses (e.g. \\v 7-8) are stored under every verse number they
    cover.  Section headings and other non-verse content are ignored."""
    verse_map: dict = {}
    in_target = False

    for block in usj.get("content", []):
        if not isinstance(block, dict):
            continue

        block_type = block.get("type", "")

        if block_type == "chapter":
            in_target = (int(block.get("number", 0)) == target_chapter)
            continue

        if not in_target or block_type != "para":
            continue

        current_verses: list = []
        verse_parts:    list = []

        for item in block.get("content", []):
            if isinstance(item, dict) and item.get("type") == "verse":
                # Flush text accumulated for the previous verse(s)
                if current_verses:
                    text = re.sub(r'\s+', ' ', " ".join(verse_parts)).strip()
                    for v in current_verses:
                        existing = verse_map.get(v, "")
                        verse_map[v] = (existing + " " + text).strip() \
                                       if existing else text

                current_verses = _parse_verse_number(item.get("number", ""))
                if not current_verses:
                    print(f"  WARNING: Could not parse verse marker "
                          f"'{item.get('number', '')}' — skipping")
                verse_parts = []
            else:
                verse_parts.append(_extract_text(item))

        # Flush last verse(s) in this para
        if current_verses:
            text = re.sub(r'\s+', ' ', " ".join(verse_parts)).strip()
            for v in current_verses:
                existing = verse_map.get(v, "")
                verse_map[v] = (existing + " " + text).strip() \
                               if existing else text

    return verse_map


# ---------------------------------------------------------------------------
# Build the final HTML string
# ---------------------------------------------------------------------------

def build_passage_html(verse_map: dict, verse_groups: list,
                       passage_url: str, ref: str) -> str:
    """
    Build the full HTML for a passage, matching the format used in
    pre-populated elements:

        <p><sup>3</sup>Verse text. <sup>4</sup>Next verse.</p>
        <br>
        <p style='text-align: right; font-size: 0.8em;'>
          <a href='URL'>(NET — see context ↗)</a>
        </p>

    Non-contiguous verse groups are each wrapped in their own <p> with
    a " … " paragraph between them.

    Returns empty string if any requested verse is missing from verse_map.
    """
    group_paras = []

    for (v_start, v_end) in verse_groups:
        parts = []
        for v in range(v_start, v_end + 1):
            text = verse_map.get(v)
            if text is None:
                print(f"  WARNING: Verse {v} not found in SFM for '{ref}'")
                return ""
            parts.append(f"<sup>{v}</sup>{text}")
        group_paras.append("<p>" + " ".join(parts) + "</p>")

    # Join non-contiguous groups with a " … " paragraph between them
    body = "<p> … </p>".join(group_paras)

    attribution = (
        f"<br><p style='text-align: right; font-size: 0.8em;'>"
        f"<a href='{passage_url}'>(NET — see context ↗)</a></p>"
    )

    return body + "\n" + attribution


# ---------------------------------------------------------------------------
# Core: fetch passage HTML for one element slot
# ---------------------------------------------------------------------------

def get_passage_html(translation_code: str, book: str, chapter: int,
                     verse_groups: list, passage_url: str,
                     ref: str) -> str:
    """Load the SFM file for (translation_code, book), build the verse map
    for chapter, and return the final HTML string.
    Returns empty string on any failure."""
    template = ENGLISH_TO_SFM.get(book)
    if template is None:
        print(f"  WARNING: No SFM path template for book '{book}'")
        return ""

    sfm_path = template.replace("XXX", translation_code)
    usj = load_sfm(sfm_path)
    if usj is None:
        return ""

    verse_map = build_verse_map(usj, chapter)
    return build_passage_html(verse_map, verse_groups, passage_url, ref)


# ---------------------------------------------------------------------------
# Process a single biblePassage element
# ---------------------------------------------------------------------------

def process_element(el: dict, net_index: int, translation_code: str) -> None:
    """
    Populate passageText{net_index} for this element if it is currently empty.

    net_index        — the N in bibleTranslationN that equals "NET"
    translation_code — the actual code string (always "NET" here, but passed
                       explicitly so the SFM path is built correctly)
    """
    element_id  = el.get("elementId", "?")
    text_key    = f"passageText{net_index}"
    ref_key     = f"bibleRef{net_index}"
    url_key     = f"passageUrl{net_index}"

    # Skip if already populated
    existing = el.get(text_key, "")
    if isinstance(existing, str) and existing.strip():
        return

    ref = el.get(ref_key, "").strip()
    if not ref:
        print(f"  WARNING: {ref_key} is empty for element {element_id} — skipping")
        return

    passage_url = el.get(url_key, "").strip()
    if not passage_url:
        print(f"  WARNING: {url_key} is empty for element {element_id} — "
              f"attribution link will be blank")

    book, chapter, verse_groups = parse_english_ref(ref)
    if book is None:
        return  # warning already printed

    html = get_passage_html(
        translation_code, book, chapter, verse_groups, passage_url, ref
    )
    if html:
        el[text_key] = html
        print(f"    Populated {text_key} for {element_id} ({ref})")


# ---------------------------------------------------------------------------
# Process one JSON file
# ---------------------------------------------------------------------------

def process_file(input_path: Path) -> None:
    print(f"\nProcessing: {input_path}")

    with input_path.open(encoding="utf-8") as f:
        data = json.load(f)

    meta = data.get("studyMetadata", {})

    # Find the NET slot dynamically
    net_index = None
    net_code  = None
    for key, value in meta.items():
        m = re.match(r'^bibleTranslation(\d+)$', key)
        if m and isinstance(value, str) and value.upper() == "NET":
            net_index = int(m.group(1))
            net_code  = value
            break

    if net_index is None:
        print("  ERROR: No bibleTranslationN field with value 'NET' found "
              "in studyMetadata — nothing to do.")
        return

    print(f"  NET slot: bibleTranslation{net_index} = '{net_code}'")

    populated = 0
    skipped   = 0

    for chapter in data.get("chapters", []):
        for el in chapter.get("elements", []):
            if el.get("type") != "biblePassage":
                continue
            text_key = f"passageText{net_index}"
            existing = el.get(text_key, "")
            if isinstance(existing, str) and existing.strip():
                skipped += 1
                continue
            process_element(el, net_index, net_code)
            populated += 1

    output_path = input_path.with_name(
        input_path.stem + "_updated_passages" + input_path.suffix
    )
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"  Done — {populated} element(s) attempted, "
          f"{skipped} already populated.")
    print(f"  Output: {output_path}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print("Usage: python populate_passage_sfm.py <file.json> [...]")
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
