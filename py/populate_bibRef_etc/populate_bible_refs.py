"""
populate_bible_refs.py  –  v2.1

Handles two studyMetadata conventions:

  • MULTILINGUAL — numbered fields: bibleTranslation1, bibleTranslation2, ...
    and per-element bibleRef1/translation1/passageUrl1, bibleRef2/..., etc.
    (unchanged from v2.0 — see below.)

  • MONOLINGUAL  — a single unnumbered "bibleTranslation" field in
    studyMetadata (a plain string like "NET", or a dict such as
    {"en": "NET"}), and per-element bibleRef / translation / passageUrl /
    passageText fields with no number suffix. In this mode there is only
    one reference per element, so the script simply fills in passageUrl
    (BibleGateway NET link) when it's empty and the translation is NET;
    for a non-NET monolingual file it will substitute XXX/NNN placeholders
    in an existing passageUrl using the same book/chapter lookups as below,
    but cannot invent a URL pattern from scratch since there's no separate
    English source field to cross-reference.

Which mode is used is auto-detected per file from studyMetadata (presence
of "bibleTranslation1" → multilingual, else "bibleTranslation" → monolingual).

For each biblePassage element in a MULTILINGUAL study JSON file:

  1. Identify the NET translation slot N by scanning studyMetadata for the
     bibleTranslationN field whose value is "NET".  bibleRefN is the English
     source reference used for all translation work below.

  2. For every OTHER slot M where bibleTranslationM is defined:
       • Look up the language for that translation code in
         TRANSLATIONCODE_TO_LANGUAGE (e.g. "HCL" → "Hausa").
       • If a lookup table exists for that language (LANGUAGE_TO_LOOKUP),
         and bibleRefM is currently empty, populate it with the translated
         reference derived from bibleRefN.
       • Slots whose translation code is unknown, or for which no lookup
         table exists, are left unchanged (a warning is printed).

  3. For every passageUrlM field:
       • If M == N (the NET slot):
           – If passageUrlN is already non-empty, leave it alone.
           – If passageUrlN is empty, populate it with:
             https://www.biblegateway.com/passage/?search=BookName+Chapter&version=NET
             e.g. https://www.biblegateway.com/passage/?search=Colossians+1&version=NET
       • For all other M:
           – Replace XXX with the 3-letter book code from bibleRefM.
           – Replace NNN with the chapter number from bibleRefM.
           – If neither placeholder is present the URL is left unchanged.

Usage:
    python populate_bible_refs.py <input_file.json> [<input_file2.json> ...]

Output files are written alongside the input files with the suffix
_updated_refs.json.
"""

import json
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Translation-code → language name
# ---------------------------------------------------------------------------

TRANSLATIONCODE_TO_LANGUAGE = {
    # --- Common West African Paratext Codes ---
    "HAU":   "Hausa",
    "HCL":   "Hausa",     # Common for Hausa Common Language
    "HAU79": "Hausa",
    "SRK":   "Hausa",
    "FUV":   "Fulfulde",  # Adamawa Fulfulde
    "FUF":   "Pular",     # Fouta Djallon Fulfulde
    "FB":    "Fulfulde",
    "FBDC":  "Fulfulde",
    "FUB":   "Fulfulde",
    "FUQ":   "Fulfulde",
    "IBO":   "Igbo",
    "YOR":   "Yoruba",
    "EFI":   "Efik",
    "TIV":   "Tiv",
    "SWA":   "Swahili",
    "FRN":   "French",    # Common code in Francophone Africa projects
    "FRA":   "French",    # ISO standard for French
    # --- Major English/International Translations ---
    "ESV":   "English",
    "KJV":   "English",
    "NIV":   "English",
    "NAS":   "English",
    "RSV":   "English",
    "MSG":   "English",
    "NET":   "English",
    "NIV84": "English",
    "NLT96": "English",
    "GNTUK": "English",
    "SPA":   "Spanish",
    "POR":   "Portuguese",
    # --- Biblical/Source Languages ---
    "HEB":   "Hebrew",
    "HEB2":  "Hebrew",
    "GRC":   "Ancient Greek",
    "ARA":   "Aramaic",
    "LXX":   "Greek",     # Septuagint
    "VUL":   "Latin",     # Vulgate
}

# ---------------------------------------------------------------------------
# Book-name lookup tables (English → target language)
# ---------------------------------------------------------------------------

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

# Language name → lookup table.
# Languages not listed here have no book-name translation available; the
# script will skip those slots with a warning rather than crashing.
LANGUAGE_TO_LOOKUP = {
    "Hausa":    ENGLISH_TO_HAUSA,
    "Fulfulde": ENGLISH_TO_FULFULDE,
    # "English" is intentionally absent — it is the source, not a target.
    # Add further languages here as lookup tables become available.
}

# English book name → 3-letter Paratext/USFM book code
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
    r'^(\d+)'                   # group 1: first (and usually only) chapter number
    r':'                        # colon separator
    r'([\d\s,\-–:a-b]+)'       # group 2: everything that follows (verse string)
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
# Metadata helpers
# ---------------------------------------------------------------------------

def is_multilingual(data: dict) -> bool:
    """
    True if studyMetadata uses the numbered bibleTranslationN convention
    (bibleTranslation1, bibleTranslation2, ...).
    False for the monolingual convention, where studyMetadata instead has a
    single unnumbered "bibleTranslation" field and elements use unnumbered
    field names (bibleRef, translation, passageUrl, passageText).
    """
    metadata = data.get("studyMetadata", {})
    return "bibleTranslation1" in metadata


def get_mono_translation_code(data: dict) -> str:
    """
    Extract the translation code for a monolingual file from
    studyMetadata["bibleTranslation"], which may be either a plain string
    ("NET") or a dict keyed by language code (e.g. {"en": "NET"}).
    Returns "" if it cannot be determined.
    """
    metadata = data.get("studyMetadata", {})
    value = metadata.get("bibleTranslation", "")
    if isinstance(value, dict):
        language = data.get("language")
        if language and language in value:
            return str(value[language]).upper()
        # Fall back to the first (and normally only) value present.
        for v in value.values():
            return str(v).upper()
        return ""
    return str(value).upper()


def find_net_slot(data: dict) -> int:
    """
    Inspect studyMetadata to find which bibleTranslationN slot holds "NET".
    Returns the slot number (1-based integer), e.g. 1 if bibleTranslation1 == "NET".
    Raises ValueError if no slot is "NET" (so the caller can abort gracefully).
    """
    metadata = data.get("studyMetadata", {})
    for n in range(1, 100):
        key = f"bibleTranslation{n}"
        if key not in metadata:
            break
        if metadata[key].upper() == "NET":
            return n
    raise ValueError(
        "No bibleTranslationN field with value 'NET' found in studyMetadata. "
        "Cannot determine the English source reference slot."
    )


def collect_translation_slots(data: dict) -> dict[int, str]:
    """
    Return a dict mapping slot number → translation code for every
    bibleTranslationN key present in studyMetadata.
    e.g. {1: "NET", 2: "HAU79", 3: "HCL", 4: "SRK", 5: "FUV"}
    Stops scanning at the first gap (bibleTranslation1, 2, 3 present but
    not 4 → only 1–3 are returned).
    """
    metadata = data.get("studyMetadata", {})
    slots = {}
    for n in range(1, 100):
        key = f"bibleTranslation{n}"
        if key not in metadata:
            break
        slots[n] = metadata[key]
    return slots


# ---------------------------------------------------------------------------
# Core processing
# ---------------------------------------------------------------------------

def build_net_url(book: str, chapter: str) -> str:
    """
    Build a BibleGateway NET URL for the given English book name and chapter.
    Spaces in the book name are replaced with '+'.
    e.g. build_net_url("1 Corinthians", "12")
         → "https://www.biblegateway.com/passage/?search=1+Corinthians+12&version=NET"
    """
    encoded_book = book.replace(" ", "+")
    return (
        f"https://www.biblegateway.com/passage/"
        f"?search={encoded_book}+{chapter}&version=NET"
    )


def process_element(
    el: dict,
    element_id: str,
    net_slot: int,
    translation_slots: dict[int, str],
) -> dict:
    """
    Update a single biblePassage element in place and return it.

    net_slot            – 1-based index of the NET (English source) slot.
    translation_slots   – {slot_number: translation_code} for every defined
                          bibleTranslationN in studyMetadata.
    """
    english_ref = el.get(f"bibleRef{net_slot}", "")

    # Fallback: if the designated NET slot is empty, scan all slots in order
    # for the first parseable English reference.
    if not english_ref:
        for n in sorted(translation_slots):
            candidate = el.get(f"bibleRef{n}", "")
            if candidate:
                book_test, _, _ = parse_bible_ref(candidate)
                if book_test:
                    english_ref = candidate
                    break

    book, chapter, verses = parse_bible_ref(english_ref)

    # ------------------------------------------------------------------
    # 1. Populate empty bibleRefM for non-NET slots
    # ------------------------------------------------------------------
    for slot, code in translation_slots.items():
        if slot == net_slot:
            continue  # source slot — never overwrite

        ref_field = f"bibleRef{slot}"
        if ref_field not in el or el[ref_field] != "":
            continue  # field absent or already populated — leave it alone

        language = TRANSLATIONCODE_TO_LANGUAGE.get(code.upper())
        if language is None:
            print(f"  WARNING: Unknown translation code '{code}' "
                  f"for slot {slot} (element {element_id}) — skipping bibleRef{slot}")
            continue

        if language == "English":
            # Another English translation — copy the NET reference verbatim.
            if book:
                el[ref_field] = english_ref
            continue

        lookup = LANGUAGE_TO_LOOKUP.get(language)
        if lookup is None:
            print(f"  WARNING: No book-name lookup table available for language "
                  f"'{language}' (code '{code}', slot {slot}, element {element_id}) "
                  f"— skipping bibleRef{slot}")
            continue

        if book:
            el[ref_field] = translate_ref(book, chapter, verses, lookup)

    # ------------------------------------------------------------------
    # 2. Populate / update passageUrlM fields
    # ------------------------------------------------------------------
    for slot in translation_slots:
        url_field = f"passageUrl{slot}"
        url = el.get(url_field, "")

        if slot == net_slot:
            # NET slot: only fill if currently empty.
            if not url and book:
                el[url_field] = build_net_url(book, chapter)
            continue

        # Non-NET slot: replace XXX / NNN placeholders using that slot's
        # bibleRef (now populated above if it was empty).
        if not url:
            continue
        if "XXX" not in url and "NNN" not in url:
            continue

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
                      f"{element_id} — source reference could not be parsed")

        if "NNN" in url:
            if chapter:
                url = url.replace("NNN", chapter)
            else:
                print(f"  WARNING: Cannot replace NNN in {url_field} of element "
                      f"{element_id} — source reference could not be parsed")

        el[url_field] = url

    return el


def process_element_mono(el: dict, element_id: str, default_translation: str) -> dict:
    """
    Update a single biblePassage element in place for a MONOLINGUAL study
    file (unnumbered bibleRef / translation / passageUrl fields) and return
    it.

    default_translation – translation code from studyMetadata, used as a
                          fallback if the element itself has no "translation"
                          field.
    """
    english_ref = el.get("bibleRef", "")
    book, chapter, verses = parse_bible_ref(english_ref)

    code = (el.get("translation") or default_translation or "").upper()
    url_field = "passageUrl"
    url = el.get(url_field, "")

    if code == "NET":
        # Source/English slot: only fill if currently empty.
        if not url and book:
            el[url_field] = build_net_url(book, chapter)
        return el

    # Non-NET monolingual file: there's no separate English source field to
    # cross-reference, so we can only act on an existing URL that already
    # contains XXX / NNN placeholders.
    if not url or ("XXX" not in url and "NNN" not in url):
        return el

    language = TRANSLATIONCODE_TO_LANGUAGE.get(code)
    if language is None:
        print(f"  WARNING: Unknown translation code '{code}' "
              f"(element {element_id}) — skipping {url_field}")
        return el

    if "XXX" in url:
        if book:
            book_code = ENGLISH_TO_3LETTER.get(book)
            if book_code:
                url = url.replace("XXX", book_code)
            else:
                print(f"  WARNING: No 3-letter code for book '{book}' "
                      f"(element {element_id}, field {url_field})")
        else:
            print(f"  WARNING: Cannot replace XXX in {url_field} of element "
                  f"{element_id} — source reference could not be parsed")

    if "NNN" in url:
        if chapter:
            url = url.replace("NNN", chapter)
        else:
            print(f"  WARNING: Cannot replace NNN in {url_field} of element "
                  f"{element_id} — source reference could not be parsed")

    el[url_field] = url
    return el


def process_file(input_path: Path):
    print(f"\nProcessing: {input_path}")

    with input_path.open(encoding="utf-8") as f:
        data = json.load(f)

    passage_count = 0

    if is_multilingual(data):
        try:
            net_slot = find_net_slot(data)
        except ValueError as e:
            print(f"  ERROR: {e}")
            return

        translation_slots = collect_translation_slots(data)
        print(f"  Translation slots found: "
              + ", ".join(f"{n}={code}" for n, code in sorted(translation_slots.items())))
        print(f"  English (NET) source: bibleRef{net_slot} "
              f"(bibleTranslation{net_slot} = 'NET')")

        for chapter in data.get("chapters", []):
            for el in chapter.get("elements", []):
                if el.get("type") == "biblePassage":
                    element_id = el.get("elementId", "unknown")
                    process_element(el, element_id, net_slot, translation_slots)
                    passage_count += 1
    else:
        # Monolingual file: unnumbered bibleRef / translation / passageUrl.
        default_translation = get_mono_translation_code(data)
        print(f"  Monolingual file detected. "
              f"studyMetadata bibleTranslation = '{default_translation}'")

        for chapter in data.get("chapters", []):
            for el in chapter.get("elements", []):
                if el.get("type") == "biblePassage":
                    element_id = el.get("elementId", "unknown")
                    process_element_mono(el, element_id, default_translation)
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
