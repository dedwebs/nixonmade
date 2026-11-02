#!/usr/bin/env python3
"""Regenerate NixonMade favicon, apple-touch icon, and Open Graph images.

The header on the site still uses public/brand/press-stamp.svg. This script
does not replace that file. Favicons and social images are drawn from one of
the wordmarks in public/brand/options/.

Usage:
  python3 scripts/brand_assets.py
  python3 scripts/brand_assets.py --option 2

Options:
  1  NM monogram (default; current favicon and OG mark)
  2  NixonMade wordmark
  3  N monogram

Requires Pillow and fontTools, and the Inter font files from the OS.
Re-run this after a logo is chosen. Then point favicon.svg at that option
by passing --option. Page templates do not need edits unless the OG filename
changes.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "public" / "brand" / "options"
OG_DIR = ROOT / "public" / "og"
PUBLIC = ROOT / "public"

REGULAR = "/usr/share/fonts/truetype/macos/Inter-Regular.ttf"
SEMIBOLD = "/usr/share/fonts/truetype/macos/Inter-SemiBold.ttf"
BOLD = "/usr/share/fonts/truetype/macos/Inter-Bold.ttf"

PAPER = (246, 243, 236, 255)
INK = (26, 23, 20, 255)
MUTED = (62, 57, 52, 255)

OPTIONS = {
    1: {
        "file": "option-1-monogram.svg",
        "label": "NM",
        "font": BOLD,
        "size": 240,
        "tracking": -8,
        "square": True,
    },
    2: {
        "file": "option-2-wordmark.svg",
        "label": "NixonMade",
        "font": SEMIBOLD,
        "size": 160,
        "tracking": -3,
        "square": False,
    },
    3: {
        "file": "option-3-n.svg",
        "label": "N",
        "font": BOLD,
        "size": 280,
        "tracking": 0,
        "square": True,
    },
}

PAGES = [
    ("home", "NixonMade", "Tools for Jamf admins and iOS developers."),
    ("field-kit", "Field Kit", "A Jamf Pro admin kit. $20."),
    ("ship-kit", "Ship Kit", "Scripts for a SwiftUI iOS app. $49. Coming soon."),
    ("fleet-sheets", "Fleet Sheets", "Jamf Pro exports as an Excel workbook. $29."),
    ("relnotes", "relnotes", "Release notes that write themselves. Coming soon."),
    ("terms", "Terms of sale", "NixonMade"),
    ("refunds", "Refund policy", "NixonMade"),
    ("privacy", "Privacy", "NixonMade"),
    ("kittie", "Kittie Solitare", "Cozy premium Klondike. Coming soon."),
    ("kittie-privacy", "Kittie Solitare privacy", "NixonMade"),
    ("kittie-support", "Kittie Solitare support", "NixonMade"),
    ("brand", "Mark", "NixonMade"),
    ("brand-options", "Wordmark options", "NixonMade"),
    ("field-kit-thanks", "Field Kit", "Your download link is in your email."),
    ("ship-kit-thanks", "Ship Kit", "Your download link is in your email."),
    ("fleet-sheets-thanks", "Fleet Sheets", "Your download link is in your email."),
    ("relnotes-thanks", "relnotes", "Coming soon."),
]


def text_to_svg(text: str, font_path: str, font_size: float, tracking: float, square: bool) -> str:
    font = TTFont(font_path)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    upem = font["head"].unitsPerEm
    scale = font_size / upem
    ascender = font["hhea"].ascender * scale
    descender = font["hhea"].descender * scale
    x = 0.0
    commands: list[str] = []
    for char in text:
        name = cmap[ord(char)]
        pen = SVGPathPen(glyph_set)
        transform = TransformPen(pen, (scale, 0, 0, -scale, x, 0))
        glyph_set[name].draw(transform)
        commands.append(pen.getCommands())
        x += font["hmtx"][name][0] * scale + tracking
    width = max(x - tracking, font_size * 0.4)
    height = ascender - descender
    pad_x = font_size * (0.42 if square else 0.06)
    pad_y = font_size * (0.34 if square else 0.12)
    if square:
        side = max(width + pad_x * 2, height + pad_y * 2)
        pad_x = (side - width) / 2
        pad_y = (side - height) / 2
        vb_w = side
        vb_h = side
    else:
        vb_w = width + pad_x * 2
        vb_h = height + pad_y * 2
    translate_y = pad_y + ascender
    path = " ".join(commands)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb_w:.2f} {vb_h:.2f}" '
        f'fill="currentColor" role="img" aria-hidden="true">\n'
        f'  <g transform="translate({pad_x:.2f} {translate_y:.2f})">\n'
        f'    <path d="{path}"/>\n'
        f"  </g>\n"
        f"</svg>\n"
    )


def wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, limit: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        trial = word if not current else current + " " + word
        if draw.textlength(trial, font=font) <= limit:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def render_og(option: int, slug: str, title: str, subtitle: str) -> None:
    image = Image.new("RGB", (1200, 630), PAPER[:3])
    draw = ImageDraw.Draw(image)
    mark_font = ImageFont.truetype(BOLD if option != 2 else SEMIBOLD, 92 if option != 2 else 54)
    title_font = ImageFont.truetype(SEMIBOLD, 72)
    sub_font = ImageFont.truetype(REGULAR, 32)
    meta_font = ImageFont.truetype(REGULAR, 24)
    mark = OPTIONS[option]["label"]
    draw.text((80, 78), mark, font=mark_font, fill=INK[:3])
    title_lines = wrap(draw, title, title_font, 1040)
    y = 250
    for line in title_lines[:2]:
        draw.text((80, y), line, font=title_font, fill=INK[:3])
        y += 84
    sub_lines = wrap(draw, subtitle, sub_font, 1000)
    y = 250 + 84 * min(len(title_lines), 2) + 8
    for line in sub_lines[:2]:
        draw.text((80, y), line, font=sub_font, fill=MUTED[:3])
        y += 44
    draw.text((80, 560), "nixonmade.com", font=meta_font, fill=MUTED[:3])
    image.save(OG_DIR / f"{slug}.png", "PNG", optimize=True)


def render_icons(option: int) -> None:
    label = OPTIONS[option]["label"]
    font_path = BOLD if option != 2 else SEMIBOLD

    def draw_mark(size: int, canvas: int) -> Image.Image:
        scale = 4
        image = Image.new("RGBA", (canvas * scale, canvas * scale), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype(font_path, size * scale)
        box = draw.textbbox((0, 0), label, font=font)
        tw, th = box[2] - box[0], box[3] - box[1]
        x = (canvas * scale - tw) / 2 - box[0]
        y = (canvas * scale - th) / 2 - box[1]
        draw.text((x, y), label, font=font, fill=INK)
        return image.resize((canvas, canvas), Image.Resampling.LANCZOS)

    svg = (BRAND / OPTIONS[option]["file"]).read_text()
    (PUBLIC / "favicon.svg").write_text(svg)

    icon32 = draw_mark(15 if option == 2 else 18, 32)
    icon16 = draw_mark(8 if option == 2 else 10, 16)
    icon48 = draw_mark(22 if option == 2 else 26, 48)
    icon32.save(PUBLIC / "favicon-32.png", "PNG")
    icon16.save(PUBLIC / "favicon-16.png", "PNG")
    icon32.save(
        PUBLIC / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
        append_images=[icon16, icon48],
    )

    touch = Image.new("RGBA", (180, 180), PAPER)
    mark = draw_mark(72 if option != 2 else 28, 180)
    touch.alpha_composite(mark)
    touch.convert("RGB").save(PUBLIC / "apple-touch-icon.png", "PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--option", type=int, default=1, choices=(1, 2, 3))
    args = parser.parse_args()
    BRAND.mkdir(parents=True, exist_ok=True)
    OG_DIR.mkdir(parents=True, exist_ok=True)
    for number, spec in OPTIONS.items():
        svg = text_to_svg(spec["label"], spec["font"], spec["size"], spec["tracking"], spec["square"])
        (BRAND / spec["file"]).write_text(svg)
    render_icons(args.option)
    for slug, title, subtitle in PAGES:
        render_og(args.option, slug, title, subtitle)
    print(f"Wrote options, favicons, and {len(PAGES)} Open Graph images from option {args.option}.")


if __name__ == "__main__":
    main()
