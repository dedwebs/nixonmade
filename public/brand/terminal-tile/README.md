# Terminal Tile (blue)

NixonMade mark: a `>nm_` shell prompt on a dark tile, matching the site palette.

| File | Use |
|---|---|
| `tile.svg` | App-style tile, 64px and up (avatars, social, app icons) |
| `favicon.svg` | 16–32px; simplified to `>n_` so it stays legible and distinct from Apple's Terminal `>_` |
| `horizontal-light.svg` | Tile + wordmark on the light site background |
| `horizontal-dark.svg` | Tile + wordmark on ink |

Colours: tile `#0b1220` (site ink), prompt and cursor `#3b82f6` (site blue lightened for contrast on ink), letters `#f5f7fa`; wordmark "Made" uses site accent `#1d4ed8` on light, `#3b82f6` on dark.

No traffic lights: they mimic macOS window controls and vanish below ~64px. The cursor is a short block on the baseline so it doesn't read as a letter.

The wordmark is live Inter text (weight 600). Convert it to outlines before sending files to print or to anyone without Inter.
