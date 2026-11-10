#!/usr/bin/env python3
"""Build the bsr-studies download site and point the app's download links at it.

    python3 py/build_studies_site.py [--out DIR] [--no-links]

The site is a separate git repository published with GitHub Pages at
BASE_URL. Its default checkout is a "bsr-studies" folder next to this repo.
From the studies in py/published_studies.list (paths relative to
"estudy_en (v3)/") it writes:

  studies/<studyId>.estudy           each study, byte-for-byte, under its stable id
  bundles/path-<pathwayId>.zip       the published studies of each built-in
                                     learning pathway (when it has two or more)
  bundles/shelf-<shelf>-<section>.zip  the same for each shelf section
  catalogue.json                     machine-readable list (for a future in-app catalogue)
  index.html                         the page the app's "Download studies" button opens
  README.md, .nojekyll

Files left over from earlier builds are removed. Zips are written with fixed
dates, so rebuilding unchanged studies changes nothing. Each study is checked
with validate_study.py; errors are listed at the end but do not stop the build
(as in build_first_estudies.py: judge each one).

Unless --no-links is given, it then rewrites the download links in the app's
locale files (all languages):
  - learningPathways_*.json: every study entry whose study is published, and
    every pathway that has a bundle, gets its GitHub address (replacing a Drive
    link, or added before "studyId" / "studyTitles"). Entries for studies that
    are not published keep whatever link they had.
  - libraryShelvesStructure_*.json: an existing section link is replaced when
    that section has a bundle (sections are matched by position, which every
    language shares with English).
Commit and push the site folder, and this repo's changed locale files.
Standard library only.
"""

import argparse
import hashlib
import html
import json
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LIST = REPO / "py" / "published_studies.list"
STUDIES = REPO / "estudy_en (v3)"
LOCALES = REPO / "app" / "js" / "locales"
BASE_URL = "https://rickcreightoninnigeria.github.io/bsr-studies/"
PLAY_URL = "https://play.google.com/store/apps/details?id=com.rickcreighton.bsr"
WEB_APP_URL = "https://rickcreightoninnigeria.github.io/bible-study-reader/"
FIXED_DATE = (2026, 1, 1, 0, 0, 0)

# Study ids still used by older pathway files (mostly the translations) for
# studies that are now published under another id. Links only; the pathway
# files' studyIds are left as they are.
ID_ALIASES = {
    "find_rest_for_your_soul_v001": "find_rest_v001",
    "bible_overview_(1)_v001": "bible_overview_ot_v001",
    "bible_overview_(2)_v001": "bible_overview_nt_v001",
    "introducing_jonah_v001": "travelling_with_jonah_v001",
}


def listed_paths():
    for line in LIST.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            yield line


def read_study(path):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        name = "study.json" if "study.json" in names else next(
            n for n in names if n.endswith(".json") and "/" not in n)
        return json.loads(z.read(name))


def text_of(value, lang="en"):
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return value.get(lang) or next((v for v in value.values() if isinstance(v, str)), "")
    return ""


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("’", "").replace("'", "")).strip("-")


def write_zip(target, members):
    """members: [(name in zip, source path)]. Stored (the .estudy files are
    already compressed), with fixed dates so the bytes only change with the content."""
    with zipfile.ZipFile(target, "w", zipfile.ZIP_STORED) as z:
        for arcname, src in members:
            info = zipfile.ZipInfo(arcname, FIXED_DATE)
            info.external_attr = 0o644 << 16
            z.writestr(info, Path(src).read_bytes())


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


# ── Building the site ─────────────────────────────────────────────────────────

def collect_studies():
    studies, problems, with_errors = [], [], []
    for rel in listed_paths():
        path = STUDIES / rel
        if not path.is_file():
            problems.append(f"not found: {rel}")
            continue
        r = subprocess.run([sys.executable, str(REPO / "py" / "validate_study.py"), str(path)],
                           capture_output=True, text=True)
        summary = (r.stdout.strip().splitlines() or [""])[-1]
        print(f"  {path.name}: {summary}")
        if r.returncode != 0:
            with_errors.append(path.name)
        meta = read_study(path).get("studyMetadata", {})
        sid = meta.get("studyId")
        if not isinstance(sid, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+", sid):
            problems.append(f"no valid studyId: {rel}")
            continue
        langs = [meta[k] for k in sorted(meta) if re.fullmatch(r"language\d+", k) and isinstance(meta[k], str)]
        studies.append({
            "path": path,
            "studyId": sid,
            "title": text_of(meta.get("title")) or sid,
            "subtitle": text_of(meta.get("subtitle")),
            "version": str(meta.get("studyVersion", "")).strip(),
            "languages": langs or ["en"],
            "shelves": [s for s in meta.get("libraryShelves", []) if isinstance(s, dict)],
        })
    ids = [s["studyId"] for s in studies]
    problems += [f"two published studies with the id {i}" for i in sorted(set(ids)) if ids.count(i) > 1]
    return studies, problems, with_errors


def build_bundles(studies, out):
    by_id = {s["studyId"]: s for s in studies}
    bundles = []
    pathways = json.loads((LOCALES / "en" / "learningPathways_en.json").read_text(encoding="utf-8"))
    for group in pathways.get("learningPathways", []):
        for p in group.get("pathways", []):
            members = [by_id[e["studyId"]] for e in p.get("studyTitles", []) if e.get("studyId") in by_id]
            if len(members) >= 2 and p.get("pathwayId"):
                bundles.append({"id": f"path-{p['pathwayId']}", "type": "pathway", "key": p["pathwayId"],
                                "title": p.get("titleLevel2", p["pathwayId"]), "members": members})
    sections = {}
    for s in studies:
        for sh in s["shelves"]:
            key = (sh.get("Shelf", ""), sh.get("Section", ""))
            if all(key) and s not in sections.setdefault(key, []):
                sections[key].append(s)
    for (shelf, section), members in sections.items():
        if len(members) >= 2:
            bundles.append({"id": f"shelf-{slug(shelf)}-{slug(section)}", "type": "shelf", "key": (shelf, section),
                            "title": f"{shelf}: {section}", "members": members})
    (out / "bundles").mkdir(parents=True, exist_ok=True)
    for b in bundles:
        b["file"] = f"bundles/{b['id']}.zip"
        write_zip(out / b["file"], [(m["path"].name, m["path"]) for m in b["members"]])
    return bundles


def shelf_order():
    data = json.loads((LOCALES / "en" / "libraryShelvesStructure_en.json").read_text(encoding="utf-8"))
    shelves = data.get("libraryShelvesStructure", data) if isinstance(data, dict) else data
    return [s.get("shelf") for s in shelves if isinstance(s, dict)] if isinstance(shelves, list) else []


def size_text(n):
    return f"{n / 1048576:.1f} MB" if n >= 1048576 else f"{max(1, round(n / 1024))} KB"


def write_index(out, studies, bundles):
    order = shelf_order()
    groups = {}
    for s in studies:
        shelf = s["shelves"][0].get("Shelf", "Other") if s["shelves"] else "Other"
        groups.setdefault(shelf, []).append(s)
    names = sorted(groups, key=lambda g: (order.index(g) if g in order else len(order), g))
    e = html.escape
    parts = []
    for g in names:
        rows = "\n".join(
            f'      <li><div><b>{e(s["title"])}</b>'
            + (f'<span class="sub">{e(s["subtitle"])}</span>' if s["subtitle"] else "")
            + f'<span class="meta">Version {e(s["version"])} · {size_text(s["size"])}</span></div>'
            f'<a class="dl" href="{e(s["file"])}" download>Download</a></li>'
            for s in sorted(groups[g], key=lambda s: s["title"].lower()))
        parts.append(f'    <h2>{e(g)}</h2>\n    <ul>\n{rows}\n    </ul>')
    paths = [b for b in bundles if b["type"] == "pathway"]
    if paths:
        rows = "\n".join(
            f'      <li><div><b>{e(b["title"])}</b><span class="meta">{len(b["members"])} studies · {size_text(b["size"])}</span></div>'
            f'<a class="dl" href="{e(b["file"])}" download>Download</a></li>' for b in paths)
        parts.append(f'    <h2>Learning paths (several studies in one file)</h2>\n    <ul>\n{rows}\n    </ul>')
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bible Study Reader – Studies</title>
<style>
  :root {{ --bg:#f5f0e8; --card:#fffdf8; --text:#1c1710; --mute:#6b604f; --accent:#8a5a14; --line:#e2d8c6; }}
  @media (prefers-color-scheme: dark) {{ :root {{ --bg:#1c1710; --card:#2a231a; --text:#f0e8da; --mute:#b5a890; --accent:#e0a84a; --line:#3d3326; }} }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--text); font:17px/1.5 system-ui, sans-serif; }}
  main {{ max-width:720px; margin:0 auto; padding:24px 16px 48px; }}
  h1 {{ font-size:1.6rem; margin:0 0 8px; }}
  h2 {{ font-size:1.05rem; margin:28px 0 8px; color:var(--accent); text-transform:uppercase; letter-spacing:.05em; }}
  p {{ margin:0 0 12px; }}
  ul {{ list-style:none; margin:0; padding:0; }}
  li {{ display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;
        background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin:0 0 8px; }}
  li div {{ flex:1 1 220px; min-width:0; }}
  .sub, .meta {{ display:block; color:var(--mute); font-size:.9rem; }}
  .dl {{ background:var(--accent); color:var(--bg); text-decoration:none; font-weight:600; border-radius:8px; padding:10px 16px; }}
  a {{ color:var(--accent); }}
</style>
</head>
<body>
<main>
  <h1>Bible Study Reader – Studies</h1>
  <p>Tap <b>Download</b>, then open the file with the Bible Study Reader app. On Android, tap the downloaded file and choose Bible Study Reader.</p>
  <p>Don’t have the app? <a href="{PLAY_URL}">Get it on Google Play</a>, or <a href="{WEB_APP_URL}">use it in your browser</a>.</p>
{chr(10).join(parts)}
</main>
</body>
</html>
"""
    (out / "index.html").write_text(page, encoding="utf-8")


def write_readme(out):
    (out / "README.md").write_text(f"""# Bible Study Reader – studies

Published study files (`.estudy`) for the [Bible Study Reader]({WEB_APP_URL}) app,
served at {BASE_URL}

**Do not edit this repository by hand.** Everything here is generated by
`py/build_studies_site.py` in the bible-study-reader repository, from the studies
listed in its `py/published_studies.list`.

- `studies/<studyId>.estudy` – one file per study; the address stays the same when a study is updated.
- `bundles/` – several studies in one zip (learning paths and shelf sections).
- `catalogue.json` – the list of everything here, for the app.
- `index.html` – the download page.

Each study carries its own copyright and licence details (shown on its About page in the app).
""", encoding="utf-8")


def build_site(out):
    print(f"Building {out}")
    studies, problems, with_errors = collect_studies()
    if problems:
        sys.exit("build_studies_site: " + "; ".join(problems))
    out.mkdir(parents=True, exist_ok=True)
    for sub in ("studies", "bundles"):
        if (out / sub).exists():
            shutil.rmtree(out / sub)
    (out / "studies").mkdir()
    for s in studies:
        s["file"] = f"studies/{s['studyId']}.estudy"
        shutil.copyfile(s["path"], out / s["file"])
        s["size"] = (out / s["file"]).stat().st_size
        s["sha256"] = sha256(out / s["file"])
    bundles = build_bundles(studies, out)
    for b in bundles:
        b["size"] = (out / b["file"]).stat().st_size
    catalogue = {
        "catalogueVersion": 1,
        "baseUrl": BASE_URL,
        "studies": [{k: s[k] for k in ("studyId", "title", "subtitle", "version", "languages", "shelves", "file", "size", "sha256")}
                    for s in sorted(studies, key=lambda s: s["studyId"])],
        "bundles": [{"id": b["id"], "type": b["type"], "title": b["title"], "file": b["file"], "size": b["size"],
                     "studyIds": [m["studyId"] for m in b["members"]]} for b in bundles],
    }
    (out / "catalogue.json").write_text(json.dumps(catalogue, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_index(out, studies, bundles)
    write_readme(out)
    (out / ".nojekyll").write_text("", encoding="utf-8")
    print(f"  {len(studies)} studies, {len(bundles)} bundles")
    if with_errors:
        print("  Validator errors (judge each; the build went ahead): " + ", ".join(with_errors))
    return studies, bundles


# ── Pointing the app's links at the site ──────────────────────────────────────

DL_RE = re.compile(r'("downloadLocation"\s*:\s*")[^"]*(")')


def _dl_line_like(anchor_line, url):
    """A downloadLocation line in the same style as the line it goes before."""
    m = re.match(r'(\s*)"[^"]+"(\s*):(\s*)', anchor_line)
    indent, spaced = m.group(1), bool(m.group(3))
    return f'{indent}"downloadLocation":{" " if spaced else ""}"{url}",\n'


def update_pathway_file(path, study_urls, pathway_urls):
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    out, last_open, dl_at, changed = [], -1, None, 0
    pathway_id = None
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("{"):
            last_open, dl_at = len(out), None
        m_dl = re.match(r'\s*"downloadLocation"\s*:', line)
        m_sid = re.match(r'\s*"studyId"\s*:\s*"([^"]*)"', line)
        m_pid = re.match(r'\s*"pathwayId"\s*:\s*"([^"]*)"', line)
        if m_pid:
            pathway_id = m_pid.group(1)
        if m_dl:
            dl_at = len(out)
        url = None
        if m_sid:
            sid = m_sid.group(1)
            url = study_urls.get(sid) or study_urls.get(ID_ALIASES.get(sid, "")) or \
                study_urls.get(sid.replace("_en_v", "_v")) or study_urls.get(ID_ALIASES.get(sid.replace("_en_v", "_v"), ""))
        elif re.match(r'\s*"studyTitles"\s*:', line) and pathway_id:
            url = pathway_urls.get(pathway_id)
        if url:
            if dl_at is not None and dl_at > last_open:
                new = DL_RE.sub(lambda m: m.group(1) + url + m.group(2), out[dl_at])
                if new != out[dl_at]:
                    out[dl_at], changed = new, changed + 1
            else:
                out.append(_dl_line_like(line, url))
                changed += 1
            dl_at = None
        out.append(line)
    if changed:
        text = "".join(out)
        json.loads(text)
        path.write_text(text, encoding="utf-8")
    return changed


def _sections(data):
    shelves = data.get("libraryShelvesStructure", data) if isinstance(data, dict) else data
    for shelf in shelves if isinstance(shelves, list) else []:
        for sec in shelf.get("sections", []) if isinstance(shelf, dict) else []:
            yield shelf, sec


def update_shelf_file(path, en_data, section_urls):
    text = path.read_text(encoding="utf-8")
    data = json.loads(text)
    en_secs = list(_sections(en_data))
    secs = list(_sections(data))
    if len(en_secs) != len(secs):
        print(f"  skipped {path.name}: its shelf list does not match English")
        return 0
    wanted = []
    for (en_shelf, en_sec), (_, sec) in zip(en_secs, secs):
        if sec.get("downloadLocation"):
            wanted.append(section_urls.get((en_shelf.get("shelf"), en_sec.get("section"))) or sec["downloadLocation"])
    it = iter(wanted)
    new = DL_RE.sub(lambda m: m.group(1) + next(it) + m.group(2), text)
    if new != text:
        json.loads(new)
        path.write_text(new, encoding="utf-8")
        return 1
    return 0


def update_links(studies, bundles):
    study_urls = {s["studyId"]: BASE_URL + s["file"] for s in studies}
    pathway_urls = {b["key"]: BASE_URL + b["file"] for b in bundles if b["type"] == "pathway"}
    section_urls = {b["key"]: BASE_URL + b["file"] for b in bundles if b["type"] == "shelf"}
    total = 0
    for f in sorted(LOCALES.glob("*/learningPathways*.json")):
        n = update_pathway_file(f, study_urls, pathway_urls)
        if n:
            print(f"  {f.relative_to(REPO)}: {n} link(s)")
        total += n
    en_shelves = json.loads((LOCALES / "en" / "libraryShelvesStructure_en.json").read_text(encoding="utf-8"))
    for f in sorted(LOCALES.glob("*/libraryShelvesStructure_*.json")):
        if update_shelf_file(f, en_shelves, section_urls):
            print(f"  {f.relative_to(REPO)}: section link(s)")
            total += 1
    print(f"  links updated in {total} place(s)" if total else "  links already up to date")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=REPO.parent / "bsr-studies", help="the bsr-studies checkout")
    ap.add_argument("--no-links", action="store_true", help="do not change the app's download links")
    args = ap.parse_args()
    studies, bundles = build_site(args.out.resolve())
    if not args.no_links:
        update_links(studies, bundles)


if __name__ == "__main__":
    main()
