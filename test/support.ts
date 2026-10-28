import { env } from "cloudflare:test";
import { hmacSha256Hex } from "../src/sign";

export const FIELD_SESSION = "cs_test_paidfieldkit0001";
export const FIELD_INTENT = "pi_fieldkitintent01";
export const SIGNING_SECRET = "unit-test-signing-secret-32chars-minimum";
export const WEBHOOK_SECRET = "whsec_unit_test_webhook_secret_value_0001";

let ipCount = 0;

export function nextIp(): string {
  ipCount += 1;
  const host = (ipCount % 200) + 1;
  return `203.0.113.${host}`;
}

export function paidSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: FIELD_SESSION,
    object: "checkout.session",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    livemode: false,
    payment_intent: FIELD_INTENT,
    payment_link: "plink_fieldkittest",
    line_items: {
      object: "list",
      data: [
        {
          id: "li_field",
          object: "item",
          price: { id: "price_fieldkittest", object: "price" },
        },
      ],
    },
    customer_details: { email: "buyer@example.com", name: "Buyer Example" },
    ...overrides,
  };
}

let originalFetch: typeof fetch | null = null;

export function installStripe(
  sessions: Record<string, unknown> | ((url: string, init?: RequestInit) => Response | Promise<Response>),
): { calls: string[] } {
  if (!originalFetch) originalFetch = globalThis.fetch.bind(globalThis);
  const saved = originalFetch;
  const calls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith("https://api.stripe.com/")) return saved(input as RequestInfo, init);
    calls.push(url);
    if (typeof sessions === "function") return sessions(url, init);
    const id = decodeURIComponent(url.split("/checkout/sessions/")[1]?.split("?")[0] ?? "");
    const body = sessions[id];
    if (!body) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls };
}

export function restoreFetch(): void {
  if (originalFetch) globalThis.fetch = originalFetch;
}

export async function putProduct(key: string, bytes = "product-bytes"): Promise<void> {
  await env.DOWNLOADS.put(key, bytes);
}

export function request(path: string, ip: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("CF-Connecting-IP", ip);
  return new Request(`https://nixonmade.com${path}`, {
    redirect: "manual",
    ...init,
    headers,
  });
}

export async function stripeSignature(payload: string, nowMs = Date.now()): Promise<string> {
  const stamp = Math.floor(nowMs / 1000);
  const mac = await hmacSha256Hex(WEBHOOK_SECRET, `${stamp}.${payload}`);
  return `t=${stamp},v1=${mac}`;
}
