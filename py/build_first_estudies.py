#!/usr/bin/env python3
"""Build app/estudy/firstEstudies.zip from py/firstEstudies.list.

    python3 py/build_first_estudies.py [--no-android]

Each study named in the list (paths relative to "estudy_en (v3)/") is checked with
validate_study.py and added to the zip under its own file name. Validator errors
are listed at the end but do not stop the build (some are only links that will not
be tappable; judge each one). A missing file does stop it. The zip is then copied to the
Android project's assets/estudy/ (the two copies must stay identical), unless
--no-android is given or that project is not on this machine.
Standard library only.
"""

import argparse
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LIST = REPO / "py" / "firstEstudies.list"
STUDIES = REPO / "estudy_en (v3)"
ZIP = REPO / "app" / "estudy" / "firstEstudies.zip"
ANDROID_ZIP = Path.home() / "AndroidStudioProjects" / "bsr" / "app" / "src" / "main" / "assets" / "estudy" / "firstEstudies.zip"


def listed_paths():
    for line in LIST.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            yield line


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--no-android", action="store_true", help="do not copy the zip to the Android project")
    args = ap.parse_args()

    paths = [STUDIES / p for p in listed_paths()]
    names = [p.name for p in paths]
    problems = [f"not found: {p}" for p in paths if not p.is_file()]
    problems += [f"two studies named {n}" for n in sorted(set(names)) if names.count(n) > 1]
    with_errors = []
    for p in paths:
        if not p.is_file():
            continue
        r = subprocess.run([sys.executable, str(REPO / "py" / "validate_study.py"), str(p)], capture_output=True, text=True)
        summary = (r.stdout.strip().splitlines() or [""])[-1]
        print(f"  {p.name}: {summary}")
        if r.returncode != 0:
            with_errors.append(p.name)
    if problems:
        sys.exit("build_first_estudies: " + "; ".join(problems))

    tmp = ZIP.with_suffix(".zip.tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for p in paths:
            z.write(p, p.name)
    tmp.replace(ZIP)
    print(f"build_first_estudies: {ZIP.relative_to(REPO)}: {len(paths)} studies, {ZIP.stat().st_size / 1e6:.1f} MB")

    if with_errors:
        print("  validator errors in: " + ", ".join(with_errors))

    if not args.no_android:
        if ANDROID_ZIP.parent.is_dir():
            shutil.copyfile(ZIP, ANDROID_ZIP)
            print(f"  copied to {ANDROID_ZIP}")
        else:
            print("  Android project not found here; copy the zip to its assets/estudy/ yourself")


if __name__ == "__main__":
    main()
