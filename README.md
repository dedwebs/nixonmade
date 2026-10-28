# Nixon Made

Company site for [nixonmade.com](https://nixonmade.com).

Wordmarks live in `public/brand/`.

```bash
npm install
npm run dev      # local
npm run deploy   # Cloudflare Workers + custom domain
npm test         # vitest, Stripe mocked
python3 scripts/build_marks.py   # regenerate marks (needs Fraunces ttf)
```

`npm test` prints two warnings from the test runner's older Wrangler. They do not fail the suite. The Wrangler version in this repo accepts `observability.redact_query_string`.

## Verified downloads

Field Kit, Ship Kit, and Fleet Sheets are delivered from a private R2 bucket after Stripe confirms the Checkout Session. The bucket is never public. A buyer gets a file link that lasts 15 minutes, and each purchase can be downloaded 5 times.

Fleet Sheets does not have a storefront page in this repo yet. Once its Payment Link ids and its R2 object are set, the same `/thanks` page delivers it.

### Payment Links (do this in Stripe, not in this repo)

This repo cannot change Payment Links. In the Stripe Dashboard, each Payment Link for these products must redirect after payment to:

```text
https://nixonmade.com/thanks?session_id={CHECKOUT_SESSION_ID}
```

Keep the braces. Stripe replaces `{CHECKOUT_SESSION_ID}`. Do not rename the parameter. Do not point the link at a different site. Test-mode links and live-mode links each need that redirect.

The old pages `/field-kit/thanks/` and `/ship-kit/thanks/` still work. If a buyer lands on one of them with a real `session_id`, the worker sends them to `/thanks` on this site only. Anything that is not a checkout session id stays on the old page. There is no redirect to another host.

### What you create in Cloudflare

Workers Paid is required, because the download counter is a Durable Object. The Free plan cannot run Durable Objects. The $5 monthly Workers subscription covers a shop of this size. A handful of purchases will not add a usage bill. See [Cost](#cost) below.

```bash
npx wrangler r2 bucket create nixonmade-downloads
npx wrangler secret put STRIPE_RESTRICTED_KEY
npx wrangler secret put DOWNLOAD_SIGNING_SECRET
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

Leave the R2 bucket private. Do not turn on the r2.dev public URL and do not add a public custom domain to the bucket.

`wrangler kv namespace create` is not part of setup. KV cannot add to a counter safely: two downloads can both read "4" and both write "5", and the cap of 5 becomes 6. The `PurchaseGate` Durable Object does the read, the check, and the write in one SQLite transaction (`storage.transactionSync`), so those two downloads cannot both pass. The class is created by the migration in `wrangler.jsonc` the next time the worker is deployed. There is no separate create command.

Generate the signing secret with `openssl rand -hex 32`. It must be at least 32 characters. The worker rejects a normal Stripe secret key (`sk_`). It accepts only a restricted key (`rk_test_` or `rk_live_`).

### Stripe restricted key

Create the key in Stripe → Developers → API keys → Restricted keys.

- Checkout Sessions: **Read**
- Nothing else. The key is not used to refund, to list customers, or to search email addresses.

Refunds are not visible on a Checkout Session. `payment_status` stays `paid` after a refund. A signed webhook (`charge.refunded`, `refund.created`, `refund.updated`) records the Payment Intent, and the worker stops downloads for it. Any successful refund, including a partial one, blocks further downloads. A failed or canceled refund does not. The block stays until you clear it; Stripe does not really undo a refund.

Add the endpoint in Stripe → Developers → Webhooks:

```text
https://nixonmade.com/api/stripe/webhook
```

Events: `charge.refunded`, `refund.created`, `refund.updated`. Put that endpoint's signing secret in `STRIPE_WEBHOOK_SECRET`. Use the test-mode endpoint's secret in `.dev.vars` and the live-mode secret in production. For local testing, the Stripe CLI is free: `stripe listen --forward-to localhost:8787/api/stripe/webhook`, and use the `whsec_` it prints.

Production must use the **live** restricted key. A test-mode payment only verifies against a worker that has the **test** restricted key (`wrangler dev` and `.dev.vars`).

### Environment

Secrets (never in `wrangler.jsonc`, never in the browser):

| Name | Where |
| --- | --- |
| `STRIPE_RESTRICTED_KEY` | `wrangler secret put` and `.dev.vars` |
| `DOWNLOAD_SIGNING_SECRET` | `wrangler secret put` and `.dev.vars` |
| `STRIPE_WEBHOOK_SECRET` | `wrangler secret put` and `.dev.vars` |

Copy `.dev.vars.example` to `.dev.vars` for local dev. `.dev.vars` is gitignored.

Vars in `wrangler.jsonc` (not secrets). Empty link and price lists fail closed: a paid session for an unknown id does not get a file.

| Name | Meaning |
| --- | --- |
| `DOWNLOAD_LIMIT` | Successful file transfers per checkout session. Default 5. |
| `DOWNLOAD_TTL_SECONDS` | Life of a file button. Default 900 (15 minutes). |
| `RATE_LIMIT_IP_PER_MINUTE` | Requests per connection. Default 60. Uses `CF-Connecting-IP` only. |
| `RATE_LIMIT_SESSION_PER_MINUTE` | Requests per paid session. Default 20. |
| `PRODUCT_FIELD_KIT_TEST_LINKS` / `PRODUCT_FIELD_KIT_TEST_PRICES` | Comma-separated `plink_` and `price_` ids for test mode. |
| `PRODUCT_FIELD_KIT_LIVE_LINKS` / `PRODUCT_FIELD_KIT_LIVE_PRICES` | The same, for live mode. |
| `PRODUCT_FIELD_KIT_KEY` | Private R2 object key. Default `products/field-kit.zip`. Upload the file later. |
| `PRODUCT_FIELD_KIT_FILENAME` | Name the browser saves. Default `nixonmade-field-kit.zip`. |
| `PRODUCT_FIELD_KIT_TITLE` | Title on the download page. |
| `PRODUCT_SHIP_KIT_*` | Same shape. Put both the $49 kit and the $299 done-for-you ids here if both should deliver the same zip. |
| `PRODUCT_FLEET_SHEETS_*` | Same shape. |

A session matches a product only when its Payment Link id or a line-item price id is on that product's list for the session's own mode. A test id never unlocks a live session. If the link says Field Kit and the price says Ship Kit, nobody gets a file.

Upload the objects when the files exist. Local `wrangler dev` uses a local bucket; add `--local` for that. Omit `--local` to upload to the real private bucket.

```bash
npx wrangler r2 object put nixonmade-downloads/products/field-kit.zip --file=./field-kit.zip --local
npx wrangler r2 object put nixonmade-downloads/products/ship-kit.zip --file=./ship-kit.zip --local
npx wrangler r2 object put nixonmade-downloads/products/fleet-sheets.zip --file=./fleet-sheets.zip --local
```

The object keys above are the defaults. If you change `PRODUCT_*_KEY`, upload to that key instead.

### Routes

- `GET /thanks?session_id=cs_...` confirms the payment and shows the button.
- `GET /api/download?session_id=cs_...` returns the same decision as JSON: a path under `/api/file`, the expiry, and how many downloads are left.
- `GET /api/file?t=...` checks the signature, checks Stripe and the refund flag again, then streams the object. The signature is an HMAC-SHA256 compared with a fixed-length XOR loop.
- `GET /redownload` and `POST /redownload` take a checkout session id, or a `nixonmade.com` URL that contains one, and send the browser to `/thanks`.
- `POST /api/stripe/webhook` records refunds.

Responses from these routes set `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and a Content-Security-Policy with `script-src 'none'`. The new pages do not load third-party fonts or scripts. `wrangler.jsonc` turns on Workers observability with `redact_query_string` and `logs.persist` set to false, so a tail drops the query string and logs are not stored as a separate product. The worker's own logs are short reason codes. They do not include the session id.

A second click on the same button within 30 seconds is treated as a retry and does not use another download. Loading `/thanks` again mints a new button. The bookmarked page is the long-lived link. The button is not.

### Re-download, and why there is no email box

The safe option is the checkout session id. It is a long random value Stripe puts in the success URL. Someone who does not have it cannot guess it.

An email form that says "we found your purchase" or "we didn't" tells a stranger which addresses have bought something. An email form that always says the same sentence and then sends a link does not leak that, but it needs an email provider (Resend, Postmark, and the like charge for mail). This shop does not send that mail. No email provider was added.

`/redownload` does not ask for an email. Pasting someone else's address does not say whether they are a customer. If a buyer loses the session id, they email hello@nixonmade.com from the address they paid with and include the Stripe receipt. You look the payment up in the Stripe Dashboard and send them the `/thanks?session_id=cs_...` address. That is a manual step, and it costs nothing.

Stripe's own receipt does not include our download page unless you add a sentence in the Payment Link's after-payment message. Suggested sentence: "Your download stays on the page that opened after payment. Bookmark it."

### TEST checklist

Do this against `npm run dev` with a **test** restricted key in `.dev.vars`, the test Payment Link ids filled in, and a small zip uploaded with `--local`. Use card `4242 4242 4242 4242`. Do not use a live key.

1. **Buy.** Open the test Payment Link. After payment you should land on `/thanks?session_id=cs_test_...`. The page names the product and shows a download button. Bookmark the page.
2. **Download.** The button saves the zip. `SESSION_ID=cs_test_... npm run e2e:download` checks the same path and checks that a damaged link is rejected.
3. **Expired link.** Wait 15 minutes, then use the old button. It should fail. Refresh the bookmarked `/thanks` page. A new button should work, and it should not have used an extra download if you never successfully fetched the old one.
4. **Download limit.** From the bookmarked page, download, then refresh so you get a new button, and repeat until you have done it 5 times. Leave at least 30 seconds between two clicks on the *same* button, or just refresh each time. The sixth page should say the 5 downloads are used.
5. **Re-download.** Open `/redownload`, paste the `cs_test_...` id (or the whole thanks URL), and confirm you land on the download page. The form has no email field. Two made-up email addresses get the same reply.
6. **Refund.** In the Stripe test dashboard, refund the payment. With `stripe listen` forwarding to the local webhook, reload `/thanks`. It should say the purchase could not be opened, the same as a bad link. Or simulate just the worker with `SESSION_ID=... PAYMENT_INTENT=pi_... STRIPE_WEBHOOK_SECRET=... npm run e2e:download -- --simulate-refund`. A real dashboard refund is the one that proves Stripe is reaching the webhook.

`npm test` runs the same cases with Stripe mocked. It does not need a key.

### Cost

- **Workers Paid, $5/month.** Required for the Durable Object. Included usage covers this shop.
- **Durable Objects.** A few storage operations per download. Not a separate monthly fee beyond Workers Paid at this volume.
- **R2.** The private bucket has a free tier (about 10 GB stored, and generous read/write operations). Egress from R2 to the Worker is free. A zip for three products stays inside the free tier.
- **KV.** Not used. Do not create a namespace for this.
- **Workers Rate Limiting.** Not used. The same Durable Object enforces the per-IP and per-session limits, so there is no second product to turn on.
- **Stripe.** Reading a Checkout Session and receiving webhooks is included with Stripe. No extra Stripe product.
- **Email.** Not used. No Resend, Postmark, Mailchannels, or similar bill. Lost links are answered by hand from hello@nixonmade.com.
- **Stripe CLI.** Free, and only needed on your machine if you want to forward test webhooks to `wrangler dev`.
