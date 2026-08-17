#!/usr/bin/env python3
"""Export approved (or named) catalog PNGs into common printable sizes.

Sources are generated posters, not 300dpi scans. We upscale/letterbox to
target pixel sizes at 300dpi. Be honest in listing copy: print quality
depends on the source.

Usage:
  python3 scripts/export-print-sizes.py --id 01
  python3 scripts/export-print-sizes.py --set moon-garden
  python3 scripts/export-print-sizes.py --all

Requires macOS `sips` or ImageMagick `magick`. Output is gitignored.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "catalog/halloween-gothic-2026"
CANDIDATES = CATALOG / "candidates"
EXPORT = CATALOG / "export"
SETS = CATALOG / "listings/sets.json"

# inches at 300 dpi
SIZES = {
    "4x6": (1200, 1800),
    "5x7": (1500, 2100),
    "8x10": (2400, 3000),
    "11x14": (3300, 4200),
    "16x20": (4800, 6000),
    "18x24": (5400, 7200),
    "A4": (2480, 3508),
    "A3": (3508, 4961),
}


def tool() -> list[str]:
    if shutil.which("sips"):
        return ["sips"]
    if shutil.which("magick"):
        return ["magick"]
    sys.exit("Need macOS sips or ImageMagick magick on PATH")


def find_source(id_: str) -> Path:
    matches = sorted(CANDIDATES.glob(f"hm-{id_}-*.png"))
    if not matches:
        sys.exit(f"No candidate for id {id_}")
    return matches[0]


def resize(src: Path, dest: Path, w: int, h: int) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    t = tool()
    if t[0] == "sips":
        subprocess.check_call(
            [
                "sips",
                "-z",
                str(h),
                str(w),
                str(src),
                "--out",
                str(dest),
            ],
            stdout=subprocess.DEVNULL,
        )
    else:
        subprocess.check_call(
            [
                "magick",
                str(src),
                "-resize",
                f"{w}x{h}^",
                "-gravity",
                "center",
                "-extent",
                f"{w}x{h}",
                str(dest),
            ]
        )


def export_id(id_: str) -> Path:
    src = find_source(id_)
    out_dir = EXPORT / id_
    out_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, out_dir / src.name)
    for name, (w, h) in SIZES.items():
        resize(src, out_dir / f"{id_}-{name}.png", w, h)
    (out_dir / "FILES.txt").write_text(
        "Nixon Made printable. Personal use. Do not resell files.\n"
        "AI-generated from original prompts; designed by the seller.\n"
        f"Source: {src.name}\n",
        encoding="utf-8",
    )
    return out_dir


def pack_set(slug: str) -> Path:
    data = json.loads(SETS.read_text())
    match = next((s for s in data["sets"] if s["id"] == slug), None)
    if not match:
        sys.exit(f"Unknown set {slug}")
    dirs = [export_id(member) for member in match["members"]]
    howto = CATALOG / "listings/HOW-TO-PRINT.txt"
    tight = EXPORT / f"{slug}.zip"
    if tight.exists():
        tight.unlink()
    cmd = ["zip", "-r", str(tight.name)]
    cmd.extend(d.name for d in dirs)
    if howto.exists():
        shutil.copy2(howto, EXPORT / "How-to-print.txt")
        cmd.append("How-to-print.txt")
    subprocess.check_call(cmd, cwd=EXPORT)
    return tight


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--id")
    p.add_argument("--set")
    p.add_argument("--all", action="store_true")
    args = p.parse_args()
    if args.id:
        print(export_id(args.id))
    elif args.set:
        print(pack_set(args.set))
    elif args.all:
        for png in sorted(CANDIDATES.glob("hm-*.png")):
            export_id(png.name[3:5])
    else:
        p.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
