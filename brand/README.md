# NixonMade monogram

Three original interlocking N and M marks. The letters are a bold serif: flared terminals, thick stems, and a thinner diagonal. They overlap, and a gap follows the stroke that sits in front so you can see which stroke passes over the other. Variation 1 also lets the M pass back across the N, and it ends in a tapering swash. Variation 2 is the italic, with an entry swash. They are not a New York Yankees mark and they do not use that club’s drawing.

Variation 1 is the live header and the favicon.

| Variation | File | What it is |
| --- | --- | --- |
| 1. Roman weave | `nm-01-roman-weave.svg` | Upright serif. The N crosses in front of the M, then the M’s leg passes back across the diagonal. A swash leaves the right foot. This is the header and favicon. |
| 2. Italic swash | `nm-02-italic-swash.svg` | Italic serif, with an entry swash on the N and the same over-under crossing. |
| 3. N in front | `nm-03-n-in-front.svg` | Tighter overlap. The whole N sits in front, and the gap follows every crossing. No extra swash, so it stays quieter at small sizes. |

Each `.png` is the mark in ink (`#1a1714`) on paper (`#f6f3ec`). Each `-ink.png` is the same mark in paper on ink.

## Swap the live mark

1. Copy the chosen SVG over both of these files:
   - `public/brand/nm-mark.svg` (the header)
   - `public/favicon.svg`
2. The header box is 36×36 and uses `object-fit: contain`. The live files center variation 1 in a square viewBox so the letters stay large at favicon size. If you paste a wide SVG in directly, keep the fill `#1a1714`.
3. Replace the raster favicons so tabs and home screens match:
   - `public/favicon-16.png`
   - `public/favicon-32.png`
   - `public/favicon.ico` (16 and 32)
   - `public/apple-touch-icon.png` (180×180, paper background, mark centered)

The word “NixonMade” sits beside the mark in the header.

`public/brand/press-stamp.svg` is the previous header. It is not deleted.
