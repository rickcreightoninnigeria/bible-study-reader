"""
populate_passages.py
Populates passageText1, passageText2, and passageText4 in a BeaconLight .estudy JSON
by scraping www.bible.com (slots 1 & 4) and live.bible.is (slot 2).

Usage:
    pip install requests beautifulsoup4
    python populate_passages.py input.json output.json

The script is safe to re-run: it skips any slot that already has text,
so you can run it in batches or retry after failures.
"""

import json
import re
import sys
import time
import copy

import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Helpers
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

DELAY = 1.5  # seconds between requests – be polite


def parse_verse_spec(ref_english: str) -> tuple[int | None, int | None, list[int]]:
    """
    Parse an English bibleRef like 'Romans 3:9-12, 23' into
    (chapter, start_verse, all_verse_numbers).

    Returns (chapter, start_verse, [v1, v2, ...]) where all_verse_numbers
    is the complete flat list of verses to collect.
    Returns (None, None, []) on failure.
    """
    # Strip book name – everything after the last space-digit boundary
    m = re.search(r'(\d+):(.+)$', ref_english)
    if not m:
        return None, None, []

    chapter = int(m.group(1))
    verse_part = m.group(2).strip()

    verses = []
    # Split on comma, then handle ranges
    for segment in verse_part.split(','):
        segment = segment.strip()
        # Strip trailing letters like 'b' in '7:25b' or '1:2b'
        segment = re.sub(r'[a-zA-Z]$', '', segment).strip()
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
        return None, None, []

    return chapter, verses[0], sorted(set(verses))


# ---------------------------------------------------------------------------
# bible.com scraper (slots 1 and 4)
# ---------------------------------------------------------------------------

def scrape_bible_com(page_url: str, bibleref_english: str) -> str:
    """
    Fetch a chapter page from bible.com and return the HTML for the
    specific verses named in bibleref_english.

    bible.com renders verse text in <span> elements with data-usfm attributes
    like 'ROM.3.9'. We collect the relevant verse spans and return them
    joined as a single HTML string, preserving <sup> verse numbers.
    """
    chapter, start_verse, verse_list = parse_verse_spec(bibleref_english)
    if not verse_list:
        print(f"    [WARN] Could not parse verse spec from: {bibleref_english!r}")
        return ""

    try:
        resp = SESSION.get(page_url, timeout=20)
        resp.raise_for_status()
    except Exception as e:
        print(f"    [ERROR] GET {page_url}: {e}")
        return ""

    soup = BeautifulSoup(resp.text, "html.parser")

    # bible.com wraps each verse in a <span data-usfm="BOK.CH.V">
    # The verse text itself is in child spans with class "content" or similar.
    # We collect all matching verse spans in order.

    collected_parts = []

    for verse_num in verse_list:
        # Try to find the verse span – usfm attribute format: "BOK.CH.V"
        # The book code is embedded in the URL (e.g. ROM, JHN, PSA)
        # We don't need to know the book code because we just search by chapter+verse
        # pattern: data-usfm ends with ".CH.V" (the number portion)
        pattern = re.compile(rf'\.\s*{chapter}\s*\.\s*{verse_num}\s*$')

        verse_span = None
        for span in soup.find_all("span", attrs={"data-usfm": True}):
            if pattern.search(span["data-usfm"]):
                verse_span = span
                break

        if verse_span is None:
            print(f"    [WARN] Verse {verse_num} not found in {page_url}")
            continue

        # Extract text content, preserving structure:
        # Add superscript verse number then the text
        verse_text = ""
        for child in verse_span.descendants:
            if hasattr(child, 'name'):
                if child.name == 'sup':
                    verse_text += f"<sup>{child.get_text()}</sup>"
            else:
                # text node – skip if it's inside a sup we already handled
                parent_names = [p.name for p in child.parents if hasattr(p, 'name')]
                if 'sup' not in parent_names:
                    t = str(child)
                    if t.strip():
                        verse_text += t

        if verse_text.strip():
            collected_parts.append(verse_text.strip())

    result = " ".join(collected_parts).strip()

    if not result:
        # Fallback: grab all visible text from the chapter page matching verses
        print(f"    [WARN] Span-based extraction empty for {bibleref_english!r}, trying fallback")
        result = _bible_com_fallback(soup, chapter, verse_list)

    return result


def _bible_com_fallback(soup: BeautifulSoup, chapter: int, verse_list: list[int]) -> str:
    """
    Fallback: look for any element containing verse numbers as text
    near verse content. Returns plain concatenated text.
    """
    parts = []
    for verse_num in verse_list:
        # Search for <sup> or other elements with just the verse number
        for sup in soup.find_all(['sup', 'span'], string=str(verse_num)):
            parent = sup.find_parent()
            if parent:
                text = parent.get_text(separator=" ").strip()
                if len(text) > 5:
                    parts.append(f"<sup>{verse_num}</sup>{text}")
                    break
    return " ".join(parts)


# ---------------------------------------------------------------------------
# live.bible.is scraper (slot 2)
# ---------------------------------------------------------------------------

def scrape_bible_is(page_url: str, bibleref_english: str) -> str:
    """
    Fetch a chapter page from live.bible.is and return HTML for the
    specific verses.

    live.bible.is renders verses as <p> or <span> elements. The verse
    numbers appear in <sup> or dedicated span elements.
    """
    chapter, start_verse, verse_list = parse_verse_spec(bibleref_english)
    if not verse_list:
        print(f"    [WARN] Could not parse verse spec from: {bibleref_english!r}")
        return ""

    try:
        resp = SESSION.get(page_url, timeout=20)
        resp.raise_for_status()
    except Exception as e:
        print(f"    [ERROR] GET {page_url}: {e}")
        return ""

    soup = BeautifulSoup(resp.text, "html.parser")

    # live.bible.is structure varies but verses are commonly in elements with
    # id="V{N}" or data-id containing the verse number, or <sup class="v"> markers.
    # Strategy: find verse markers and collect text until the next marker.

    collected_parts = []

    # Approach 1: elements with id="V{N}"
    for verse_num in verse_list:
        el = soup.find(id=f"V{verse_num}") or soup.find(id=f"v{verse_num}")
        if el:
            text = el.get_text(separator=" ").strip()
            collected_parts.append(f"<sup>{verse_num}</sup>{text}")

    if collected_parts:
        return " ".join(collected_parts).strip()

    # Approach 2: look for <sup> verse numbers and grab sibling/parent text
    for verse_num in verse_list:
        sups = soup.find_all("sup", string=re.compile(rf'^\s*{verse_num}\s*$'))
        for sup in sups:
            parent = sup.find_parent()
            if parent:
                # Get text after the sup
                text_parts = []
                found_sup = False
                for child in parent.children:
                    if child == sup:
                        found_sup = True
                        continue
                    if found_sup:
                        if hasattr(child, 'name') and child.name == 'sup':
                            break  # next verse
                        text_parts.append(child.get_text() if hasattr(child, 'get_text') else str(child))
                verse_text = "".join(text_parts).strip()
                if verse_text:
                    collected_parts.append(f"<sup>{verse_num}</sup>{verse_text}")
                    break

    if collected_parts:
        return " ".join(collected_parts).strip()

    # Approach 3: plain text dump, find verse numbers as anchors
    print(f"    [WARN] All structured approaches failed for {page_url}, returning empty")
    return ""


# ---------------------------------------------------------------------------
# Tree walker and main population logic
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
        ref_en = obj.get("bibleRef7", "")  # English reference is the reliable one

        # NOTE: slot 2 (live.bible.is / CLV) is disabled because the site is
        # JavaScript-rendered and requests/BeautifulSoup cannot retrieve its content.
        # To re-enable it, add (2, scrape_bible_is) back into the list below and
        # replace the scraper with a Selenium/Playwright-based implementation.
        # The scrape_bible_is() function above is preserved and ready to be wired in.
        for slot, scrape_fn in [(1, scrape_bible_com), (3, scrape_bible_com), (4, scrape_bible_com)]:
            text_key = f"passageText{slot}"
            url_key = f"passageUrl{slot}"

            existing = obj.get(text_key, "")
            if existing and existing.strip():
                # Already populated – skip
                stats["skipped"] += 1
                continue

            url = obj.get(url_key, "")
            if not url:
                print(f"  [{element_id}] slot{slot}: no URL, skipping")
                stats["no_url"] += 1
                continue

            print(f"  [{element_id}] slot{slot} ({obj.get(f'translation{slot}','?')}): scraping {url}")
            text = scrape_fn(url, ref_en)

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

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    print(f"Loading {input_path}...")
    with open(input_path, encoding="utf-8") as f:
        data = json.load(f)

    data_copy = copy.deepcopy(data)

    stats = {"populated": 0, "skipped": 0, "failed": 0, "no_url": 0}

    print("\nProcessing biblePassage elements...\n")
    find_and_update_passages(data_copy, stats)

    print(f"\n--- Done ---")
    print(f"  Populated : {stats['populated']}")
    print(f"  Skipped   : {stats['skipped']} (already had text)")
    print(f"  Failed    : {stats['failed']} (empty result)")
    print(f"  No URL    : {stats['no_url']}")

    print(f"\nWriting {output_path}...")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data_copy, f, ensure_ascii=False, indent=2)
    print("Done.")


if __name__ == "__main__":
    main()
