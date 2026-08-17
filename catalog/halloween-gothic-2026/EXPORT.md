# Export print sizes

After ids are `approve` in `queue.md`:

```bash
python3 scripts/export-print-sizes.py --id 01
python3 scripts/export-print-sizes.py --set moon-garden
```

Needs macOS `sips` (already there) or ImageMagick `magick`. Output is gitignored under `catalog/halloween-gothic-2026/export/`.

Sources are generated posters, not 300dpi scans — we resize to common print pixel sizes. Say that in the listing if asked.
