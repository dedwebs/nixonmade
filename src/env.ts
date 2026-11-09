import type { PurchaseGate } from "./gate";

/**
 * Bindings the worker reads. Secrets are wrangler secrets, never vars:
 * STRIPE_RESTRICTED_KEY, DOWNLOAD_SIGNING_SECRET, STRIPE_WEBHOOK_SECRET.
 */
export interface Env {
  ASSETS: Fetcher;
  DOWNLOADS: R2Bucket;
  PURCHASE_GATE: DurableObjectNamespace<PurchaseGate>;
  STRIPE_RESTRICTED_KEY?: string;
  DOWNLOAD_SIGNING_SECRET?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  DOWNLOAD_LIMIT?: string;
  DOWNLOAD_TTL_SECONDS?: string;
  RATE_LIMIT_IP_PER_MINUTE?: string;
  RATE_LIMIT_SESSION_PER_MINUTE?: string;
  /** Checkout Session reads for one connection. Checked before the shared cap. */
  RATE_LIMIT_STRIPE_IP_PER_MINUTE?: string;
  /** Checkout Session reads for the whole worker. Default 300 per minute. */
  RATE_LIMIT_STRIPE_PER_MINUTE?: string;
  PRODUCT_FIELD_KIT_TEST_LINKS?: string;
  PRODUCT_FIELD_KIT_TEST_PRICES?: string;
  PRODUCT_FIELD_KIT_LIVE_LINKS?: string;
  PRODUCT_FIELD_KIT_LIVE_PRICES?: string;
  PRODUCT_FIELD_KIT_KEY?: string;
  PRODUCT_FIELD_KIT_FILENAME?: string;
  PRODUCT_FIELD_KIT_TITLE?: string;
  PRODUCT_SHIP_KIT_TEST_LINKS?: string;
  PRODUCT_SHIP_KIT_TEST_PRICES?: string;
  PRODUCT_SHIP_KIT_LIVE_LINKS?: string;
  PRODUCT_SHIP_KIT_LIVE_PRICES?: string;
  PRODUCT_SHIP_KIT_KEY?: string;
  PRODUCT_SHIP_KIT_FILENAME?: string;
  PRODUCT_SHIP_KIT_TITLE?: string;
  PRODUCT_FLEET_SHEETS_TEST_LINKS?: string;
  PRODUCT_FLEET_SHEETS_TEST_PRICES?: string;
  PRODUCT_FLEET_SHEETS_LIVE_LINKS?: string;
  PRODUCT_FLEET_SHEETS_LIVE_PRICES?: string;
  PRODUCT_FLEET_SHEETS_KEY?: string;
  PRODUCT_FLEET_SHEETS_FILENAME?: string;
  PRODUCT_FLEET_SHEETS_TITLE?: string;
  PRODUCT_TOOLWARDEN_TEST_LINKS?: string;
  PRODUCT_TOOLWARDEN_TEST_PRICES?: string;
  PRODUCT_TOOLWARDEN_LIVE_LINKS?: string;
  PRODUCT_TOOLWARDEN_LIVE_PRICES?: string;
  PRODUCT_TOOLWARDEN_KEY?: string;
  PRODUCT_TOOLWARDEN_FILENAME?: string;
  PRODUCT_TOOLWARDEN_TITLE?: string;
  /** Stickler (free). R2 object key, expected under the `stickler/` prefix. Empty fails closed. */
  PRODUCT_STICKLER_KEY?: string;
  PRODUCT_STICKLER_FILENAME?: string;
  PRODUCT_STICKLER_TITLE?: string;
  /** Free download requests per connection per hour. Default 10. */
  RATE_LIMIT_FREE_IP_PER_HOUR?: string;
  /** Free download requests for the whole worker per day. Default 2000. */
  RATE_LIMIT_FREE_PER_DAY?: string;
  /** Stripe Payment Link code (`buy.stripe.com/<code>`) or the full URL. */
  STICKLER_SUPPORT_LINK_5?: string;
  STICKLER_SUPPORT_LINK_10?: string;
  STICKLER_SUPPORT_LINK_20?: string;
  STICKLER_SUPPORT_LINK_OTHER?: string;
}
