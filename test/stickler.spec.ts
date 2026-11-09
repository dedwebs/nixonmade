import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { supportLocation } from "../src/stickler";
import { loadCatalog, loadFreeProduct, matchProduct } from "../src/products";
import { nextIp, request, putProduct } from "./support";

const KEY = "stickler/Stickler.dmg";
type E = Cloudflare.Env;

function withEnv(extra: Record<string, string>): E {
  return { ...env, ...extra } as E;
}
function call(e: E, path: string, ip: string | null = nextIp(), init: RequestInit = {}) {
  const req = ip === null ? new Request(`https://nixonmade.com${path}`, { redirect: "manual", ...init }) : request(path, ip, init);
  return worker.fetch(req, e);
}
const configured = () => withEnv({ PRODUCT_STICKLER_KEY: KEY });

describe("free product", () => {
  it("loads from key and filename only, and is empty by default", () => {
    expect(loadFreeProduct(env, "stickler")).toBeNull();
    const product = loadFreeProduct(configured(), "stickler");
    expect(product).toMatchObject({
      slug: "stickler",
      kind: "free",
      title: "Stickler",
      key: KEY,
      filename: "Stickler.dmg",
      mediaType: "application/x-apple-diskimage",
    });
  });
  it("rejects bad keys and mismatched types", () => {
    expect(loadFreeProduct(withEnv({ PRODUCT_STICKLER_KEY: "../x.dmg" }), "stickler")).toBeNull();
    expect(loadFreeProduct(withEnv({ PRODUCT_STICKLER_KEY: "stickler/a.zip" }), "stickler")).toBeNull();
  });
  it("is never in the paid catalog or matched by a session", () => {
    const e = configured();
    const catalog = loadCatalog(e);
    expect(catalog.map((p) => p.slug)).toEqual(["field-kit", "ship-kit", "fleet-sheets", "toolwarden"]);
    expect(
      matchProduct(catalog, { livemode: false, paymentLinkId: "test_abc123", priceIds: [] }),
    ).toBeNull();
    expect(
      matchProduct(catalog, { livemode: false, paymentLinkId: "plink_fieldkittest", priceIds: [] })?.slug,
    ).toBe("field-kit");
  });
});

describe("/stickler/download", () => {
  it("streams the file with attachment headers", async () => {
    await putProduct(KEY, "dmg-bytes");
    for (const path of ["/stickler/download", "/stickler/download/"]) {
      const res = await call(configured(), path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="Stickler.dmg"');
      expect(res.headers.get("content-type")).toBe("application/x-apple-diskimage");
      expect(res.headers.get("content-length")).toBe("9");
      expect(res.headers.get("etag")).toBeTruthy();
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).toBe("dmg-bytes");
    }
  });
  it("answers HEAD without a body", async () => {
    await putProduct(KEY, "dmg-bytes");
    const res = await call(configured(), "/stickler/download", nextIp(), { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("9");
    expect(await res.text()).toBe("");
  });
  it("rejects other methods", async () => {
    const res = await call(configured(), "/stickler/download", nextIp(), { method: "POST" });
    expect(res.status).toBe(405);
  });
  it("limits each connection per hour", async () => {
    await putProduct(KEY, "x");
    const e = withEnv({ PRODUCT_STICKLER_KEY: KEY, RATE_LIMIT_FREE_IP_PER_HOUR: "2" });
    const ip = "198.51.100.77";
    expect((await call(e, "/stickler/download", ip)).status).toBe(200);
    expect((await call(e, "/stickler/download", ip)).status).toBe(200);
    const blocked = await call(e, "/stickler/download", ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("3600");
    expect(await blocked.text()).toContain("busy");
    expect((await call(e, "/stickler/download", "198.51.100.78")).status).toBe(200);
  });
  it("enforces the worker-wide daily cap", async () => {
    await putProduct(KEY, "x");
    const e = withEnv({ PRODUCT_STICKLER_KEY: KEY, RATE_LIMIT_FREE_PER_DAY: "1" });
    // the counter is shared across this file, so only the second call is certain to be over
    const statuses = [(await call(e, "/stickler/download")).status, (await call(e, "/stickler/download")).status];
    expect(statuses[1]).toBe(429);
    const res = await call(e, "/stickler/download");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });
  it("fails closed with a clean 503 when the key is unset", async () => {
    const res = await call(env as E, "/stickler/download");
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain("<html");
    expect(text).not.toMatch(/stack|Error:/);
  });
  it("answers a clean 404 when the object is missing", async () => {
    const e = withEnv({ PRODUCT_STICKLER_KEY: "stickler/Missing.dmg" });
    const res = await call(e, "/stickler/download");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("<html");
  });
  it("refuses a request with no connection id", async () => {
    await putProduct(KEY, "x");
    expect((await call(configured(), "/stickler/download", null)).status).toBe(429);
  });
  it("logs outcomes without IPs", async () => {
    await putProduct(KEY, "x");
    const lines: string[] = [];
    const original = console.log;
    console.log = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
    const ip = "198.51.100.99";
    await call(configured(), "/stickler/download", ip);
    console.log = original;
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain(ip);
  });
});

describe("/stickler/support", () => {
  const e = withEnv({
    STICKLER_SUPPORT_LINK_5: "test_abc5",
    STICKLER_SUPPORT_LINK_10: "https://buy.stripe.com/14k5abc10",
    STICKLER_SUPPORT_LINK_20: " test_abc20 ",
    STICKLER_SUPPORT_LINK_OTHER: "https://buy.stripe.com/test_other",
  });
  it("redirects each amount, with or without a trailing slash", async () => {
    const want: Record<string, string> = {
      "5": "test_abc5",
      "10": "14k5abc10",
      "20": "test_abc20",
      other: "test_other",
    };
    for (const [amount, code] of Object.entries(want)) {
      for (const path of [`/stickler/support/${amount}`, `/stickler/support/${amount}/`]) {
        const res = await call(e, path);
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe(`https://buy.stripe.com/${code}`);
      }
    }
  });
  it("ignores query strings on the request", async () => {
    const res = await call(e, "/stickler/support/5?next=https://evil.com&x=1");
    expect(res.headers.get("location")).toBe("https://buy.stripe.com/test_abc5");
  });
  it("answers 503 when the var is unset", async () => {
    const res = await call(env as E, "/stickler/support/5");
    expect(res.status).toBe(503);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain("aren't set up yet");
  });
  it("rejects unsafe values", () => {
    const bad = [
      "http://buy.stripe.com/test_abc",
      "https://evil.com/test_abc",
      "https://buy.stripe.com.evil.com/test_abc",
      "https://buy.stripe.com@evil.com/test_abc",
      "https://evil.com/https://buy.stripe.com/test_abc",
      "https://buy.stripe.com/../etc",
      "https://buy.stripe.com/test_abc?x=1",
      "https://buy.stripe.com/test_abc#frag",
      "https://buy.stripe.com/test_abc/extra",
      "../test_abc",
      "test_abc?x=1",
      "test abc",
      "//evil.com",
      "javascript:alert(1)",
      "",
      "   ",
    ];
    for (const value of bad) expect(supportLocation(value), value).toBeNull();
    expect(supportLocation(undefined)).toBeNull();
    expect(supportLocation("14k5abc")).toBe("https://buy.stripe.com/14k5abc");
  });
  it("answers 503, not a redirect, for an invalid var", async () => {
    const res = await call(withEnv({ STICKLER_SUPPORT_LINK_5: "https://buy.stripe.com.evil.com/x" }), "/stickler/support/5");
    expect(res.status).toBe(503);
    expect(res.headers.get("location")).toBeNull();
  });
  it("404s unknown amounts and does not intercept static pages", async () => {
    for (const path of ["/stickler/support/7", "/stickler/support/5/x", "/stickler/support/05"]) {
      expect((await SELF.fetch(`https://nixonmade.com${path}`, { redirect: "manual" })).status).toBe(404);
    }
    // Index and thanks are not handled by the worker's stickler routes.
    const { isSticklerPath } = await import("../src/stickler");
    for (const p of ["/stickler/", "/stickler/support/", "/stickler/support/thanks/", "/stickler/support/thanks"]) {
      expect(isSticklerPath(p), p).toBe(false);
    }
  });
});
