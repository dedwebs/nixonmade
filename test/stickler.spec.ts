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
    // Paid files sit at the bucket root; a free key outside stickler/ fails closed.
    expect(loadFreeProduct(withEnv({ PRODUCT_STICKLER_KEY: "Toolwarden-0.2.0.dmg" }), "stickler")).toBeNull();
    expect(loadFreeProduct(withEnv({ PRODUCT_STICKLER_KEY: "products/stickler/a.dmg" }), "stickler")).toBeNull();
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
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
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

describe("/stickler/appcast.xml", () => {
  const XML = '<?xml version="1.0"?><rss><channel/></rss>';
  it("serves the object with feed headers", async () => {
    await env.DOWNLOADS.put("stickler/appcast.xml", XML);
    const res = await call(env as E, "/stickler/appcast.xml");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("etag")).toBeTruthy();
    expect(res.headers.get("last-modified")).toBeTruthy();
    expect(res.headers.get("content-length")).toBe(String(XML.length));
    expect(await res.text()).toBe(XML);
  });
  it("answers 304 on a matching If-None-Match, 200 otherwise", async () => {
    await env.DOWNLOADS.put("stickler/appcast.xml", XML);
    const first = await call(env as E, "/stickler/appcast.xml");
    const etag = first.headers.get("etag")!;
    await first.text();
    const hit = await call(env as E, "/stickler/appcast.xml", nextIp(), { headers: { "if-none-match": etag } });
    expect(hit.status).toBe(304);
    expect(await hit.text()).toBe("");
    expect(hit.headers.get("etag")).toBe(etag);
    const miss = await call(env as E, "/stickler/appcast.xml", nextIp(), { headers: { "if-none-match": '"other"' } });
    expect(miss.status).toBe(200);
    await miss.text();
  });
  it("answers HEAD without a body", async () => {
    await env.DOWNLOADS.put("stickler/appcast.xml", XML);
    const res = await call(env as E, "/stickler/appcast.xml", nextIp(), { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(XML.length));
    expect(await res.text()).toBe("");
  });
  it("404s cleanly when missing and rejects other methods", async () => {
    await env.DOWNLOADS.delete("stickler/appcast.xml");
    const res = await call(env as E, "/stickler/appcast.xml");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found.\n");
    expect((await call(env as E, "/stickler/appcast.xml", nextIp(), { method: "POST" })).status).toBe(405);
  });
  it("has its own limit, separate from downloads, with Retry-After", async () => {
    await env.DOWNLOADS.put("stickler/appcast.xml", XML);
    await putProduct(KEY, "x");
    const e = withEnv({ PRODUCT_STICKLER_KEY: KEY, RATE_LIMIT_APPCAST_IP_PER_HOUR: "2", RATE_LIMIT_FREE_IP_PER_HOUR: "1" });
    const ip = "198.51.100.120";
    expect((await call(e, "/stickler/appcast.xml", ip)).status).toBe(200);
    expect((await call(e, "/stickler/appcast.xml", ip)).status).toBe(200);
    const blocked = await call(e, "/stickler/appcast.xml", ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("3600");
    // The free download counter for the same IP is untouched.
    expect((await call(e, "/stickler/download", ip)).status).toBe(200);
  });
  it("refuses a request with no connection id", async () => {
    await env.DOWNLOADS.put("stickler/appcast.xml", XML);
    expect((await call(env as E, "/stickler/appcast.xml", null)).status).toBe(429);
  });
});

describe("/stickler/updates/", () => {
  const BYTES = "0123456789";
  const put = (name: string) => env.DOWNLOADS.put(`stickler/updates/${name}`, BYTES);
  it("serves each allowed type with headers", async () => {
    const types: Record<string, string> = {
      "Stickler-1.0.zip": "application/zip",
      "Stickler-1.0.dmg": "application/x-apple-diskimage",
      "Stickler1.0-0.9.delta": "application/octet-stream",
      "Stickler-1.0.tar.xz": "application/octet-stream",
    };
    for (const [name, type] of Object.entries(types)) {
      await put(name);
      const res = await call(env as E, `/stickler/updates/${name}`);
      expect(res.status, name).toBe(200);
      expect(res.headers.get("content-type")).toBe(type);
      expect(res.headers.get("content-length")).toBe("10");
      expect(res.headers.get("content-disposition")).toBe(`attachment; filename="${name}"`);
      expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(res.headers.get("accept-ranges")).toBe("bytes");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await res.text()).toBe(BYTES);
    }
  });
  it("rejects names outside the allowlist and traversal", async () => {
    await put("ok.zip");
    await env.DOWNLOADS.put("stickler/secret.zip", "no");
    await env.DOWNLOADS.put("secret.zip", "no");
    const bad = [
      "../secret.zip",
      "%2e%2e/secret.zip",
      "%2E%2E%2Fsecret.zip",
      "..%2Fsecret.zip",
      "sub%2Fok.zip",
      "sub/ok.zip",
      "a/b/c.zip",
      "..%5Csecret.zip",
      ".hidden.zip",
      "ok.zip%00.png",
      "ok..zip.txt",
      "ok.exe",
      "ok.txt",
      "ok",
      "",
      "a".repeat(130) + ".zip",
      "ok.zip/",
    ];
    for (const name of bad) {
      const res = await call(env as E, `/stickler/updates/${name}`);
      expect(res.status, name).toBe(404);
      // Dot segments are normalised by the URL parser to a path outside updates/.
      if (!name.startsWith("..") && !name.startsWith("%2e")) expect(await res.text(), name).toBe("Not found.\n");
    }
    // Normalised away by the URL parser; must still never leave stickler/updates/.
    for (const p of ["/stickler/updates/../secret.zip", "/stickler/updates/%2e%2e/secret.zip"]) {
      expect(await (await call(env as E, p)).text()).not.toBe("no");
    }
  });
  it("404s a missing file and answers HEAD", async () => {
    expect((await call(env as E, "/stickler/updates/Missing-1.0.zip")).status).toBe(404);
    await put("Head-1.0.zip");
    const res = await call(env as E, "/stickler/updates/Head-1.0.zip", nextIp(), { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("10");
    expect(await res.text()).toBe("");
    expect((await call(env as E, "/stickler/updates/Head-1.0.zip", nextIp(), { method: "POST" })).status).toBe(405);
  });
  it("supports Range requests", async () => {
    await put("Range-1.0.zip");
    const cases: Array<[string, string, string]> = [
      ["bytes=2-4", "234", "bytes 2-4/10"],
      ["bytes=7-", "789", "bytes 7-9/10"],
      ["bytes=-3", "789", "bytes 7-9/10"],
    ];
    for (const [range, body, cr] of cases) {
      const res = await call(env as E, "/stickler/updates/Range-1.0.zip", nextIp(), { headers: { range } });
      expect(res.status, range).toBe(206);
      expect(res.headers.get("content-range")).toBe(cr);
      expect(res.headers.get("content-length")).toBe(String(body.length));
      expect(await res.text()).toBe(body);
    }
    const bad = await call(env as E, "/stickler/updates/Range-1.0.zip", nextIp(), { headers: { range: "bytes=50-60" } });
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe("bytes */10");
  });
  it("limits each connection separately from downloads and the appcast", async () => {
    await put("Limit-1.0.zip");
    await putProduct(KEY, "x");
    await env.DOWNLOADS.put("stickler/appcast.xml", "<rss/>");
    const e = withEnv({ PRODUCT_STICKLER_KEY: KEY, RATE_LIMIT_UPDATES_IP_PER_HOUR: "2" });
    const ip = "198.51.100.121";
    expect((await call(e, "/stickler/updates/Limit-1.0.zip", ip)).status).toBe(200);
    expect((await call(e, "/stickler/updates/Limit-1.0.zip", ip)).status).toBe(200);
    const blocked = await call(e, "/stickler/updates/Limit-1.0.zip", ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("3600");
    expect((await call(e, "/stickler/download", ip)).status).toBe(200);
    expect((await call(e, "/stickler/appcast.xml", ip)).status).toBe(200);
    expect((await call(e, "/stickler/updates/Limit-1.0.zip", "198.51.100.122")).status).toBe(200);
  });
  it("enforces the worker-wide daily cap and logs no IPs", async () => {
    await put("Day-1.0.zip");
    const e = withEnv({ RATE_LIMIT_UPDATES_PER_DAY: "1" });
    const lines: string[] = [];
    const original = console.log;
    console.log = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
    const ip = "198.51.100.130";
    const statuses = [
      (await call(e, "/stickler/updates/Day-1.0.zip", ip)).status,
      (await call(e, "/stickler/updates/Day-1.0.zip", ip)).status,
    ];
    console.log = original;
    expect(statuses[1]).toBe(429);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain(ip);
  });
  it("renders the thanks page", async () => {
    const res = await SELF.fetch("https://nixonmade.com/stickler/support/thanks/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<html");
  });
});
