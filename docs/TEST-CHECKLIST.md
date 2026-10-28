# Download test checklist

A plain-English checklist for testing paid downloads before going live. Use Stripe's **Sandbox** (test mode) and the card `4242 4242 4242 4242`, any future date, any CVC. Do not use a real card.

## 1. Set the after-payment redirect (once per Payment Link)

Right now the Payment Links leave buyers on Stripe's own thank-you page. That's expected until this step is done.

- [ ] In Stripe, switch to Sandbox, open **Payment Links**, and open the Field Kit link.
- [ ] Under **After payment**, choose **Don't show confirmation page** and redirect to:
      `https://nixonmade.com/thanks?session_id={CHECKOUT_SESSION_ID}`
      Type it exactly, including the curly braces.
- [ ] Repeat for Ship Kit and Fleet Sheets.
- [ ] Optional: add to the confirmation message: "Your download stays on the page that opened after payment. Bookmark it."
- [ ] While you're there, remove the `**` from the Field Kit product name.

## 2. Buy

- [ ] Open a test Payment Link and pay with the test card.
- [ ] You land on a nixonmade.com page that says "You're in." and names the right product.
- [ ] Bookmark that page. It's the long-lived link. The button on it is not.

## 3. Download

- [ ] Click the download button. Field Kit and Ship Kit save a `.zip`. Fleet Sheets saves `nixonmade-fleet-sheets.dmg`.
- [ ] The file opens.

## 4. Expired link

- [ ] Leave the page open for more than 15 minutes, then click the same button. It should fail.
- [ ] Reload the bookmarked page. A fresh button should work.

## 5. Download limit (5 per purchase)

- [ ] Download, reload the page, download again. Repeat until you've downloaded 5 times.
- [ ] Reload once more. The page should say the purchase has used its 5 downloads.
- [ ] Note: clicking the same button twice in a row counts once, so a browser retry doesn't waste a download.

## 6. Refund

- [ ] In Stripe Sandbox, refund one test payment (a partial refund counts too).
- [ ] Reload that purchase's bookmarked page. It should say "We couldn't open that purchase."
- [ ] The other test purchases still download.
- [ ] This needs the webhook endpoint set up in Stripe (see the README). If the page still works after a refund, the webhook isn't reaching the site.

## 7. Re-download (lost link)

- [ ] Open `https://nixonmade.com/redownload`, paste the `cs_test_...` id or the whole bookmarked address, and confirm you land on the download page.
- [ ] For a buyer who lost everything: they email hello@nixonmade.com with their receipt, you find the payment in Stripe, and you send them `https://nixonmade.com/thanks?session_id=cs_...`.

When every box is ticked in Sandbox, repeat steps 1 to 3 once with live links after going live.
