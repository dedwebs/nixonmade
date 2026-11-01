# Wordmark options

The live header still uses `public/brand/press-stamp.svg`. These three files are candidates. They are not swapped into the header.

| Option | File | Mark |
| --- | --- | --- |
| 1 | `option-1-monogram.svg` | NM monogram |
| 2 | `option-2-wordmark.svg` | NixonMade wordmark |
| 3 | `option-3-n.svg` | N monogram |

Review them at `/brand-options/` on a light background, a dark background, at header size, and at 16px and 32px.

## Regenerate favicons and social images

Favicons and the 1200×630 Open Graph images are generated from option 1. After a mark is chosen:

```bash
python3 scripts/brand_assets.py --option 1
```

Use `--option 2` or `--option 3` to rebuild from that file instead. The script rewrites:

- `public/brand/options/option-*.svg`
- `public/favicon.svg` (copy of the chosen option)
- `public/favicon.ico`, `public/favicon-16.png`, `public/favicon-32.png`
- `public/apple-touch-icon.png`
- `public/og/<page>.png` for each page listed in `scripts/brand_assets.py`

It does not modify `public/brand/press-stamp.svg`.

The script needs Pillow, fontTools, and the Inter fonts installed on the machine (`Inter-Regular.ttf`, `Inter-SemiBold.ttf`, `Inter-Bold.ttf`).

## Product screenshots

Field Kit and Fleet Sheets use the owner's sample-data screenshots in `public/img/field-kit/` and `public/img/fleet-sheets/`. Each shot is a `picture` with AVIF and WebP at 640, 960, and 1440, plus a PNG fallback at 640 and 960. The Fleet Sheets summary crop stops above the workbook footer so the 0.1.0 line is not shown.

Ship Kit and relnotes still have no product screenshots. Do not draw stand-ins. When a real file exists, add a `figure.figure-slot` with width, height, and `loading="lazy"` if it sits below the hero.
