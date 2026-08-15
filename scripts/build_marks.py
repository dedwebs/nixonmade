#!/usr/bin/env python3
"""Outline Nixon Made wordmarks for web + merch (single-color, no live text)."""

from __future__ import annotations

from pathlib import Path

from fontTools.misc.transform import Transform
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

FONT = Path("/tmp/fraunces/Fraunces.ttf")
OUT = Path(__file__).resolve().parents[1] / "public" / "brand"

INK = "#1c1612"
PAPER = "#f3eee4"
OXBLOOD = "#8f2d21"

AXES = {"opsz": 144, "wght": 720, "SOFT": 0, "WONK": 1}


def load_font():
    return instantiateVariableFont(TTFont(FONT), AXES, overlap=True)


def glyph_advance(font, name: str) -> float:
    gs = font.getGlyphSet()
    return gs[name].width


def draw_text(font, text: str, tracking: float = 0.0):
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    x = 0.0
    d = font["head"].unitsPerEm
    parts = []
    minx = miny = 1e9
    maxx = maxy = -1e9
    for i, ch in enumerate(text):
        name = cmap[ord(ch)]
        g = gs[name]
        pen = SVGPathPen(gs)
        # Font space: y up. Flip into SVG.
        tpen = TransformPen(pen, Transform(1, 0, 0, -1, x, 0))
        g.draw(tpen)
        path = pen.getCommands()
        if path:
            parts.append(path)
        # bounds via recorded advance; refine with LSB/rsb later
        x += g.width
        if i != len(text) - 1:
            x += tracking
    width = x
    # Estimate height from cap: use H
    hname = cmap[ord("H")]
    # Use OS/2 sCapHeight if present
    cap = getattr(font["OS/2"], "sCapHeight", None) or int(d * 0.7)
    desc = abs(font["OS/2"].sTypoDescender) if "OS/2" in font else int(d * 0.2)
    minx, miny, maxx, maxy = 0, -cap, width, desc
    # Tighter: use actual path extents via font glyph stats
    return parts, width, cap, font["OS/2"].sTypoDescender


def path_for_string(font, text: str, tracking: float = 0.0):
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    x = 0.0
    commands = []
    for i, ch in enumerate(text):
        name = cmap[ord(ch)]
        g = gs[name]
        pen = SVGPathPen(gs)
        tpen = TransformPen(pen, Transform(1, 0, 0, -1, x, 0))
        g.draw(tpen)
        cmd = pen.getCommands()
        if cmd:
            commands.append(cmd)
        x += g.width
        if i != len(text) - 1:
            x += tracking
    return " ".join(commands), x


def bounds_for_path_commands(font, text: str, tracking: float = 0.0):
    """Return (minx, miny, maxx, maxy) in the flipped SVG space we draw into."""
    from fontTools.pens.boundsPen import BoundsPen

    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    x = 0.0
    minx = miny = 1e9
    maxx = maxy = -1e9
    for i, ch in enumerate(text):
        name = cmap[ord(ch)]
        g = gs[name]
        bpen = BoundsPen(gs)
        tpen = TransformPen(bpen, Transform(1, 0, 0, -1, x, 0))
        g.draw(tpen)
        if bpen.bounds:
            a, b, c, d = bpen.bounds
            minx = min(minx, a)
            miny = min(miny, b)
            maxx = max(maxx, c)
            maxy = max(maxy, d)
        x += g.width
        if i != len(text) - 1:
            x += tracking
    return minx, miny, maxx, maxy, x


def tracking_to_match(font, short: str, target_width: float) -> float:
    _, _, _, _, w = bounds_for_path_commands(font, short, 0)
    gaps = max(len(short) - 1, 1)
    extra = target_width - w
    return extra / gaps


def svg_wrap(view_w, view_h, inner: str, bg: str | None = None) -> str:
    bg_el = (
        f'<rect width="100%" height="100%" fill="{bg}"/>' if bg else ""
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {view_w:.2f} {view_h:.2f}" '
        f'fill="none" role="img" aria-label="Nixon Made">\n'
        f"{bg_el}"
        f"{inner}\n"
        f"</svg>\n"
    )


def stacked(font, fill_top: str, fill_bot: str, bg: str | None, pad: float):
    nixon, n_adv = path_for_string(font, "NIXON")
    nx0, ny0, nx1, ny1, _ = bounds_for_path_commands(font, "NIXON")
    n_w = nx1 - nx0
    track = tracking_to_match(font, "MADE", n_w)
    made, _ = path_for_string(font, "MADE", track)
    mx0, my0, mx1, my1, _ = bounds_for_path_commands(font, "MADE", track)

    gap = (ny1 - ny0) * 0.12
    # Place NIXON so its minx/miny sit at pad
    n_tx, n_ty = pad - nx0, pad - ny0
    m_tx = pad - mx0
    m_ty = pad + (ny1 - ny0) + gap - my0

    bottom = m_ty + my1
    width = pad * 2 + n_w
    height = bottom + pad

    inner = (
        f'<g transform="translate({n_tx:.2f} {n_ty:.2f})" fill="{fill_top}">'
        f'<path d="{nixon}"/></g>\n'
        f'<g transform="translate({m_tx:.2f} {m_ty:.2f})" fill="{fill_bot}">'
        f'<path d="{made}"/></g>'
    )
    return svg_wrap(width, height, inner, bg)


def horizontal(font, fill: str, bg: str | None, pad: float):
    path, _ = path_for_string(font, "Nixon Made")
    x0, y0, x1, y1, _ = bounds_for_path_commands(font, "Nixon Made")
    tx, ty = pad - x0, pad - y0
    width = (x1 - x0) + pad * 2
    height = (y1 - y0) + pad * 2
    inner = (
        f'<g transform="translate({tx:.2f} {ty:.2f})" fill="{fill}">'
        f'<path d="{path}"/></g>'
    )
    return svg_wrap(width, height, inner, bg)


def stamp(font, fill: str, bg: str | None):
    nixon, _ = path_for_string(font, "NIXON")
    nx0, ny0, nx1, ny1, _ = bounds_for_path_commands(font, "NIXON")
    n_w = nx1 - nx0
    n_h = ny1 - ny0
    track = tracking_to_match(font, "MADE", n_w)
    made, _ = path_for_string(font, "MADE", track)
    mx0, my0, mx1, my1, _ = bounds_for_path_commands(font, "MADE", track)
    m_h = my1 - my0
    gap = n_h * 0.1
    stack_h = n_h + gap + m_h
    stack_w = n_w
    margin = n_h * 0.55
    inner_w = stack_w + margin * 2
    inner_h = stack_h + margin * 2
    # rounded rect badge
    r = min(inner_w, inner_h) * 0.08
    stroke = n_h * 0.065
    pad = stroke * 3
    w = inner_w + pad * 2
    h = inner_h + pad * 2
    # word origin
    n_tx = pad + margin - nx0
    n_ty = pad + margin - ny0
    m_tx = pad + margin - mx0
    m_ty = pad + margin + n_h + gap - my0
    inner = (
        f'<rect x="{stroke:.2f}" y="{stroke:.2f}" width="{w - stroke * 2:.2f}" '
        f'height="{h - stroke * 2:.2f}" rx="{r:.2f}" ry="{r:.2f}" '
        f'stroke="{fill}" stroke-width="{stroke:.2f}" fill="none"/>\n'
        f'<g transform="translate({n_tx:.2f} {n_ty:.2f})" fill="{fill}">'
        f'<path d="{nixon}"/></g>\n'
        f'<g transform="translate({m_tx:.2f} {m_ty:.2f})" fill="{fill}">'
        f'<path d="{made}"/></g>'
    )
    return svg_wrap(w, h, inner, bg)


def write(name: str, svg: str):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    path.write_text(svg)
    print("wrote", path, f"({path.stat().st_size} bytes)")


def main():
    font = load_font()
    pad = 80
    # Site / light merch
    write("stacked.svg", stacked(font, INK, OXBLOOD, None, pad))
    write("stacked-ink.svg", stacked(font, INK, INK, None, pad))
    write("stacked-on-paper.svg", stacked(font, INK, OXBLOOD, PAPER, pad))
    # Dark merch (cream ink)
    write("stacked-inverse.svg", stacked(font, PAPER, PAPER, None, pad))
    write("stacked-on-ink.svg", stacked(font, PAPER, PAPER, INK, pad))
    write("horizontal-ink.svg", horizontal(font, INK, None, pad))
    write("horizontal-inverse.svg", horizontal(font, PAPER, None, pad))
    write("stamp-ink.svg", stamp(font, INK, None))
    write("stamp-inverse.svg", stamp(font, PAPER, None))
    write("stamp-on-paper.svg", stamp(font, INK, PAPER))
    write("stamp-on-ink.svg", stamp(font, PAPER, INK))


if __name__ == "__main__":
    main()
