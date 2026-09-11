# Nixon Made

Company site for [nixonmade.com](https://nixonmade.com). Tees and software in one shop.

Wordmarks live in `public/brand/` (outlined SVGs for print and merch). Tee SKUs and print notes: `docs/MERCH.md`.

```bash
npm install
npm run dev      # local
npm run deploy   # Cloudflare Workers + custom domain
python3 scripts/build_marks.py   # regenerate marks (needs Fraunces ttf)
```
