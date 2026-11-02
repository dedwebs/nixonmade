const SESSION_LEAK = /cs_(test_|live_)[A-Za-z0-9]+/;
const SECRET_LEAK = /(rk_|sk_|whsec_|plink_|price_)/;

/**
 * Application logs are static reason codes. Checkout session ids and secrets
 * must never be interpolated into a log line. Cloudflare request logs can
 * still contain the URL; wrangler.jsonc sets observability.redact_query_string
 * so those platform logs drop the query.
 */
export function safeLog(event: string): void {
  if (SESSION_LEAK.test(event) || SECRET_LEAK.test(event)) {
    console.log("log_suppressed");
    return;
  }
  console.log(event);
}
