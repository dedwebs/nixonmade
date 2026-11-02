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
  /** True when an expanded latest_charge shows a refund. False when the charge was not expanded. */
  chargeRefunded: boolean;
};

type StripeFailure = {
  ok: false;
  rateLimited?: boolean;
  knownInvalid?: boolean;
  expandForbidden?: boolean;
};
type StripeSuccess = { ok: true; session: CheckoutSession; expandForbidden?: boolean };
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
  const chargeRefunded = chargeShowsRefund(record.payment_intent);

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
    chargeRefunded,
  };
}

function chargeShowsRefund(paymentIntent: unknown): boolean {
  if (!paymentIntent || typeof paymentIntent !== "object") return false;
  const latest = (paymentIntent as { latest_charge?: unknown }).latest_charge;
  if (!latest || typeof latest !== "object") return false;
  const charge = latest as { refunded?: unknown; amount_refunded?: unknown };
  if (charge.refunded === true) return true;
  return typeof charge.amount_refunded === "number" && charge.amount_refunded > 0;
}

/**
 * Read one Checkout Session. The key must be a restricted key (rk_).
 * Failures return no Stripe body and no session id.
 *
 * The request also asks for payment_intent.latest_charge so a refund visible
 * on the charge can block the download. A Checkout Sessions-only restricted
 * key is not allowed to read PaymentIntents or Charges, and Stripe then
 * answers 403. That attempt is discarded and the session is read again with
 * line items only. Refunds and disputes still depend on the signed webhook
 * unless the key is later granted those reads.
 *
 * `allow` is called before each Stripe HTTP request that is actually sent.
 * The caller spends its per-IP budget before the shared budget. Return false
 * to stop. `skipExpand` skips the charge expand after a remembered 403.
 * A fresh 403 is reported as `expandForbidden` so the caller can remember it.
 * `knownInvalid` means this session id will not become a paid purchase on
 * retry (unknown id, or a session that is not a paid payment).
 */
export async function retrieveCheckoutSession(
  sessionId: string,
  key: string,
  allow: () => Promise<boolean> = async () => true,
  options: { skipExpand?: boolean } = {},
): Promise<StripeLookup> {
  const keyMode = restrictedKeyMode(key);
  const idMode = sessionMode(sessionId);
  if (!keyMode || !idMode || keyMode !== idMode || !SESSION_ID_RE.test(sessionId)) {
    return { ok: false };
  }

  const base = `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`;
  const expanded = `${base}?expand[]=line_items&expand[]=payment_intent.latest_charge`;
  const plain = `${base}?expand[]=line_items`;
  if (options.skipExpand) return stripeGetSession(plain, key, keyMode, allow, false);

  const first = await stripeGet(expanded, key, allow);
  if (first === "rate") return { ok: false, rateLimited: true };
  if (!first) return { ok: false };
  if (first.status !== 403) return readSession(first, keyMode);
  safeLog("stripe_expand_forbidden");
  await first.body?.cancel();
  return stripeGetSession(plain, key, keyMode, allow, true);
}

async function stripeGetSession(
  url: string,
  key: string,
  keyMode: RestrictedKeyMode,
  allow: () => Promise<boolean>,
  expandForbidden: boolean,
): Promise<StripeLookup> {
  const response = await stripeGet(url, key, allow);
  if (response === "rate") return { ok: false, rateLimited: true, expandForbidden };
  if (!response) return { ok: false, expandForbidden };
  const parsed = await readSession(response, keyMode);
  return expandForbidden ? { ...parsed, expandForbidden: true } : parsed;
}

async function stripeGet(
  url: string,
  key: string,
  allow: () => Promise<boolean>,
): Promise<Response | "rate" | null> {
  if (!(await allow())) return "rate";
  try {
    return await fetch(url, {
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
    return null;
  }
}

async function readSession(response: Response, keyMode: RestrictedKeyMode): Promise<StripeLookup> {
  if (response.status >= 300 && response.status < 400) {
    safeLog("stripe_redirect");
    await response.body?.cancel();
    return { ok: false };
  }
  if (!response.ok) {
    safeLog(`stripe_http_${response.status}`);
    await response.body?.cancel();
    return { ok: false, knownInvalid: response.status === 404 };
  }

  const length = response.headers.get("content-length");
  if (length && Number(length) > MAX_BODY) {
    safeLog("stripe_body_size");
    await response.body?.cancel();
    return { ok: false };
  }

  const text = await readCappedText(response, MAX_BODY);
  if (text === "read") return { ok: false };
  if (text === null) {
    safeLog("stripe_body_size");
    return { ok: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    safeLog("stripe_parse");
    return { ok: false, knownInvalid: true };
  }
  const session = parseCheckoutSession(parsed);
  if (!session) return { ok: false, knownInvalid: true };
  if ((session.livemode ? "live" : "test") !== keyMode) return { ok: false, knownInvalid: true };
  return { ok: true, session };
}

async function readCappedText(response: Response, max: number): Promise<string | null | "read"> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    let done = false;
    let value: Uint8Array | undefined;
    try {
      const next = await reader.read();
      done = next.done;
      value = next.value;
    } catch {
      safeLog("stripe_body_read");
      await reader.cancel().catch(() => undefined);
      return "read";
    }
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
