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

## Figure slots

Product screenshots are not in the repo. Pages look for these files and show them only after they load. Until then, no image box is rendered.

| File | Alt text |
| --- | --- |
| `public/img/field-kit/profiles.webp` | Three PPPC privacy profile templates from the NixonMade Field Kit. |
| `public/img/field-kit/scripts.webp` | Five read-only extension attribute scripts from the NixonMade Field Kit. |
| `public/img/ship-kit/contents.webp` | The Ship Kit file list, including the Mac gate script, archive script, and RUNBOOK. |
| `public/img/fleet-sheets/workbook.webp` | A Fleet Sheets Excel workbook with a summary dashboard, tables, charts, and pivot tables. |
| `public/img/relnotes/changelog.webp` | A relnotes changelog grouped into features, fixes, and maintenance. |

Drop the real screenshot in place. Do not draw a fake product interface.

When the file exists, add it to the product page. `public/styles.css` scales it to the column. There is no empty frame before that.

```html
<figure class="figure-slot">
  <img src="/img/field-kit/profiles.webp" alt="Three PPPC privacy profile templates from the NixonMade Field Kit." />
</figure>
```

Use the alt text from the table above. `public/figure-slots.js` can load a `data-src` image and remove the figure if the file 404s. The live pages do not use it yet, so a missing file never becomes a broken box or a console error.
