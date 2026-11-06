#!/usr/bin/env python3
"""Build the web version of the Bible Study Reader.

    python3 py/build_web.py [--out DIR]        (default: dist/web)

Copies app/ into DIR, leaves out the author tools that are not part of the
reader, and writes DIR/sw.js from app/sw.js with the list of files to cache
(each with a content hash) and a build id. Because the id and list change
whenever any app file changes, the browser sees a different sw.js and fetches
the new version; unchanged files are not downloaded again (see sw.js).

Nothing here needs a network, and only the standard library is used.
Deploy DIR as the root of the site (the GitHub Pages workflow does).
"""

import argparse
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
APP = REPO / "app"

# Author tools in app/ that readers do not need.
EXCLUDE = {
    "estudy-editor.html",
    "study-editor.html",
    "study-editor-translate.html",
    "ui-translate.html",
    "sw.js",           # replaced below by the generated one
}
EXCLUDE_NAMES = {".DS_Store", "Thumbs.db"}

# Files the shell needs that index.html does not name.
ALWAYS_REQUIRED = ["manifest.webmanifest", "js/appAboutData_untranslated.json"]
EN_STRINGS_DIR = "js/locales/en"

# Cached up front but allowed to fail: they make the app nicer offline, not usable.
OPTIONAL = [
    "images/favicon.svg",
    "images/pwa-icon-192.png",
    "images/pwa-icon-512.png",
    "estudy/firstEstudies.zip",
]
# Latin faces the app and the print page use; the Noto script fonts and the
# rest are cached the first time a language needs them.
LATIN_FONT_PREFIXES = ("PlayfairDisplay", "SourceSerif4", "DMMono", "Inter")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()[:16]


def local_refs(index_html: str):
    """Relative src/href targets in index.html, query strings removed."""
    for m in re.finditer(r'(?:src|href)="([^"#]+)"', index_html):
        ref = m.group(1)
        if re.match(r"^[a-z]+:", ref) or ref.startswith("//"):
            continue
        yield ref.split("?")[0]


def latin_fonts():
    css = (APP / "css" / "01-fonts.css").read_text(encoding="utf-8")
    for m in re.finditer(r"url\(['\"]?\.\./fonts/([^'\")]+)['\"]?\)", css):
        name = m.group(1)
        if name.startswith(LATIN_FONT_PREFIXES):
            yield "fonts/" + name


def precache_list(out: Path):
    """[{url, hash, optional?}] for everything cached at install."""
    required = []
    for ref in local_refs((APP / "index.html").read_text(encoding="utf-8")):
        if ref.endswith((".css", ".js")) or ref in ("manifest.webmanifest",):
            required.append(ref)
    required.append("index.html")
    required += ALWAYS_REQUIRED
    required += sorted(p.relative_to(out).as_posix() for p in (out / EN_STRINGS_DIR).glob("*.json"))
    optional = list(OPTIONAL) + sorted(set(latin_fonts()))

    entries, seen = [], set()
    for url, is_optional in [(u, False) for u in required] + [(u, True) for u in optional]:
        if url in seen:
            continue
        seen.add(url)
        path = out / url
        if not path.is_file():
            if is_optional:
                continue            # e.g. the starter studies are not in every checkout
            sys.exit(f"build_web: required file missing from the build: {url}")
        entry = {"url": url, "hash": sha256(path)}
        if is_optional:
            entry["optional"] = True
        entries.append(entry)
    return entries


def build(out: Path):
    if not (APP / "index.html").is_file():
        sys.exit(f"build_web: {APP / 'index.html'} not found")
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(
        APP, out,
        ignore=lambda d, names: [n for n in names if n in EXCLUDE or n in EXCLUDE_NAMES],
    )

    entries = precache_list(out)
    build_id = hashlib.sha256(
        "\n".join(f"{e['url']}:{e['hash']}" for e in sorted(entries, key=lambda e: e["url"])).encode()
    ).hexdigest()[:12]

    sw = (APP / "sw.js").read_text(encoding="utf-8")
    sw, n1 = re.subn(r"^const PRECACHE = .*// __PRECACHE__.*$",
                     lambda m: "const PRECACHE = " + json.dumps(entries, indent=2) + ";   // __PRECACHE__",
                     sw, flags=re.M)
    sw, n2 = re.subn(r"^const BUILD_ID = .*// __BUILD_ID__.*$",
                     lambda m: f"const BUILD_ID = '{build_id}';   // __BUILD_ID__",
                     sw, flags=re.M)
    if (n1, n2) != (1, 1):
        sys.exit("build_web: the marked PRECACHE / BUILD_ID lines in app/sw.js were not found")
    (out / "sw.js").write_text(sw, encoding="utf-8")

    total = sum((out / e["url"]).stat().st_size for e in entries)
    print(f"build_web: {out}")
    print(f"  build id {build_id}; {len(entries)} files precached "
          f"({sum(1 for e in entries if not e.get('optional'))} required), {total / 1e6:.1f} MB")
    return build_id, entries


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", default=str(REPO / "dist" / "web"), help="output folder (default: dist/web)")
    args = ap.parse_args()
    out = Path(args.out).resolve()
    # The build empties its output folder, so only accept one that is new,
    # empty, or is a previous build (it has the sw.js and index.html we write).
    # Never the repo, app/, or a folder that contains app/.
    if out == REPO or out == APP or APP.is_relative_to(out) or REPO.is_relative_to(out):
        sys.exit(f"build_web: refusing to use {out} as the output folder")
    if out.exists() and any(out.iterdir()) and not ((out / "sw.js").is_file() and (out / "index.html").is_file()):
        sys.exit(f"build_web: {out} exists and is not an empty folder or an earlier build")
    build(out)


if __name__ == "__main__":
    main()
