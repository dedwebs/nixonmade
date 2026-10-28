import { escapeHtml } from "./http";

function page(title: string, main: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="robots" content="noindex, nofollow" />
    <meta name="theme-color" content="#f3eee4" />
    <link rel="icon" href="/brand/press-stamp.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="product-page field-kit download-page">
    <a class="skip" href="#content">Skip to content</a>
    <header class="hero">
      <p class="wordmark">
        <a href="/">
          <img src="/brand/press-stamp.svg" alt="Nixon Made" width="520" height="520" />
        </a>
      </p>
    </header>
    <main id="content" class="field-main">
      ${main}
      <footer>
        <p>
          <a href="/refunds/">Refund policy</a>
          <span class="dot" aria-hidden="true">·</span>
          <a href="/terms/">Terms</a>
          <span class="dot" aria-hidden="true">·</span>
          <a href="/privacy/">Privacy</a>
        </p>
        <p>Copyright NixonMade</p>
        <p><a href="/">Nixon Made</a></p>
      </footer>
    </main>
  </body>
</html>`;
}

export function unavailablePage(): string {
  return page(
    "Purchase not available — Nixon Made",
    `<h1>We couldn't open that purchase.</h1>
      <p class="lede">If you just paid, wait a moment and refresh this page. If it still fails, email <a href="mailto:hello@nixonmade.com">hello@nixonmade.com</a> from the address you used at checkout and include your Stripe receipt.</p>
      <p>If you saved the checkout session id, enter it on the <a href="/redownload">re-download page</a>.</p>`,
  );
}

export function rateLimitPage(): string {
  return page(
    "Please wait — Nixon Made",
    `<h1>Please wait a minute.</h1>
      <p class="lede">Too many requests came from this connection. Nothing was changed. Try the page again in a minute.</p>`,
  );
}

export function thanksReadyPage(options: {
  title: string;
  filename: string;
  filePath: string;
  remaining: number;
  ttlMinutes: number;
  limit: number;
}): string {
  return page(
    `${options.title} download — Nixon Made`,
    `<h1>You're in.</h1>
      <p class="lede">${escapeHtml(options.title)} is ready.</p>
      <p class="actions"><a class="btn" href="${escapeHtml(options.filePath)}">Download ${escapeHtml(options.filename)}</a></p>
      <p class="note">The button lasts ${options.ttlMinutes} minutes. Bookmark this page, not the button. This page is how you download again. You can download ${options.limit} times. ${options.remaining} left, counting this one. A second click on the same button inside 30 seconds does not count again.</p>
      <p>Lost the page address? The <a href="/redownload">re-download page</a> takes the checkout session id from it. We do not look people up by email.</p>`,
  );
}

export function thanksLimitPage(limit: number): string {
  return page(
    "Download limit — Nixon Made",
    `<h1>You're in.</h1>
      <p class="lede">This purchase has used its ${limit} downloads. Email <a href="mailto:hello@nixonmade.com">hello@nixonmade.com</a> if you need another copy.</p>`,
  );
}

export function thanksMissingFilePage(title: string): string {
  return page(
    `${title} — Nixon Made`,
    `<h1>You're in.</h1>
      <p class="lede">The payment is confirmed, and the ${escapeHtml(title)} file is not uploaded yet. Email <a href="mailto:hello@nixonmade.com">hello@nixonmade.com</a> and we will send it.</p>`,
  );
}

export function redownloadPage(message: string | null): string {
  const note = message ? `<p class="note" role="status">${escapeHtml(message)}</p>` : "";
  return page(
    "Download again — Nixon Made",
    `<a class="back" href="/">← Nixon Made</a>
      <h1>Download again</h1>
      <p class="lede">Paste the checkout session id from the page Stripe opened after you paid. It starts with <code>cs_live_</code> or <code>cs_test_</code>. You can also paste that page's full address.</p>
      <p>This form does not ask for your email. An email lookup would tell a stranger which addresses have bought something. If you lost the session id, email <a href="mailto:hello@nixonmade.com">hello@nixonmade.com</a> from the address you paid with and include the Stripe receipt.</p>
      ${note}
      <form method="post" action="/redownload">
        <label for="session_id">Checkout session id</label>
        <input id="session_id" name="session_id" type="text" autocomplete="off" spellcheck="false" maxlength="500" required />
        <button class="btn" type="submit">Continue</button>
      </form>`,
  );
}
