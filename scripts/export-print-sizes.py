#!/usr/bin/env python3
"""Pack approved catalog PNGs into an Etsy-sized zip.

Buyer zip = the three source posters + How-to-print.txt.
We do not upscale to fake 300dpi 18x24 files (those zips were 400MB+).

Usage:
  python3 scripts/export-print-sizes.py --set apothecary
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "catalog/halloween-gothic-2026"
CANDIDATES = CATALOG / "candidates"
EXPORT = CATALOG / "export"
SETS = CATALOG / "listings/sets.json"


def find_source(id_: str) -> Path:
    matches = sorted(CANDIDATES.glob(f"hm-{id_}-*.png"))
    if not matches:
        sys.exit(f"No candidate for id {id_}")
    return matches[0]


def pack_set(slug: str) -> Path:
    data = json.loads(SETS.read_text())
    match = next((s for s in data["sets"] if s["id"] == slug), None)
    if not match:
        sys.exit(f"Unknown set {slug}")
    EXPORT.mkdir(parents=True, exist_ok=True)
    tight = EXPORT / f"{slug}.zip"
    if tight.exists():
        tight.unlink()
    howto = CATALOG / "listings/HOW-TO-PRINT.txt"
    with tempfile.TemporaryDirectory() as tmp:
        dest = Path(tmp) / slug
        dest.mkdir()
        for member in match["members"]:
            src = find_source(member)
            shutil.copy2(src, dest / src.name)
        if howto.exists():
            shutil.copy2(howto, dest / "How-to-print.txt")
        subprocess.check_call(
            ["zip", "-r", "-9", str(tight), slug],
            cwd=tmp,
            stdout=subprocess.DEVNULL,
        )
    return tight


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--set", required=True)
    args = p.parse_args()
    out = pack_set(args.set)
    size_mb = out.stat().st_size / (1024 * 1024)
    print(f"{out} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
