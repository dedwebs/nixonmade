# NixonMade monogram

The live mark is the badge: an interlocking N and M inside a ring. The file is `nm-03-badge.svg`, restored as drawn. The N sits in front of the M, and a gap keeps the two letters separate. It is the header and the favicon.

The serif lockups stay in this folder as alternates. They are not in the header.

| Mark | File | Role |
| --- | --- | --- |
| Badge | `nm-03-badge.svg` | Live header and favicon. |
| Roman weave | `nm-01-roman-weave.svg` | Alternate. Upright serif, with the M passing back across the N and a swash on the right foot. |
| Italic swash | `nm-02-italic-swash.svg` | Alternate. Italic serif with an entry swash. |
| N in front | `nm-03-n-in-front.svg` | Alternate. Tighter serif overlap, N entirely in front. |

Each `.png` is ink (`#1a1714`) on paper (`#f6f3ec`). Each `-ink.png` is paper on ink.

The badge SVG in this folder uses `currentColor`. The copies the site serves, `public/brand/nm-mark.svg` and `public/favicon.svg`, are the same drawing with the fill and the ring set to `#1a1714`, because an `<img>` does not inherit `currentColor`.

## Swap back to an alternate

1. Copy the chosen SVG over `public/brand/nm-mark.svg` and `public/favicon.svg`.
2. Set the fill and the ring stroke to `#1a1714`.
3. Rebuild the raster favicons:
   - `public/favicon-32.png` and `public/apple-touch-icon.png` (180×180) from the SVG as drawn, on a paper background.
   - `public/favicon-16.png` from the same drawing with the ring stroke raised from 4 to 10, so the circle is still there at 16px. The letters are unchanged.
   - `public/favicon.ico` holds the 16 and 32 pixel files.

The header box is 36×36 and uses `object-fit: contain`. The word “NixonMade” sits beside the mark.

`public/brand/press-stamp.svg` is an older header. It is not deleted.
