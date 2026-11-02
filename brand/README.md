# NixonMade monogram

Three original interlocking N and M marks. The letters lock the way a sports monogram does: one letter sits in front of the other, and a gap keeps both readable. They are not a New York Yankees mark, and they do not use that club’s letterforms, serifs, or baseball.

Variation 1 is the live header and the favicon.

| Variation | File | What it is |
| --- | --- | --- |
| 1. Front N | `nm-01-front-n.svg` | The N is in front. Its diagonal crosses the M, with a gap so both letters stay readable. This is the header and favicon. |
| 2. Ligature | `nm-02-ligature.svg` | The N and the M share the center stem. Quieter, and a little wider. |
| 3. Badge | `nm-03-badge.svg` | Variation 1 inside a plain ring, for an avatar or a stamp. |

Each `.png` is the mark in ink (`#1a1714`) on paper (`#f6f3ec`). Each `-ink.png` is the same mark in paper on ink.

## Swap the live mark

1. Copy the chosen SVG over both of these files:
   - `public/brand/nm-mark.svg` (the header)
   - `public/favicon.svg`
2. Set the fill to `#1a1714`. An `<img>` does not inherit `currentColor`, so a `currentColor` fill renders black.
3. The header box is 36×36 and uses `object-fit: contain`, so a wide mark stays in proportion. The files in `public/` right now are variation 1 centered in a square viewBox, which keeps the letters large at favicon size.
4. Replace the raster favicons so tabs and home screens match:
   - `public/favicon-16.png`
   - `public/favicon-32.png`
   - `public/favicon.ico` (16 and 32)
   - `public/apple-touch-icon.png` (180×180, paper background, mark centered)

The header image is 36×36. The word “NixonMade” sits beside it in the header, so the mark does not have to carry the name alone.

`public/brand/press-stamp.svg` is the previous header. It is not deleted. The older wordmarks in `public/brand/options/` are not the live logo.
