import { safeLog } from "./log";
import { PAYMENT_INTENT_RE, SESSION_ID_RE, sessionMode } from "./sign";

const STRIPE_VERSION = "2024-11-20.acacia";
const MAX_BODY = 1_000_000;

export type RestrictedKeyMode = "test" | "live";

export function restrictedKeyMode(key: string | undefined): RestrictedKeyMode | null {
  if (!key) return null;
  if (/^rk_test_[A-Za-z0-9_]{8,}$/.test(key)) return "test";
  if (/^rk_live_[A-Za-z0-9_]{8,}$/.test(key)) return "live";
  safeLog("stripe_key_rejected");
  return null;
}

export type CheckoutSession = {
  livemode: boolean;
  paymentIntentId: string;
  paymentLinkId: string | null;
  priceIds: string[];
};

type StripeFailure = { ok: false };
type StripeSuccess = { ok: true; session: CheckoutSession };
export type StripeLookup = StripeFailure | StripeSuccess;

function stringId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

export function parseCheckoutSession(value: unknown): CheckoutSession | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.object !== "checkout.session") return null;
  if (record.mode !== "payment") return null;
  if (record.status !== "complete") return null;
  if (record.payment_status !== "paid") return null;
  if (typeof record.livemode !== "boolean") return null;
  const paymentIntentId = stringId(record.payment_intent);
  if (!paymentIntentId || !PAYMENT_INTENT_RE.test(paymentIntentId)) return null;

  const paymentLinkId = stringId(record.payment_link);
  const priceIds: string[] = [];
  const lineItems = record.line_items;
  if (lineItems && typeof lineItems === "object" && "data" in lineItems) {
    const data = (lineItems as { data?: unknown }).data;
    if (Array.isArray(data)) {
      for (const item of data) {
        if (!item || typeof item !== "object") continue;
        const price = stringId((item as { price?: unknown }).price);
        if (price && /^price_[A-Za-z0-9]{8,200}$/.test(price)) priceIds.push(price);
      }
    }
  }

  return {
    livemode: record.livemode,
    paymentIntentId,
    paymentLinkId:
      paymentLinkId && /^plink_[A-Za-z0-9]{8,200}$/.test(paymentLinkId)
        ? paymentLinkId
        : null,
    priceIds,
  };
}

/**
 * Read one Checkout Session. The key must be a restricted key (rk_).
 * Failures return no Stripe body and no session id.
 */
export async function retrieveCheckoutSession(
  sessionId: string,
  key: string,
): Promise<StripeLookup> {
  const keyMode = restrictedKeyMode(key);
  const idMode = sessionMode(sessionId);
  if (!keyMode || !idMode || keyMode !== idMode || !SESSION_ID_RE.test(sessionId)) {
    return { ok: false };
  }

  const url = `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${key}`,
        "Stripe-Version": STRIPE_VERSION,
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    safeLog("stripe_network");
    return { ok: false };
  }

  if (response.status >= 300 && response.status < 400) {
    safeLog("stripe_redirect");
    await response.body?.cancel();
    return { ok: false };
  }
  if (!response.ok) {
    safeLog(`stripe_http_${response.status}`);
    await response.body?.cancel();
    return { ok: false };
  }

  const length = response.headers.get("content-length");
  if (length && Number(length) > MAX_BODY) {
    safeLog("stripe_body_size");
    await response.body?.cancel();
    return { ok: false };
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    safeLog("stripe_network");
    return { ok: false };
  }
  if (text.length > MAX_BODY) {
    safeLog("stripe_body_size");
    return { ok: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    safeLog("stripe_parse");
    return { ok: false };
  }
  const session = parseCheckoutSession(parsed);
  if (!session) return { ok: false };
  if ((session.livemode ? "live" : "test") !== keyMode) return { ok: false };
  return { ok: true, session };
}
