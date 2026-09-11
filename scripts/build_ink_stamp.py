#!/usr/bin/env python3
"""Nixon Made as an old letterpress / ink-pad stamp."""

from __future__ import annotations

import math
from pathlib import Path

from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

FONT = Path("/System/Library/Fonts/Supplemental/Copperplate.ttc")
OUT = Path(__file__).resolve().parents[1] / "public" / "brand"

INK = "#1c1612"
PAPER = "#f3eee4"
OXBLOOD = "#8f2d21"


def load_font():
    return TTFont(str(FONT), fontNumber=2)  # Copperplate Bold


def glyph_path(font, ch: str):
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    name = cmap[ord(ch)]
    g = gs[name]
    pen = SVGPathPen(gs)
    tpen = TransformPen(pen, Transform(1, 0, 0, -1, 0, 0))
    g.draw(tpen)
    bpen = BoundsPen(gs)
    tpenb = TransformPen(bpen, Transform(1, 0, 0, -1, 0, 0))
    g.draw(tpenb)
    x0, y0, x1, y1 = bpen.bounds
    return pen.getCommands(), x0, y0, x1, y1


def star(cx: float, cy: float, r: float, fill: str) -> str:
    ri = r * 0.4
    pts = []
    for i in range(10):
        ang = math.radians(-90 + i * 36)
        rad = r if i % 2 == 0 else ri
        pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
    d = "M " + " L ".join(f"{x:.2f} {y:.2f}" for x, y in pts) + " Z"
    return f'<path d="{d}" fill="{fill}"/>'


def place_arc(
    font,
    text: str,
    cx: float,
    cy: float,
    radius: float,
    start_deg: float,
    end_deg: float,
    height: float,
    fill: str,
    flip: bool = False,
) -> str:
    glyphs = [glyph_path(font, ch) for ch in text]
    raw_h = max(g[4] - g[2] for g in glyphs)
    scale = height / raw_h
    gap = height * 0.16
    widths = [(g[3] - g[1]) * scale for g in glyphs]
    total = sum(widths) + gap * (len(text) - 1)
    start = math.radians(start_deg)
    end = math.radians(end_deg)
    parts = []
    walked = 0.0
    for (d, x0, y0, x1, y1), w in zip(glyphs, widths):
        mid = (walked + w / 2) / total
        ang = start + mid * (end - start)
        px = cx + radius * math.cos(ang)
        py = cy + radius * math.sin(ang)
        rot = math.degrees(ang) + (90 if not flip else -90)
        gx = ((x0 + x1) / 2) * scale
        gy = ((y0 + y1) / 2) * scale
        parts.append(
            f'<g transform="translate({px:.2f} {py:.2f}) rotate({rot:.2f}) '
            f'translate({-gx:.2f} {-gy:.2f}) scale({scale:.5f})" fill="{fill}">'
            f'<path d="{d}"/></g>'
        )
        walked += w + gap
    return "\n".join(parts)


def lockup(ink: str, oxblood: str, bg: str | None) -> str:
    font = load_font()
    size = 520.0
    cx = cy = size / 2
    bg_el = f'<rect width="100%" height="100%" fill="{bg}"/>' if bg else ""
    # Heavy inked rings — like a well-inked rubber stamp
    rings = (
        f'<circle cx="{cx}" cy="{cy}" r="236" fill="none" stroke="{ink}" '
        f'stroke-width="14"/>'
        f'<circle cx="{cx}" cy="{cy}" r="214" fill="none" stroke="{ink}" '
        f'stroke-width="3.5"/>'
    )
    inner_r = 148.0
    inner_ring = (
        f'<circle cx="{cx}" cy="{cy}" r="{inner_r:.0f}" fill="none" '
        f'stroke="{oxblood}" stroke-width="2.2"/>'
    )
    nixon = place_arc(font, "NIXON", cx, cy, 182, 208, 332, 42, ink, flip=False)
    made = place_arc(font, "MADE", cx, cy, 182, 152, 28, 42, oxblood, flip=True)
    # Side ticks between the two words, like a dated office stamp
    ticks = []
    for deg in (180, 0):
        a = math.radians(deg)
        x1 = cx + 164 * math.cos(a)
        y1 = cy + 164 * math.sin(a)
        x2 = cx + 200 * math.cos(a)
        y2 = cy + 200 * math.sin(a)
        ticks.append(
            f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" '
            f'stroke="{ink}" stroke-width="3.5" stroke-linecap="square"/>'
        )
    mark = star(cx, cy, inner_r, oxblood)
    inner = f"{bg_el}{rings}\n{nixon}\n{made}\n{''.join(ticks)}\n{mark}\n{inner_ring}"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size:.0f} {size:.0f}" '
        f'fill="none" role="img" aria-label="Nixon Made">\n{inner}\n</svg>\n'
    )


def write(name: str, svg: str):
    path = OUT / name
    path.write_text(svg)
    print("wrote", path, path.stat().st_size)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    write("press-stamp.svg", lockup(INK, OXBLOOD, None))
    write("press-stamp-ink.svg", lockup(INK, INK, None))
    write("press-stamp-on-paper.svg", lockup(INK, OXBLOOD, PAPER))
    write("press-stamp-inverse.svg", lockup(PAPER, PAPER, None))
    write("press-stamp-on-ink.svg", lockup(PAPER, PAPER, INK))


if __name__ == "__main__":
    main()
