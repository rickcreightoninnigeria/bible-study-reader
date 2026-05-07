"""
populate_passages.py
Populates passageText fields in a BeaconLight .estudy JSON by scraping bible.com.

All passageUrlN values are expected to be bible.com URLs. Any URL that is not
from bible.com is silently skipped.

Slots are discovered dynamically per element: a slot N (1–10) is active when
the element contains both passageUrlN and passageTextN keys. If passageTextN
is already non-empty it is skipped, so the script is safe to re-run.

The verse spec (which verses to extract) is read from whichever bibleRefN
field is available on the element. The book name is ignored — only the
chapter:verse portion is used — so non-English book names work fine.

Usage:
    pip install requests beautifulsoup4
    python populate_passages.py input.json output.json
"""

import json
import re
import sys
import time
import copy

import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SLOT_UPPER_BOUND = 10   # scan passageText1 … passageText10
DELAY            = 1.5  # seconds between requests – be polite
BIBLE_COM_HOST   = "bible.com"

# ---------------------------------------------------------------------------
# HTTP session
# ---------------------------------------------------------------------------

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
})

# ---------------------------------------------------------------------------
# Verse-spec parser
# ---------------------------------------------------------------------------

def parse_verse_spec(ref: str) -> tuple[int | None, list[int]]:
    """
    Extract (chapter, [verse, ...]) from any bibleRef string, regardless of
    the language of the book name.

    Examples that all parse correctly:
        'Mark 1:15'           -> (1, [15])
        'Markus 1:15'         -> (1, [15])
        'Romans 3:9-12, 23'   -> (3, [9, 10, 11, 12, 23])
        '1 Yahaya 1:8-9'      -> (1, [8, 9])
        'Kolosiyawa 2:6-7'    -> (2, [6, 7])
        'Amsal 9:10'          -> (9, [10])
        'Yakobus 3:2'         -> (3, [2])

    Only the 'digits:rest' portion is used; the book name is discarded.
    Returns (None, []) on failure.
    """
    m = re.search(r'(\d+):(.+)$', ref)
    if not m:
        return None, []

    chapter    = int(m.group(1))
    verse_part = m.group(2).strip()

    verses = []
    for segment in verse_part.split(','):
        segment = segment.strip()
        segment = re.sub(r'[a-zA-Z]+$', '', segment).strip()   # strip trailing 'b', 'a', etc.
        if '-' in segment:
            parts = segment.split('-')
            try:
                start, end = int(parts[0].strip()), int(parts[1].strip())
                verses.extend(range(start, end + 1))
            except ValueError:
                pass
        else:
            try:
                verses.append(int(segment))
            except ValueError:
                pass

    if not verses:
        return None, []

    return chapter, sorted(set(verses))


# ---------------------------------------------------------------------------
# bible.com scraper
# ---------------------------------------------------------------------------

def is_bible_com_url(url: str) -> bool:
    """Return True if the URL belongs to bible.com."""
    return BIBLE_COM_HOST in url


def scrape_bible_com(page_url: str, ref: str) -> str:
    """
    Fetch a chapter page from bible.com and return HTML for the specific
    verses named in ref.

    bible.com renders verse text in <span data-usfm="BOK.CH.V"> elements.
    We match by chapter and verse number only, so the book code does not
    need to be known in advance.

    Returns an HTML string with inline <sup>N</sup> verse numbers, or ""
    on failure.
    """
    chapter, verse_list = parse_verse_spec(ref)
    if not verse_list:
        print(f"    [WARN] Could not parse verse spec from: {ref!r}")
        return ""

    try:
        resp = SESSION.get(page_url, timeout=20)
        resp.raise_for_status()
    except Exception as e:
        print(f"    [ERROR] GET {page_url}: {e}")
        return ""

    soup = BeautifulSoup(resp.text, "html.parser")

    collected_parts = []

    for verse_num in verse_list:
        # data-usfm format is "BOK.CH.V" — match on the .CH.V suffix only
        pattern = re.compile(rf'\.\s*{chapter}\s*\.\s*{verse_num}\s*$')

        verse_span = None
        for span in soup.find_all("span", attrs={"data-usfm": True}):
            if pattern.search(span["data-usfm"]):
                verse_span = span
                break

        if verse_span is None:
            print(f"    [WARN] Verse {chapter}:{verse_num} not found in {page_url}")
            continue

        # Walk descendants: emit <sup>N</sup> for superscripts, plain text otherwise
        verse_text = ""
        for child in verse_span.descendants:
            if hasattr(child, 'name'):
                if child.name == 'sup':
                    verse_text += f"<sup>{child.get_text()}</sup>"
            else:
                parent_names = [p.name for p in child.parents if hasattr(p, 'name')]
                if 'sup' not in parent_names:
                    t = str(child)
                    if t.strip():
                        verse_text += t

        if verse_text.strip():
            collected_parts.append(verse_text.strip())

    result = " ".join(collected_parts).strip()

    if not result:
        print(f"    [WARN] Span-based extraction empty for {ref!r}, trying fallback")
        result = _bible_com_fallback(soup, chapter, verse_list)

    return result


def _bible_com_fallback(soup: BeautifulSoup, chapter: int, verse_list: list[int]) -> str:
    """
    Fallback: locate verse numbers in <sup> or <span> elements and return
    their surrounding text. Used when the primary span-based extraction
    finds nothing.
    """
    parts = []
    for verse_num in verse_list:
        for sup in soup.find_all(['sup', 'span'], string=str(verse_num)):
            parent = sup.find_parent()
            if parent:
                text = parent.get_text(separator=" ").strip()
                if len(text) > 5:
                    parts.append(f"<sup>{verse_num}</sup>{text}")
                    break
    return " ".join(parts)


# ---------------------------------------------------------------------------
# DEAD CODE – live.bible.is scraper
#
# Retained for reference in case live.bible.is URLs are needed in future.
# All current passageUrlN values point to bible.com; this function is never
# called by the main processing loop.
# ---------------------------------------------------------------------------

def scrape_bible_is(page_url: str, ref: str) -> str:           # noqa: U100
    """
    (Unused) Fetch verses from live.bible.is.

    live.bible.is is JavaScript-rendered; requests/BeautifulSoup cannot
    retrieve its content reliably. A Selenium or Playwright implementation
    would be required to make this functional.
    """
    chapter, verse_list = parse_verse_spec(ref)
    if not verse_list:
        return ""

    try:
        resp = SESSION.get(page_url, timeout=20)
        resp.raise_for_status()
    except Exception as e:
        print(f"    [ERROR] GET {page_url}: {e}")
        return ""

    soup = BeautifulSoup(resp.text, "html.parser")
    collected_parts = []

    # Approach 1: elements with id="V{N}"
    for verse_num in verse_list:
        el = soup.find(id=f"V{verse_num}") or soup.find(id=f"v{verse_num}")
        if el:
            text = el.get_text(separator=" ").strip()
            collected_parts.append(f"<sup>{verse_num}</sup>{text}")

    if collected_parts:
        return " ".join(collected_parts).strip()

    # Approach 2: <sup> verse-number markers
    for verse_num in verse_list:
        sups = soup.find_all("sup", string=re.compile(rf'^\s*{verse_num}\s*$'))
        for sup in sups:
            parent = sup.find_parent()
            if parent:
                text_parts = []
                found_sup  = False
                for child in parent.children:
                    if child == sup:
                        found_sup = True
                        continue
                    if found_sup:
                        if hasattr(child, 'name') and child.name == 'sup':
                            break
                        text_parts.append(
                            child.get_text() if hasattr(child, 'get_text') else str(child)
                        )
                verse_text = "".join(text_parts).strip()
                if verse_text:
                    collected_parts.append(f"<sup>{verse_num}</sup>{verse_text}")
                    break

    if collected_parts:
        return " ".join(collected_parts).strip()

    print(f"    [WARN] All structured approaches failed for {page_url}, returning empty")
    return ""


# ---------------------------------------------------------------------------
# Slot discovery
# ---------------------------------------------------------------------------

def active_slots(obj: dict) -> list[int]:
    """
    Return the list of slot numbers (1–SLOT_UPPER_BOUND) for which the
    element has both a passageUrlN key and a passageTextN key.
    Ordering is ascending by slot number.
    """
    slots = []
    for n in range(1, SLOT_UPPER_BOUND + 1):
        if f"passageUrl{n}" in obj and f"passageText{n}" in obj:
            slots.append(n)
    return slots


# ---------------------------------------------------------------------------
# Verse-ref discovery
# ---------------------------------------------------------------------------

def find_any_ref(obj: dict) -> str:
    """
    Return the first non-empty bibleRefN value found in the element.
    We only need the chapter:verse portion, so any language works.
    """
    for n in range(1, SLOT_UPPER_BOUND + 1):
        val = obj.get(f"bibleRef{n}", "").strip()
        if val:
            return val
    return ""


# ---------------------------------------------------------------------------
# Tree walker
# ---------------------------------------------------------------------------

def find_and_update_passages(obj: dict | list, stats: dict) -> None:
    """Walk the JSON tree in-place, populating empty passageText fields."""
    if isinstance(obj, list):
        for item in obj:
            find_and_update_passages(item, stats)
        return

    if not isinstance(obj, dict):
        return

    if obj.get("type") == "biblePassage":
        element_id = obj.get("elementId", "?")

        ref = find_any_ref(obj)
        if not ref:
            print(f"  [{element_id}] No bibleRef found, skipping element")
            stats["no_url"] += 1
            return

        for slot in active_slots(obj):
            text_key = f"passageText{slot}"
            url_key  = f"passageUrl{slot}"

            # Skip if already populated
            existing = obj.get(text_key, "")
            if existing and existing.strip():
                stats["skipped"] += 1
                continue

            url = obj.get(url_key, "").strip()

            # Skip non-bible.com URLs silently
            if not url or not is_bible_com_url(url):
                if url:
                    print(f"  [{element_id}] slot{slot}: not a bible.com URL, skipping ({url})")
                else:
                    print(f"  [{element_id}] slot{slot}: empty URL, skipping")
                stats["no_url"] += 1
                continue

            print(f"  [{element_id}] slot{slot}: scraping {url}")
            text = scrape_bible_com(url, ref)

            if text:
                obj[text_key] = text
                stats["populated"] += 1
                print(f"    -> {len(text)} chars")
            else:
                stats["failed"] += 1
                print(f"    -> FAILED (empty result)")

            time.sleep(DELAY)

        return  # don't recurse into child keys of a passage element

    for value in obj.values():
        find_and_update_passages(value, stats)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 3:
        print("Usage: python populate_passages.py input.json output.json")
        sys.exit(1)

    input_path  = sys.argv[1]
    output_path = sys.argv[2]

    print(f"Loading {input_path}...")
    with open(input_path, encoding="utf-8") as f:
        data = json.load(f)

    data_copy = copy.deepcopy(data)
    stats     = {"populated": 0, "skipped": 0, "failed": 0, "no_url": 0}

    print("\nProcessing biblePassage elements...\n")
    find_and_update_passages(data_copy, stats)

    print(f"\n--- Done ---")
    print(f"  Populated : {stats['populated']}")
    print(f"  Skipped   : {stats['skipped']} (already had text)")
    print(f"  Failed    : {stats['failed']} (empty result)")
    print(f"  No URL    : {stats['no_url']} (missing, non-bible.com, or no bibleRef)")

    print(f"\nWriting {output_path}...")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data_copy, f, ensure_ascii=False, indent=2)
    print("Done.")


if __name__ == "__main__":
    main()
