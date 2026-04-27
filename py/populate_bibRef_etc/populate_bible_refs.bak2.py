"""
populate_bible_refs.py

For each biblePassage element in a study JSON file:
  1. Populate empty bibleRef1/2/3 with the Hausa equivalent of bibleRef5.
  2. Populate empty bibleRef4 with the Fulfulde equivalent of bibleRef5.
  3. Replace XXX in passageUrl1/2/3/4 with the 3-letter book code from bibleRef1/2/3/4.
  4. Replace NNN in passageUrl1/2/3/4 with the chapter number from bibleRef1/2/3/4.

Usage:
    python populate_bible_refs.py <input_file.json> [<input_file2.json> ...]

Output files are written alongside the input files with the suffix _updated_refs.json.
"""

import json
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Hardcoded lookup tables
# ---------------------------------------------------------------------------

# English book name → Hausa book name
# "Psalm" (singular) and "Psalms" (plural) are both handled explicitly.
ENGLISH_TO_HAUSA = {
    "Genesis": "Farawa",
    "Exodus": "Fitowa",
    "Leviticus": "Littafin Firistoci",
    "Numbers": "Littafin Ƙidaya",
    "Deuteronomy": "Maimaitawar Shari'a",
    "Joshua": "Joshuwa",
    "Judges": "Littafin Mahukunta",
    "Ruth": "Rut",
    "1 Samuel": "1 Sama'ila",
    "2 Samuel": "2 Sama'ila",
    "1 Kings": "1 Sarakuna",
    "2 Kings": "2 Sarakuna",
    "1 Chronicles": "1 Tarihi",
    "2 Chronicles": "2 Tarihi",
    "Ezra": "Ezra",
    "Nehemiah": "Nehemiya",
    "Esther": "Esta",
    "Job": "Ayuba",
    "Psalm": "Zabura",        # singular
    "Psalms": "Zaburoyi",     # plural
    "Proverbs": "Karin Magana",
    "Ecclesiastes": "Mai Hadishi",
    "Song of Solomon": "Waƙar Waƙoƙi",
    "Isaiah": "Ishaya",
    "Jeremiah": "Irmiya",
    "Lamentations": "Makoki",
    "Ezekiel": "Ezekiyel",
    "Daniel": "Daniyel",
    "Hosea": "Yusha'u",
    "Joel": "Yowel",
    "Amos": "Amos",
    "Obadiah": "Obadiya",
    "Jonah": "Yunusa",
    "Micah": "Mika",
    "Nahum": "Nahum",
    "Habakkuk": "Habakuk",
    "Zephaniah": "Zafaniya",
    "Haggai": "Haggai",
    "Zechariah": "Zakariya",
    "Malachi": "Malakai",
    "Matthew": "Matiyu",
    "Mark": "Markus",
    "Luke": "Luka",
    "John": "Yahaya",
    "Acts": "Ayyukan Manzanni",
    "Romans": "Romawa",
    "1 Corinthians": "1 Korantiyawa",
    "2 Corinthians": "2 Korantiyawa",
    "Galatians": "Galatiyawa",
    "Ephesians": "Afisawa",
    "Philippians": "Filibiyawa",
    "Colossians": "Kolosiyawa",
    "1 Thessalonians": "1 Tasalonikawa",
    "2 Thessalonians": "2 Tasalonikawa",
    "1 Timothy": "1 Timoti",
    "2 Timothy": "2 Timoti",
    "Titus": "Titus",
    "Philemon": "Filimon",
    "Hebrews": "Ibraniyawa",
    "James": "Yakubu",
    "1 Peter": "1 Bitrus",
    "2 Peter": "2 Bitrus",
    "1 John": "1 Yahaya",
    "2 John": "2 Yahaya",
    "3 John": "3 Yahaya",
    "Jude": "Yahuza",
    "Revelation": "Wahayin Yohanna",
}

# English book name → Fulfulde book name
ENGLISH_TO_FULFULDE = {
    "Genesis": "Fuɗɗoode",
    "Exodus": "Perol",
    "Leviticus": "Littafi Lima'en",
    "Numbers": "Limngal",
    "Deuteronomy": "Mbaatuki Sariya",
    "Joshua": "Yosuwa",
    "Judges": "Ñaawootooɓe",
    "Ruth": "Ruutu",
    "1 Samuel": "1 Samu'ila",
    "2 Samuel": "2 Samu'ila",
    "1 Kings": "1 Laamiiɓe",
    "2 Kings": "2 Laamiiɓe",
    "1 Chronicles": "1 Habaruuji Zamanu",
    "2 Chronicles": "2 Habaruuji Zamanu",
    "Ezra": "Esdras",
    "Nehemiah": "Nehemiya",
    "Esther": "Esta",
    "Job": "Ayuba",
    "Psalm": "Jabura",        # singular
    "Psalms": "Jaburaaji",    # plural
    "Proverbs": "Balnduuji",
    "Ecclesiastes": "Waajotooɗo",
    "Song of Solomon": "Gimol Gimolji",
    "Isaiah": "Ishaya",
    "Jeremiah": "Irmiya",
    "Lamentations": "Jimol Tuutotooɓe",
    "Ezekiel": "Esekiyiel",
    "Daniel": "Daniyel",
    "Hosea": "Hoseya",
    "Joel": "Yowila",
    "Amos": "Amosa",
    "Obadiah": "Obadiya",
    "Jonah": "Yunusa",
    "Micah": "Mika",
    "Nahum": "Nahuma",
    "Habakkuk": "Habakuku",
    "Zephaniah": "Sofoniya",
    "Haggai": "Haggaya",
    "Zechariah": "Zakariya",
    "Malachi": "Malakiya",
    "Matthew": "Matta",
    "Mark": "Markus",
    "Luke": "Luka",
    "John": "Yaya",
    "Acts": "Kuuɗe Nulɓe",
    "Romans": "Romanko'en",
    "1 Corinthians": "1 Korintinko'en",
    "2 Corinthians": "2 Korintinko'en",
    "Galatians": "Galatiyanko'en",
    "Ephesians": "Afesiyanko'en",
    "Philippians": "Filippiyanko'en",
    "Colossians": "Kolosiyanko'en",
    "1 Thessalonians": "1 Tesalonikanko'en",
    "2 Thessalonians": "2 Tesalonikanko'en",
    "1 Timothy": "1 Timote",
    "2 Timothy": "2 Timote",
    "Titus": "Titus",
    "Philemon": "Filimon",
    "Hebrews": "Iburani'en",
    "James": "Yakuba",
    "1 Peter": "1 Bitrus",
    "2 Peter": "2 Bitrus",
    "1 John": "1 Yaya",
    "2 John": "2 Yaya",
    "3 John": "3 Yaya",
    "Jude": "Yuuda",
    "Revelation": "Banginal",
}

# English book name → 3-letter code
ENGLISH_TO_3LETTER = {
    "Genesis": "GEN",
    "Exodus": "EXO",
    "Leviticus": "LEV",
    "Numbers": "NUM",
    "Deuteronomy": "DEU",
    "Joshua": "JOS",
    "Judges": "JDG",
    "Ruth": "RUT",
    "1 Samuel": "1SA",
    "2 Samuel": "2SA",
    "1 Kings": "1KI",
    "2 Kings": "2KI",
    "1 Chronicles": "1CH",
    "2 Chronicles": "2CH",
    "Ezra": "EZR",
    "Nehemiah": "NEH",
    "Esther": "EST",
    "Job": "JOB",
    "Psalm": "PSA",
    "Psalms": "PSA",
    "Proverbs": "PRO",
    "Ecclesiastes": "ECC",
    "Song of Solomon": "SNG",
    "Isaiah": "ISA",
    "Jeremiah": "JER",
    "Lamentations": "LAM",
    "Ezekiel": "EZK",
    "Daniel": "DAN",
    "Hosea": "HOS",
    "Joel": "JOL",
    "Amos": "AMO",
    "Obadiah": "OBA",
    "Jonah": "JON",
    "Micah": "MIC",
    "Nahum": "NAH",
    "Habakkuk": "HAB",
    "Zephaniah": "ZEP",
    "Haggai": "HAG",
    "Zechariah": "ZEC",
    "Malachi": "MAL",
    "Matthew": "MAT",
    "Mark": "MRK",
    "Luke": "LUK",
    "John": "JHN",
    "Acts": "ACT",
    "Romans": "ROM",
    "1 Corinthians": "1CO",
    "2 Corinthians": "2CO",
    "Galatians": "GAL",
    "Ephesians": "EPH",
    "Philippians": "PHP",
    "Colossians": "COL",
    "1 Thessalonians": "1TH",
    "2 Thessalonians": "2TH",
    "1 Timothy": "1TI",
    "2 Timothy": "2TI",
    "Titus": "TIT",
    "Philemon": "PHM",
    "Hebrews": "HEB",
    "James": "JAS",
    "1 Peter": "1PE",
    "2 Peter": "2PE",
    "1 John": "1JN",
    "2 John": "2JN",
    "3 John": "3JN",
    "Jude": "JUD",
    "Revelation": "REV",
}

# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

# Ordered from longest to shortest so that "Song of Solomon" is tried before
# "Solomon", and numbered books like "1 John" are tried before "John".
_BOOK_NAMES_LONGEST_FIRST = sorted(ENGLISH_TO_HAUSA.keys(), key=len, reverse=True)

# Matches the verse portion after the first "chapter:" — permissive enough to
# handle all known reference styles:
#
#   Simple:          "1:3"
#   List:            "12:7, 11"
#   Hyphen range:    "7:21-23"
#   En-dash range:   "2:6–7"          (U+2013)
#   Letter suffix:   "1:21b", "3:3a"
#   Suffix + range:  "15:19-20a", "15:20b", "15:28a"
#   Multi-chapter:   "3:16, 4:1-2"    → first chapter used for NNN
#
# Strategy: capture the first chapter number, then accept anything that looks
# like verse notation (digits, letters a/b, commas, spaces, hyphens,
# en-dashes, colons) as the raw verse string.  The raw verse string is kept
# verbatim for translated bibleRef fields; only the first chapter number is
# used for URL substitution.
_CHAPTER_VERSE_RE = re.compile(
    r'^(\d+)'          # group 1: first (and usually only) chapter number
    r':'               # colon separator
    r'([\d\s,\-–:a-b]+)'  # group 2: everything that follows (verse string)
    r'$',
    re.UNICODE,
)


def parse_bible_ref(ref: str):
    """
    Parse an English Bible reference such as "Colossians 1:3",
    "1 Corinthians 12:7, 11", "Romans 7:21–23", "Luke 15:19-20a",
    or "James 3:16, 4:1-2" into (book_name, chapter_str, verse_str).

    chapter_str is always the *first* chapter number found (relevant for
    multi-chapter references like "3:16, 4:1-2" → chapter "3").

    verse_str is the raw text after "chapter:" and is preserved verbatim
    for use in translated bibleRef fields.

    Returns (None, None, None) and prints a warning if the reference
    cannot be parsed.
    """
    ref = ref.strip()
    if not ref:
        return None, None, None

    for book in _BOOK_NAMES_LONGEST_FIRST:
        if ref.startswith(book):
            remainder = ref[len(book):].strip()   # e.g. "1:3" or "7:21–23"
            m = _CHAPTER_VERSE_RE.match(remainder)
            if m:
                chapter = m.group(1)
                verses  = m.group(2).strip()
                return book, chapter, verses
            else:
                print(f"  WARNING: Could not parse chapter/verse from '{ref}' "
                      f"(remainder after book name: '{remainder}')")
                return None, None, None

    print(f"  WARNING: Unrecognised book name in reference '{ref}'")
    return None, None, None


def translate_ref(book: str, chapter: str, verses: str, lookup: dict) -> str:
    """
    Build a translated reference string, e.g. "Kolosiyawa 1:3".
    Returns an empty string if the book is not found in the lookup.
    """
    translated_book = lookup.get(book)
    if translated_book is None:
        print(f"  WARNING: No translation found for book '{book}'")
        return ""
    return f"{translated_book} {chapter}:{verses}"


# ---------------------------------------------------------------------------
# Core processing
# ---------------------------------------------------------------------------

def process_element(el: dict, element_id: str) -> dict:
    """
    Update a single biblePassage element in place and return it.
    """
    bibleRef5 = el.get("bibleRef5", "")

    book, chapter, verses = parse_bible_ref(bibleRef5)

    # --- bibleRef1 / 2 / 3  →  Hausa ---
    for field in ("bibleRef1", "bibleRef2", "bibleRef3"):
        if field in el and el[field] == "":
            if book:
                el[field] = translate_ref(book, chapter, verses, ENGLISH_TO_HAUSA)
            # (leave empty if parse failed; warning already printed)

    # --- bibleRef4  →  Fulfulde ---
    if "bibleRef4" in el and el.get("bibleRef4") == "":
        if book:
            el["bibleRef4"] = translate_ref(book, chapter, verses, ENGLISH_TO_FULFULDE)

    # --- passageUrl1/2/3/4  →  replace XXX and NNN ---
    # Map each URL field to its corresponding bibleRef field so we can look up
    # the correct book/chapter for that specific language.
    url_to_ref = {
        "passageUrl1": "bibleRef1",
        "passageUrl2": "bibleRef2",
        "passageUrl3": "bibleRef3",
        "passageUrl4": "bibleRef4",
    }

    for url_field, ref_field in url_to_ref.items():
        url = el.get(url_field, "")
        if not url:
            continue
        if "XXX" not in url and "NNN" not in url:
            continue

        # Determine which book/chapter to use for this URL.
        # The translated bibleRef fields already exist (just set above),
        # but for the 3-letter code we still need the English book name —
        # which we get by re-parsing bibleRef5 (already done above).
        #
        # Note: all four URLs derive their book/chapter from the *same*
        # underlying English reference (bibleRef5); they just link to
        # different Bible versions.  The bibleRef fields differ only in
        # language, not in book/chapter.
        #
        # For multi-chapter references (e.g. "James 3:16, 4:1-2"), chapter
        # holds the *first* chapter number, which is used for NNN.

        if "XXX" in url:
            if book:
                code = ENGLISH_TO_3LETTER.get(book)
                if code:
                    url = url.replace("XXX", code)
                else:
                    print(f"  WARNING: No 3-letter code for book '{book}' "
                          f"(element {element_id}, field {url_field})")
            else:
                print(f"  WARNING: Cannot replace XXX in {url_field} of element "
                      f"{element_id} — bibleRef5 could not be parsed")

        if "NNN" in url:
            if chapter:
                url = url.replace("NNN", chapter)
            else:
                print(f"  WARNING: Cannot replace NNN in {url_field} of element "
                      f"{element_id} — bibleRef5 could not be parsed")

        el[url_field] = url

    return el


def process_file(input_path: Path):
    print(f"\nProcessing: {input_path}")

    with input_path.open(encoding="utf-8") as f:
        data = json.load(f)

    passage_count = 0
    for chapter in data.get("chapters", []):
        for el in chapter.get("elements", []):
            if el.get("type") == "biblePassage":
                element_id = el.get("elementId", "unknown")
                process_element(el, element_id)
                passage_count += 1

    output_path = input_path.with_name(
        input_path.stem + "_updated_refs" + input_path.suffix
    )

    with output_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"  Done — {passage_count} biblePassage elements processed.")
    print(f"  Output written to: {output_path}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print("Usage: python populate_bible_refs.py <file1.json> [<file2.json> ...]")
        sys.exit(1)

    for arg in sys.argv[1:]:
        path = Path(arg)
        if not path.exists():
            print(f"ERROR: File not found: {path}")
            continue
        if path.suffix.lower() != ".json":
            print(f"ERROR: Not a JSON file: {path}")
            continue
        process_file(path)


if __name__ == "__main__":
    main()
