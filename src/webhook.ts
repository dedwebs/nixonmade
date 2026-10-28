import { hmacSha256Hex, PAYMENT_INTENT_RE, timingSafeEqual } from "./sign";

const TOLERANCE_SECONDS = 300;

function paymentIntentId(value: unknown): string | null {
  if (typeof value === "string" && PAYMENT_INTENT_RE.test(value)) return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" && PAYMENT_INTENT_RE.test(id)) return id;
  }
  return null;
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/**
 * Stripe signs `${timestamp}.${rawBody}` with the webhook secret as a UTF-8
 * HMAC key. Every v1 signature is compared, including malformed ones, so a
 * bad signature does not return early.
 */
export async function verifyStripeWebhook(
  payload: string,
  header: string | null,
  secret: string,
  nowMs: number,
): Promise<boolean> {
  if (!header || secret.length < 16) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1") signatures.push(value);
  }
  if (!/^\d{1,12}$/.test(timestamp) || signatures.length === 0) return false;
  const stamp = Number(timestamp);
  if (!Number.isFinite(stamp)) return false;
  if (Math.abs(nowMs / 1000 - stamp) > TOLERANCE_SECONDS) return false;

  const expectedHex = await hmacSha256Hex(secret, `${timestamp}.${payload}`);
  const expected = hexToBytes(expectedHex);
  if (!expected) return false;
  let ok = 0;
  for (const signature of signatures) {
    const actual = hexToBytes(signature);
    if (!actual) {
      timingSafeEqual(expected, expected);
      continue;
    }
    ok |= timingSafeEqual(actual, expected) ? 1 : 0;
  }
  return ok === 1;
}

/**
 * Payment intent whose access should stop: a refund, or a dispute that has
 * been opened or had funds withdrawn. A closed or won dispute does not clear
 * the block; that stays sticky, same as a refund.
 */
export function refundedPaymentIntent(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  const type = record.type;
  const data = record.data;
  if (!data || typeof data !== "object") return null;
  const object = (data as { object?: unknown }).object;
  if (!object || typeof object !== "object") return null;
  const resource = object as Record<string, unknown>;
  const paymentIntent = paymentIntentId(resource.payment_intent);
  if (!paymentIntent) return null;

  if (type === "charge.refunded" && resource.object === "charge") {
    const amount = resource.amount_refunded;
    if (resource.refunded === true) return paymentIntent;
    if (typeof amount === "number" && amount > 0) return paymentIntent;
    return null;
  }

  if (
    (type === "refund.created" || type === "refund.updated") &&
    resource.object === "refund"
  ) {
    const amount = resource.amount;
    if (resource.status === "succeeded" && typeof amount === "number" && amount > 0) {
      return paymentIntent;
    }
  }

  if (
    (type === "charge.dispute.created" || type === "charge.dispute.funds_withdrawn") &&
    resource.object === "dispute"
  ) {
    return paymentIntent;
  }
  return null;
}
