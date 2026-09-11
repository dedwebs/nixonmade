#!/usr/bin/env python3
"""Nixon Made baseball lockup: interlocking NM, NIXON over MADE."""

from __future__ import annotations

from pathlib import Path

from fontTools.misc.transform import Transform
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

FONT = Path("/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf")
OUT = Path(__file__).resolve().parents[1] / "public" / "brand"

INK = "#1c1612"
PAPER = "#f3eee4"
OXBLOOD = "#8f2d21"


def glyph_path(font, ch: str) -> tuple[str, float, float, float, float]:
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    name = cmap[ord(ch)]
    g = gs[name]
    pen = SVGPathPen(gs)
    tpen = TransformPen(pen, Transform(1, 0, 0, -1, 0, 0))
    g.draw(tpen)
    from fontTools.pens.boundsPen import BoundsPen

    bpen = BoundsPen(gs)
    tpenb = TransformPen(bpen, Transform(1, 0, 0, -1, 0, 0))
    g.draw(tpenb)
    x0, y0, x1, y1 = bpen.bounds
    return pen.getCommands(), x0, y0, x1, y1


def place_word(font, text: str, cx: float, baseline: float, height: float, fill: str) -> str:
    """Center a word at (cx, baseline) scaled so cap height ~= height."""
    glyphs = [glyph_path(font, ch) for ch in text]
    raw_h = max(g[4] - g[2] for g in glyphs)
    scale = height / raw_h
    gap = height * 0.22
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


def monogram(ink: str, oxblood: str, outline: str | None, ox: float, oy: float, s: float) -> str:
    """Varsity interlocking N (ink, back) and M (oxblood, front)."""
    stroke = ""
    if outline:
        stroke = (
            f' stroke="{outline}" stroke-width="4" stroke-linejoin="miter" '
            f'paint-order="stroke fill"'
        )

    def p(d: str, fill: str) -> str:
        return f'<path d="{d}" fill="{fill}"{stroke}/>'

    # N: left stem, downward diagonal, right stem (same height).
    n_left = "M8 8 H60 V192 H8 Z"
    n_diag = "M60 8 L168 148 V192 L60 52 Z"
    n_right = "M168 8 H220 V192 H168 Z"
    # M slides further onto the N so the shared stem reads as one bar.
    m_left = "M132 8 H188 V192 H132 Z"
    m_mid = (
        "M188 8 L230 100 L272 8 H320 V56 L252 192 H212 L188 56 Z"
    )
    m_right = "M320 8 H372 V192 H320 Z"
    return (
        f'<g transform="translate({ox:.1f} {oy:.1f}) scale({s:.4f})">'
        f"{p(n_left, ink)}{p(n_diag, ink)}{p(n_right, ink)}"
        f"{p(m_left, oxblood)}{p(m_mid, oxblood)}{p(m_right, oxblood)}"
        f"</g>"
    )


def lockup(
    nixon_fill: str,
    made_fill: str,
    n_fill: str,
    m_fill: str,
    bg: str | None,
    outline: str | None,
    ring: str,
    ring_inner: str,
) -> str:
    font = TTFont(FONT)
    w, h = 440.0, 500.0
    cx, cy, r = 220.0, 248.0, 168.0
    bg_el = f'<rect width="100%" height="100%" fill="{bg}"/>' if bg else ""
    rings = (
        f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{ring}" '
        f'stroke-width="8"/>\n'
        f'<circle cx="{cx}" cy="{cy}" r="{r - 14}" fill="none" stroke="{ring_inner}" '
        f'stroke-width="3"/>'
    )
    nixon = place_word(font, "NIXON", cx, 58, 58, nixon_fill)
    made = place_word(font, "MADE", cx, 478, 58, made_fill)
    # Local monogram is 372 x 200; scale to sit inside the inner ring.
    mark = monogram(n_fill, m_fill, outline, 56, 168, 0.88)
    inner = f"{bg_el}{nixon}\n{rings}\n{mark}\n{made}"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" '
        f'fill="none" role="img" aria-label="Nixon Made">\n{inner}\n</svg>\n'
    )


def write(name: str, svg: str):
    path = OUT / name
    path.write_text(svg)
    print("wrote", path, path.stat().st_size)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    write("stacked.svg", lockup(INK, OXBLOOD, INK, OXBLOOD, None, None, INK, OXBLOOD))
    write("stacked-ink.svg", lockup(INK, INK, INK, INK, None, None, INK, INK))
    write("stacked-on-paper.svg", lockup(INK, OXBLOOD, INK, OXBLOOD, PAPER, None, INK, OXBLOOD))
    write("stacked-inverse.svg", lockup(PAPER, PAPER, PAPER, PAPER, None, None, PAPER, PAPER))
    write("stacked-on-ink.svg", lockup(PAPER, PAPER, PAPER, PAPER, INK, None, PAPER, PAPER))


if __name__ == "__main__":
    main()
