import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { escapeHtml } from "../src/http";
import { safeLog } from "../src/log";
import { loadCatalog, matchProduct } from "../src/products";
import { signDownloadToken, timingSafeEqual, verifyDownloadToken } from "../src/sign";
import { parseCheckoutSession, restrictedKeyMode } from "../src/stripe";
import { refundedPaymentIntent, verifyStripeWebhook } from "../src/webhook";
import { paidSession, SIGNING_SECRET, stripeSignature, WEBHOOK_SECRET } from "./support";

describe("constant-time compare and tokens", () => {
  it("compares every byte and rejects a different length", () => {
    const left = new Uint8Array([1, 2, 3, 4]);
    expect(timingSafeEqual(left, new Uint8Array([1, 2, 3, 4]))).toBe(true);
    expect(timingSafeEqual(left, new Uint8Array([1, 2, 3, 9]))).toBe(false);
    expect(timingSafeEqual(left, new Uint8Array([1, 2, 3]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array(), new Uint8Array())).toBe(true);
  });

  it("rejects a flipped signature and an expired token", async () => {
    const token = await signDownloadToken(
      {
        v: 1,
        exp: Math.floor(Date.now() / 1000) + 60,
        jti: "abcdefghij123456",
        product: "field-kit",
        sid: "cs_test_paidfieldkit0001",
      },
      SIGNING_SECRET,
    );
    const flipped = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    expect(await verifyDownloadToken(flipped, SIGNING_SECRET, Date.now())).toBeNull();
    expect(await verifyDownloadToken(token, SIGNING_SECRET, Date.now())).not.toBeNull();

    const expired = await signDownloadToken(
      {
        v: 1,
        exp: Math.floor(Date.now() / 1000) - 10,
        jti: "abcdefghij123456",
        product: "field-kit",
        sid: "cs_test_paidfieldkit0001",
      },
      SIGNING_SECRET,
    );
    expect(await verifyDownloadToken(expired, SIGNING_SECRET, Date.now())).toBeNull();
    expect(await verifyDownloadToken(token, "another-secret-that-is-long-enough-32", Date.now())).toBeNull();
  });

  it("does not log a checkout session id", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    safeLog("stripe_http_404");
    safeLog("leaked cs_test_paidfieldkit0001");
    safeLog("leaked rk_test_secretvalue");
    console.log = original;
    expect(lines).toEqual(["stripe_http_404", "log_suppressed", "log_suppressed"]);
  });
});

describe("allowlist", () => {
  const catalog = loadCatalog(env);

  it("maps test and live ids separately, and fails closed on ambiguity", () => {
    expect(
      matchProduct(catalog, {
        livemode: false,
        paymentLinkId: "plink_fieldkittest",
        priceIds: ["price_fieldkittest"],
      })?.slug,
    ).toBe("field-kit");
    expect(
      matchProduct(catalog, {
        livemode: true,
        paymentLinkId: "plink_fieldkittest",
        priceIds: ["price_fieldkittest"],
      }),
    ).toBeNull();
    expect(
      matchProduct(catalog, {
        livemode: false,
        paymentLinkId: "plink_shipdfytest",
        priceIds: [],
      })?.slug,
    ).toBe("ship-kit");
    expect(
      matchProduct(catalog, {
        livemode: false,
        paymentLinkId: "plink_fieldkittest",
        priceIds: ["price_shipkittest"],
      }),
    ).toBeNull();
    expect(
      matchProduct(catalog, {
        livemode: false,
        paymentLinkId: null,
        priceIds: ["price_fleettest01"],
      })?.slug,
    ).toBe("fleet-sheets");
    expect(
      matchProduct(catalog, {
        livemode: false,
        paymentLinkId: "plink_unknown1",
        priceIds: ["price_unknown1"],
      }),
    ).toBeNull();
  });

  it("drops object keys and filenames that could change headers or paths", () => {
    const parsed = loadCatalog({
      PRODUCT_FIELD_KIT_KEY: "products/../secret",
      PRODUCT_FIELD_KIT_FILENAME: "ok.zip",
      PRODUCT_SHIP_KIT_KEY: "products/ship-kit.zip",
      PRODUCT_SHIP_KIT_FILENAME: "bad.zip\r\nX-Evil: 1",
      PRODUCT_FLEET_SHEETS_KEY: "/products/fleet-sheets.zip",
      PRODUCT_FLEET_SHEETS_FILENAME: "nixonmade-fleet-sheets.zip",
    } as Cloudflare.Env);
    expect(parsed).toEqual([]);
    expect(escapeHtml(`<script>"'`)).toBe("&lt;script&gt;&quot;&#39;");
  });
});

describe("checkout session rules", () => {
  it("accepts a paid payment and rejects everything else", () => {
    expect(parseCheckoutSession(paidSession())).toMatchObject({
      paymentIntentId: "pi_fieldkitintent01",
      paymentLinkId: "plink_fieldkittest",
      priceIds: ["price_fieldkittest"],
    });
    expect(parseCheckoutSession(paidSession({ mode: "subscription" }))).toBeNull();
    expect(parseCheckoutSession(paidSession({ status: "expired" }))).toBeNull();
    expect(parseCheckoutSession(paidSession({ status: "open" }))).toBeNull();
    expect(parseCheckoutSession(paidSession({ payment_status: "unpaid" }))).toBeNull();
    expect(parseCheckoutSession(paidSession({ payment_status: "no_payment_required" }))).toBeNull();
    expect(parseCheckoutSession(paidSession({ payment_intent: null }))).toBeNull();
    expect(restrictedKeyMode("rk_test_unit_test_key_not_real_0001")).toBe("test");
    expect(restrictedKeyMode("sk_test_not_restricted_key")).toBeNull();
    expect(restrictedKeyMode("rk_live_not_this_worker")).toBe("live");
  });
});

describe("webhook signatures and refunds", () => {
  it("accepts a current signature and rejects a bad or stale one", async () => {
    const payload = JSON.stringify({ id: "evt_1", type: "charge.refunded" });
    const header = await stripeSignature(payload);
    expect(await verifyStripeWebhook(payload, header, WEBHOOK_SECRET, Date.now())).toBe(true);
    expect(await verifyStripeWebhook(payload, header.replace(/.$/, "0"), WEBHOOK_SECRET, Date.now())).toBe(
      false,
    );
    expect(await verifyStripeWebhook(`${payload} `, header, WEBHOOK_SECRET, Date.now())).toBe(false);
    const stale = await stripeSignature(payload, Date.now() - 10 * 60 * 1000);
    expect(await verifyStripeWebhook(payload, stale, WEBHOOK_SECRET, Date.now())).toBe(false);
    expect(await verifyStripeWebhook(payload, null, WEBHOOK_SECRET, Date.now())).toBe(false);
  });

  it("marks full and partial refunds and ignores failed ones", () => {
    expect(
      refundedPaymentIntent({
        type: "charge.refunded",
        data: {
          object: {
            object: "charge",
            refunded: true,
            amount_refunded: 1900,
            payment_intent: "pi_fieldkitintent01",
          },
        },
      }),
    ).toBe("pi_fieldkitintent01");
    expect(
      refundedPaymentIntent({
        type: "refund.created",
        data: {
          object: {
            object: "refund",
            status: "succeeded",
            amount: 100,
            payment_intent: { id: "pi_fieldkitintent01" },
          },
        },
      }),
    ).toBe("pi_fieldkitintent01");
    expect(
      refundedPaymentIntent({
        type: "refund.updated",
        data: {
          object: {
            object: "refund",
            status: "failed",
            amount: 1900,
            payment_intent: "pi_fieldkitintent01",
          },
        },
      }),
    ).toBeNull();
  });
});

describe("purchase gate atomicity", () => {
  it("never lets parallel consumes pass the cap", async () => {
    const stub = env.PURCHASE_GATE.getByName("session:cs_test_parallelgate0001");
    const now = 1_700_000_000_000;
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) => stub.consume(`jti-${index}`, 5, now + index)),
    );
    expect(results.filter((result) => result === "ok")).toHaveLength(5);
    expect(results.filter((result) => result === "limit")).toHaveLength(7);
    expect(await stub.remaining(5)).toBe(0);
  });

  it("counts a retry inside 30 seconds once, then counts a later transfer", async () => {
    const stub = env.PURCHASE_GATE.getByName("session:cs_test_dedupewindow0001");
    const now = 1_700_000_000_000;
    expect(await stub.consume("same-token", 5, now)).toBe("ok");
    expect(await stub.consume("same-token", 5, now + 1_000)).toBe("duplicate");
    expect(await stub.remaining(5)).toBe(4);
    expect(await stub.consume("same-token", 5, now + 31_000)).toBe("ok");
    expect(await stub.remaining(5)).toBe(3);
  });

  it("rolls a missing file back and rate-limits inside the window", async () => {
    const stub = env.PURCHASE_GATE.getByName("session:cs_test_rollback0001");
    expect(await stub.consume("once", 5, 1_700_000_000_000)).toBe("ok");
    await stub.rollback("once");
    expect(await stub.remaining(5)).toBe(5);

    const rate = env.PURCHASE_GATE.getByName("ip:unit-rate");
    const now = 1_800_000_000_000;
    expect(await rate.hit(2, 60_000, now)).toBe(true);
    expect(await rate.hit(2, 60_000, now + 10)).toBe(true);
    expect(await rate.hit(2, 60_000, now + 20)).toBe(false);
    expect(await rate.hit(2, 60_000, now + 60_001)).toBe(true);
  });

  it("keeps a refund sticky", async () => {
    const stub = env.PURCHASE_GATE.getByName("pi:pi_refundsticky0001");
    expect(await stub.isRefunded()).toBe(false);
    await stub.markRefunded();
    await stub.markRefunded();
    expect(await stub.isRefunded()).toBe(true);
  });
});
