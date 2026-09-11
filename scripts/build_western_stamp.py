#!/usr/bin/env python3
"""Nixon Made as an old Western / all-American postage stamp."""

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
    TransformPen(bpen, Transform(1, 0, 0, -1, 0, 0))
    # bounds in font space then flip
    bpen2 = BoundsPen(gs)
    tpenb = TransformPen(bpen2, Transform(1, 0, 0, -1, 0, 0))
    g.draw(tpenb)
    x0, y0, x1, y1 = bpen2.bounds
    return pen.getCommands(), x0, y0, x1, y1


def place_word(font, text: str, cx: float, baseline: float, height: float, fill: str, tracking: float = 0.18) -> str:
    glyphs = [glyph_path(font, ch) for ch in text]
    raw_h = max(g[4] - g[2] for g in glyphs)
    scale = height / raw_h
    gap = height * tracking
    widths = [(g[3] - g[1]) * scale for g in glyphs]
    total = sum(widths) + gap * (len(text) - 1)
    x = cx - total / 2
    parts = []
    for (d, x0, y0, x1, y1), w in zip(glyphs, widths):
        tx = x - x0 * scale
        ty = baseline - y1 * scale
        parts.append(
            f'<g transform="translate({tx:.2f} {ty:.2f}) scale({scale:.5f})" fill="{fill}">'
            f'<path d="{d}"/></g>'
        )
        x += w + gap
    return "\n".join(parts)


def star(cx: float, cy: float, r: float, fill: str) -> str:
    ri = r * 0.38
    pts = []
    for i in range(10):
        ang = math.radians(-90 + i * 36)
        rad = r if i % 2 == 0 else ri
        pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
    d = "M " + " L ".join(f"{x:.2f} {y:.2f}" for x, y in pts) + " Z"
    return f'<path d="{d}" fill="{fill}"/>'


def scalloped_rect(x, y, w, h, hole=7.0, count_x=16, count_y=20) -> str:
    """Postage-stamp outline: rectangle with outward half-round perforations."""
    # Inset so scallops sit on the outer edge.
    pts: list[str] = []

    def arc_out(cx, cy, start_deg, sweep_deg):
        # SVG arc from current point; we emit as A commands from computed start.
        return cx, cy, start_deg, sweep_deg

    # Build a polyline+arcs path, clockwise, starting top-left after first hole.
    step_x = w / count_x
    step_y = h / count_y
    commands = [f"M {x:.2f} {y:.2f}"]

    # Top edge: left to right, scallops upward
    for i in range(count_x):
        mx = x + (i + 0.5) * step_x
        commands.append(f"L {mx - hole:.2f} {y:.2f}")
        commands.append(
            f"A {hole:.2f} {hole:.2f} 0 0 1 {mx + hole:.2f} {y:.2f}"
        )
    commands.append(f"L {x + w:.2f} {y:.2f}")

    # Right edge: top to bottom, scallops right
    for i in range(count_y):
        my = y + (i + 0.5) * step_y
        commands.append(f"L {x + w:.2f} {my - hole:.2f}")
        commands.append(
            f"A {hole:.2f} {hole:.2f} 0 0 1 {x + w:.2f} {my + hole:.2f}"
        )
    commands.append(f"L {x + w:.2f} {y + h:.2f}")

    # Bottom edge: right to left, scallops down
    for i in range(count_x):
        mx = x + w - (i + 0.5) * step_x
        commands.append(f"L {mx + hole:.2f} {y + h:.2f}")
        commands.append(
            f"A {hole:.2f} {hole:.2f} 0 0 1 {mx - hole:.2f} {y + h:.2f}"
        )
    commands.append(f"L {x:.2f} {y + h:.2f}")

    # Left edge: bottom to top, scallops left
    for i in range(count_y):
        my = y + h - (i + 0.5) * step_y
        commands.append(f"L {x:.2f} {my + hole:.2f}")
        commands.append(
            f"A {hole:.2f} {hole:.2f} 0 0 1 {x:.2f} {my - hole:.2f}"
        )
    commands.append(f"L {x:.2f} {y:.2f}")
    commands.append("Z")
    return " ".join(commands)


def flourish(cx: float, cy: float, w: float, fill: str) -> str:
    """Small western bracket, left and right of a center point."""
    left = (
        f"M {cx - w:.2f} {cy - 6:.2f} "
        f"C {cx - w + 8:.2f} {cy - 10:.2f}, {cx - 18:.2f} {cy - 2:.2f}, {cx - 12:.2f} {cy:.2f} "
        f"C {cx - 18:.2f} {cy + 2:.2f}, {cx - w + 8:.2f} {cy + 10:.2f}, {cx - w:.2f} {cy + 6:.2f}"
    )
    right = (
        f"M {cx + w:.2f} {cy - 6:.2f} "
        f"C {cx + w - 8:.2f} {cy - 10:.2f}, {cx + 18:.2f} {cy - 2:.2f}, {cx + 12:.2f} {cy:.2f} "
        f"C {cx + 18:.2f} {cy + 2:.2f}, {cx + w - 8:.2f} {cy + 10:.2f}, {cx + w:.2f} {cy + 6:.2f}"
    )
    return (
        f'<path d="{left}" fill="none" stroke="{fill}" stroke-width="1.6"/>'
        f'<path d="{right}" fill="none" stroke="{fill}" stroke-width="1.6"/>'
    )


def lockup(ink: str, oxblood: str, bg: str | None) -> str:
    font = load_font()
    vw, vh = 460.0, 560.0
    pad = 28.0
    sx, sy, sw, sh = pad, pad, vw - pad * 2, vh - pad * 2
    scallop = scalloped_rect(sx, sy, sw, sh, hole=6.2, count_x=14, count_y=18)
    inset = 22
    inner_x, inner_y = sx + inset, sy + inset
    inner_w, inner_h = sw - inset * 2, sh - inset * 2
    bg_el = f'<rect width="100%" height="100%" fill="{bg}"/>' if bg else ""
    cx = vw / 2
    nixon = place_word(font, "NIXON", cx, 228, 58, ink, tracking=0.14)
    made = place_word(font, "MADE", cx, 400, 58, oxblood, tracking=0.2)
    mark = star(cx, 300, 20, oxblood)
    rules = (
        f'<rect x="{inner_x:.2f}" y="{inner_y:.2f}" width="{inner_w:.2f}" '
        f'height="{inner_h:.2f}" fill="none" stroke="{ink}" stroke-width="2.4"/>'
        f'<rect x="{inner_x + 7:.2f}" y="{inner_y + 7:.2f}" width="{inner_w - 14:.2f}" '
        f'height="{inner_h - 14:.2f}" fill="none" stroke="{oxblood}" stroke-width="1.1"/>'
    )
    inner = (
        f"{bg_el}"
        f'<path d="{scallop}" fill="none" stroke="{ink}" stroke-width="2.2"/>\n'
        f"{rules}\n"
        f"{nixon}\n"
        f"{flourish(cx, 300, 86, ink)}\n"
        f"{mark}\n"
        f"{made}"
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vw:.0f} {vh:.0f}" '
        f'fill="none" role="img" aria-label="Nixon Made">\n{inner}\n</svg>\n'
    )


def write(name: str, svg: str):
    path = OUT / name
    path.write_text(svg)
    print("wrote", path, path.stat().st_size)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    write("stacked.svg", lockup(INK, OXBLOOD, None))
    write("stacked-ink.svg", lockup(INK, INK, None))
    write("stacked-on-paper.svg", lockup(INK, OXBLOOD, PAPER))
    write("stacked-inverse.svg", lockup(PAPER, PAPER, None))
    write("stacked-on-ink.svg", lockup(PAPER, PAPER, INK))


if __name__ == "__main__":
    main()
