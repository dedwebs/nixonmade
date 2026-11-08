import { env, runInDurableObject, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_STRIPE_IP_LIMIT,
  DEFAULT_STRIPE_LIMIT,
  SESSION_CACHE_SHORT_TTL_MS,
  SESSION_CACHE_TTL_MS,
  STRIPE_IP_LABEL,
  STRIPE_LOOKUP_GATE,
} from "../src/access";
import { clientIp, hashName } from "../src/http";
import { signDownloadToken } from "../src/sign";
import {
  FIELD_SESSION,
  installStripe,
  nextIp,
  paidSession,
  putProduct,
  request,
  restoreFetch,
  SIGNING_SECRET,
  stripeSignature,
} from "./support";

afterEach(async () => {
  restoreFetch();
  await resetStripeBook();
});

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function gateHits(name: string): Promise<number> {
  const stub = env.PURCHASE_GATE.getByName(name);
  return runInDurableObject(stub, async (_instance, state) => {
    return state.storage.transactionSync(() => (state.storage.kv.get<number[]>("hits") ?? []).length);
  });
}

async function fillHits(name: string, count: number, now = Date.now()): Promise<void> {
  const stub = env.PURCHASE_GATE.getByName(name);
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.transactionSync(() => {
      state.storage.kv.put(
        "hits",
        Array.from({ length: count }, () => now),
      );
    });
  });
}

async function sessionCacheExp(sessionId: string): Promise<number | null> {
  const stub = env.PURCHASE_GATE.getByName(STRIPE_LOOKUP_GATE);
  return runInDurableObject(stub, async (_instance, state) => {
    return state.storage.transactionSync(() => {
      const raw = state.storage.kv.get<{ exp?: unknown }>(`sv:${sessionId}`);
      return raw && typeof raw.exp === "number" ? raw.exp : null;
    });
  });
}

async function expireSessionCache(sessionId: string): Promise<void> {
  const stub = env.PURCHASE_GATE.getByName(STRIPE_LOOKUP_GATE);
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.transactionSync(() => {
      const raw = state.storage.kv.get<Record<string, unknown>>(`sv:${sessionId}`);
      if (!raw) return;
      state.storage.kv.put(`sv:${sessionId}`, { ...raw, exp: Date.now() - 1 });
    });
  });
}

async function resetStripeBook(): Promise<void> {
  const stub = env.PURCHASE_GATE.getByName(STRIPE_LOOKUP_GATE);
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.transactionSync(() => {
      state.storage.kv.delete("hits");
      state.storage.kv.delete("expandForbiddenUntil");
      state.storage.kv.delete("svCursor");
      const keys: string[] = [];
      for (const [key] of state.storage.kv.list({ prefix: "sv:" })) keys.push(key);
      for (const key of keys) state.storage.kv.delete(key);
    });
  });
}

function headersOf(response: Response): string {
  return [...response.headers.entries()].map(([key, value]) => `${key}: ${value}`).join("\n");
}

describe("verified downloads", () => {
  it("serves the site and keeps the old thanks pages", async () => {
    const home = await SELF.fetch(request("/", nextIp()));
    expect(home.status).toBe(200);
    expect(home.headers.get("x-content-type-options")).toBe("nosniff");
    expect(home.headers.get("x-frame-options")).toBe("DENY");
    expect(home.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(home.headers.get("content-security-policy")).toContain("font-src 'self'");
    expect(home.headers.get("content-security-policy")).not.toContain("fonts.googleapis.com");
    expect(home.headers.get("content-security-policy")).not.toContain("fonts.gstatic.com");
    expect(home.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(home.headers.get("strict-transport-security")).not.toContain("preload");
    expect(await home.text()).toContain("NixonMade");

    const fieldThanks = await SELF.fetch(request("/field-kit/thanks/", nextIp()));
    expect(fieldThanks.status).toBe(200);
    const fieldHtml = await fieldThanks.text();
    expect(fieldHtml).toContain("Bookmark that");
    expect(fieldHtml).not.toContain("Check your email for the download link");

    const shipThanks = await SELF.fetch(request("/ship-kit/thanks/", nextIp()));
    expect(await shipThanks.text()).toContain("re-download page");

    const config = await SELF.fetch(request("/field-kit/config.js", nextIp()));
    const source = await config.text();
    expect(source).not.toMatch(/rk_(test|live)_/);
    expect(source).not.toMatch(/sk_(test|live)_/);
    expect(source).not.toMatch(/whsec_/);
  });

  it("redirects a legacy thanks URL only to this site", async () => {
    const ip = nextIp();
    const redirected = await SELF.fetch(
      request(`/field-kit/thanks/?session_id=${FIELD_SESSION}&next=https://evil.example`, ip),
    );
    expect(redirected.status).toBe(302);
    expect(redirected.headers.get("location")).toBe(`/thanks?session_id=${FIELD_SESSION}`);
    expect(redirected.headers.get("cache-control")).toBe("no-store");

    const ship = await SELF.fetch(
      request("/ship-kit/thanks/index.html?session_id=cs_test_shipkitlegacy01", nextIp()),
    );
    expect(ship.headers.get("location")).toBe("/thanks?session_id=cs_test_shipkitlegacy01");

    const open = await SELF.fetch(
      request("/field-kit/thanks/?session_id=https://evil.example", nextIp()),
    );
    expect(open.status).toBe(200);
    expect(open.headers.get("location")).toBeNull();
    expect(await open.text()).toContain("Bookmark that");
  });

  it("returns a short-lived file URL for a paid allowlisted session and hides the buyer", async () => {
    const calls = installStripe({ [FIELD_SESSION]: paidSession() });
    await putProduct("products/field-kit.zip", "field-kit-zip");
    const ip = nextIp();
    const response = await SELF.fetch(request(`/api/download?session_id=${FIELD_SESSION}`, ip));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'none'");
    const body = (await response.json()) as {
      product: string;
      title: string;
      downloads_remaining: number;
      files: { filename: string; url: string }[];
    };
    expect(body.product).toBe("field-kit");
    expect(body.title).toBe("Field Kit");
    expect(body.downloads_remaining).toBe(5);
    expect(body.files[0]?.filename).toBe("nixonmade-field-kit.zip");
    expect(JSON.stringify(body)).not.toContain("buyer@example.com");
    expect(JSON.stringify(body)).not.toContain(FIELD_SESSION);
    expect(calls.calls[0]).toContain(encodeURIComponent(FIELD_SESSION));

    const file = await SELF.fetch(request(body.files[0]!.url, ip));
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toBe(
      'attachment; filename="nixonmade-field-kit.zip"',
    );
    expect(file.headers.get("content-type")).toBe("application/zip");
    expect(file.headers.get("cache-control")).toBe("no-store");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(headersOf(file)).not.toContain(FIELD_SESSION);
    expect(new TextDecoder().decode(await file.arrayBuffer())).toBe("field-kit-zip");

    const page = await SELF.fetch(request(`/thanks?session_id=${FIELD_SESSION}`, ip));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Field Kit is ready");
    expect(page.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(page.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(page.headers.get("strict-transport-security")).not.toContain("preload");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(html).not.toContain("buyer@example.com");
    expect(html).not.toContain("<script");
  });

  it("delivers ship kit and fleet sheets from their own allowlist entries", async () => {
    const shipId = "cs_test_shipdfypaid00001";
    const fleetId = "cs_test_fleetpaid0000001";
    installStripe({
      [shipId]: paidSession({
        id: shipId,
        payment_intent: "pi_shipdfyintent0001",
        payment_link: "plink_shipdfytest",
        line_items: { data: [{ price: { id: "price_shipdfytest" } }] },
      }),
      [fleetId]: paidSession({
        id: fleetId,
        payment_intent: "pi_fleetintent000001",
        payment_link: null,
        line_items: { data: [{ price: "price_fleettest01" }] },
      }),
    });
    await putProduct("products/ship-kit.zip", "ship");
    await putProduct("products/fleet-sheets.dmg", "fleet-dmg");

    const ship = await SELF.fetch(request(`/api/download?session_id=${shipId}`, nextIp()));
    expect(ship.status).toBe(200);
    const shipBody = (await ship.json()) as { product: string; files: { url: string }[] };
    expect(shipBody.product).toBe("ship-kit");
    const shipFile = await SELF.fetch(request(shipBody.files[0]!.url, nextIp()));
    expect(shipFile.headers.get("content-type")).toBe("application/zip");
    expect(shipFile.headers.get("content-disposition")).toBe(
      'attachment; filename="nixonmade-ship-kit.zip"',
    );

    const fleet = await SELF.fetch(request(`/api/download?session_id=${fleetId}`, nextIp()));
    expect(fleet.status).toBe(200);
    const fleetBody = (await fleet.json()) as {
      product: string;
      files: { filename: string; url: string }[];
    };
    expect(fleetBody.product).toBe("fleet-sheets");
    expect(fleetBody.files[0]?.filename).toBe("nixonmade-fleet-sheets.dmg");
    const fleetFile = await SELF.fetch(request(fleetBody.files[0]!.url, nextIp()));
    expect(fleetFile.status).toBe(200);
    expect(fleetFile.headers.get("content-type")).toBe("application/x-apple-diskimage");
    expect(fleetFile.headers.get("content-disposition")).toBe(
      'attachment; filename="nixonmade-fleet-sheets.dmg"',
    );
    expect(new TextDecoder().decode(await fleetFile.arrayBuffer())).toBe("fleet-dmg");
  });

  it("delivers toolwarden as a pkg and serves its thanks routes", async () => {
    const id = "cs_test_toolwardenpaid01";
    installStripe({
      [id]: paidSession({
        id,
        payment_intent: "pi_toolwardenintent01",
        payment_link: "plink_toolwardentest01",
        line_items: { data: [{ price: { id: "price_toolwardentest01" } }] },
      }),
    });
    await putProduct("Toolwarden-0.2.0.pkg", "tw-pkg");

    const res = await SELF.fetch(request(`/api/download?session_id=${id}`, nextIp()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { product: string; files: { filename: string; url: string }[] };
    expect(body.product).toBe("toolwarden");
    expect(body.files[0]?.filename).toBe("toolwarden-0.2.0.pkg");
    const file = await SELF.fetch(request(body.files[0]!.url, nextIp()));
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/octet-stream");
    expect(file.headers.get("content-disposition")).toBe('attachment; filename="toolwarden-0.2.0.pkg"');
    expect(new TextDecoder().decode(await file.arrayBuffer())).toBe("tw-pkg");

    const page = await SELF.fetch(request("/toolwarden/thanks/", nextIp()));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Toolwarden");
    // The static host canonicalizes the other two spellings to the slash form.
    for (const path of ["/toolwarden/thanks", "/toolwarden/thanks/index.html"]) {
      const alias = await SELF.fetch(request(path, nextIp()));
      expect(alias.status).toBe(307);
      expect(alias.headers.get("location")).toMatch(/\/toolwarden\/thanks\/$/);
    }
    const redirected = await SELF.fetch(
      request(`/toolwarden/thanks/?session_id=${id}&next=https://evil.example`, nextIp()),
    );
    expect(redirected.status).toBe(302);
    expect(redirected.headers.get("location")).toBe(`/thanks?session_id=${id}`);
  });

  it("uses the same response for bad, unpaid, expired, unknown, and cross-mode sessions", async () => {
    const unpaid = "cs_test_unpaidsession001";
    const expired = "cs_test_expiredsession01";
    const unknown = "cs_test_unknownproduct01";
    const liveShape = "cs_test_livemodeclash001";
    const calls = installStripe({
      [unpaid]: paidSession({ id: unpaid, payment_status: "unpaid", payment_intent: "pi_unpaidintent00001" }),
      [expired]: paidSession({ id: expired, status: "expired", payment_intent: "pi_expiredintent0001" }),
      [unknown]: paidSession({
        id: unknown,
        payment_intent: "pi_unknownintent0001",
        payment_link: null,
        line_items: { data: [{ price: "price_notlisted01" }] },
      }),
      [liveShape]: paidSession({
        id: liveShape,
        livemode: true,
        payment_intent: "pi_livemodeintent001",
      }),
    });
    await putProduct("products/field-kit.zip", "field-kit-zip");

    const paths = [
      `/api/download?session_id=${unpaid}`,
      `/api/download?session_id=${expired}`,
      `/api/download?session_id=${unknown}`,
      `/api/download?session_id=${liveShape}`,
      "/api/download?session_id=not-a-session",
      "/api/download?session_id=cs_live_shouldnotfetch1",
      "/thanks?session_id=cs_test_nope",
    ];
    const bodies: string[] = [];
    for (const path of paths) {
      const response = await SELF.fetch(request(path, nextIp()));
      expect(response.status).toBe(404);
      bodies.push(await response.text());
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(new Set(bodies.filter((body) => body.startsWith("{"))).size).toBe(1);
    for (const body of bodies) {
      expect(body).not.toContain("buyer@example.com");
      expect(body).not.toContain("expired");
      expect(body).not.toContain("unpaid");
      expect(body).not.toContain("No such checkout.session");
    }
    expect(calls.calls.some((url) => url.includes("cs_live_"))).toBe(false);
    expect(calls.calls.some((url) => url.includes("not-a-session"))).toBe(false);
  });

  it("does not put a thrown Stripe error into the response or the log", async () => {
    installStripe(() => {
      throw new Error(`network down ${FIELD_SESSION} rk_test_unit_test_key_not_real_0001`);
    });
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    const response = await SELF.fetch(request(`/api/download?session_id=${FIELD_SESSION}`, nextIp()));
    console.log = original;
    expect(response.status).toBe(404);
    const text = await response.text();
    expect(text).not.toContain(FIELD_SESSION);
    expect(text).not.toContain("rk_test_");
    expect(lines.join("\n")).not.toContain(FIELD_SESSION);
    expect(lines.join("\n")).not.toContain("rk_test_");
    expect(lines.join("\n")).toContain("stripe_network");
  });

  it("stops at five downloads even when the requests arrive together", async () => {
    const sessionId = "cs_test_limitrace0000001";
    installStripe({
      [sessionId]: paidSession({
        id: sessionId,
        payment_intent: "pi_limitraceintent01",
      }),
    });
    await putProduct("products/field-kit.zip", "field-kit-zip");
    const ip = nextIp();
    const urls: string[] = [];
    for (let i = 0; i < 6; i++) {
      const issued = await SELF.fetch(request(`/api/download?session_id=${sessionId}`, ip));
      expect(issued.status).toBe(200);
      const body = (await issued.json()) as { files: { url: string }[] };
      urls.push(body.files[0]!.url);
    }
    const files = await Promise.all(urls.map((url) => SELF.fetch(request(url, ip))));
    const statuses = files.map((file) => file.status).sort();
    expect(statuses.filter((status) => status === 200)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(1);
    const limited = files.find((file) => file.status === 429);
    expect(await limited?.text()).toContain("used its downloads");

    const again = await SELF.fetch(request(`/thanks?session_id=${sessionId}`, ip));
    expect(again.status).toBe(429);
    expect(await again.text()).toContain("used its 5 downloads");
  });

  it("does not count a missing object or an immediate retry", async () => {
    const sessionId = "cs_test_missingfile00001";
    await env.DOWNLOADS.delete("products/field-kit.zip");
    installStripe({
      [sessionId]: paidSession({
        id: sessionId,
        payment_intent: "pi_missingfileintent1",
      }),
    });
    const ip = nextIp();
    const missing = await SELF.fetch(request(`/thanks?session_id=${sessionId}`, ip));
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("not uploaded yet");

    await putProduct("products/field-kit.zip", "now-here");
    const issued = await SELF.fetch(request(`/api/download?session_id=${sessionId}`, ip));
    const body = (await issued.json()) as { downloads_remaining: number; files: { url: string }[] };
    expect(body.downloads_remaining).toBe(5);
    const first = await SELF.fetch(request(body.files[0]!.url, ip));
    const second = await SELF.fetch(request(body.files[0]!.url, ip));
    const third = await SELF.fetch(request(body.files[0]!.url, ip));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    const followUp = await SELF.fetch(request(`/api/download?session_id=${sessionId}`, ip));
    const followBody = (await followUp.json()) as { downloads_remaining: number };
    expect(followBody.downloads_remaining).toBe(3);
  });

  it("rejects an expired or tampered file link", async () => {
    installStripe({ [FIELD_SESSION]: paidSession() });
    await putProduct("products/field-kit.zip", "field-kit-zip");
    const ip = nextIp();
    const expired = await signDownloadToken(
      {
        v: 1,
        exp: Math.floor(Date.now() / 1000) - 5,
        jti: "expiredjti12345678",
        product: "field-kit",
        sid: FIELD_SESSION,
      },
      SIGNING_SECRET,
    );
    const expiredResponse = await SELF.fetch(request(`/api/file?t=${encodeURIComponent(expired)}`, ip));
    expect(expiredResponse.status).toBe(404);
    expect(await expiredResponse.text()).toBe("This download isn't available.\n");

    const issued = await SELF.fetch(request(`/api/download?session_id=${FIELD_SESSION}`, ip));
    const url = ((await issued.json()) as { files: { url: string }[] }).files[0]!.url;
    const token = new URL(`https://nixonmade.com${url}`).searchParams.get("t") ?? "";
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    const bad = await SELF.fetch(request(`/api/file?t=${encodeURIComponent(tampered)}`, ip));
    expect(bad.status).toBe(404);
    expect(await bad.text()).not.toContain(FIELD_SESSION);
  });

  it("blocks downloads after a signed refund webhook and ignores a bad signature", async () => {
    const sessionId = "cs_test_refundsession001";
    const intent = "pi_refundsession0001";
    installStripe({
      [sessionId]: paidSession({ id: sessionId, payment_intent: intent }),
    });
    await putProduct("products/field-kit.zip", "field-kit-zip");
    const ip = nextIp();
    const before = await SELF.fetch(request(`/api/download?session_id=${sessionId}`, ip));
    expect(before.status).toBe(200);
    const url = ((await before.json()) as { files: { url: string }[] }).files[0]!.url;

    const ignored = JSON.stringify({
      id: "evt_fail",
      type: "refund.updated",
      data: {
        object: {
          object: "refund",
          status: "failed",
          amount: 1900,
          payment_intent: intent,
          receipt_email: "buyer@example.com",
        },
      },
    });
    const ignoredPost = await SELF.fetch(
      request("/api/stripe/webhook", ip, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Stripe-Signature": await stripeSignature(ignored),
        },
        body: ignored,
      }),
    );
    expect(ignoredPost.status).toBe(200);
    expect(await SELF.fetch(request(url, ip))).toMatchObject({ status: 200 });

    const forged = await SELF.fetch(
      request("/api/stripe/webhook", ip, {
        method: "POST",
        headers: { "content-type": "application/json", "Stripe-Signature": "t=1,v1=abcd" },
        body: ignored,
      }),
    );
    expect(forged.status).toBe(400);
    expect(await forged.text()).not.toContain("buyer@example.com");

    const payload = JSON.stringify({
      id: "evt_refund",
      type: "charge.refunded",
      data: {
        object: {
          object: "charge",
          refunded: true,
          amount_refunded: 1900,
          payment_intent: intent,
          receipt_email: "buyer@example.com",
        },
      },
    });
    const posted = await SELF.fetch(
      request("/api/stripe/webhook", nextIp(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Stripe-Signature": await stripeSignature(payload),
        },
        body: payload,
      }),
    );
    expect(posted.status).toBe(200);
    expect(await posted.text()).toBe("");

    const file = await SELF.fetch(request(url, ip));
    expect(file.status).toBe(404);
    const thanks = await SELF.fetch(request(`/thanks?session_id=${sessionId}`, ip));
    expect(thanks.status).toBe(404);
    const html = await thanks.text();
    expect(html).toContain("couldn't open that purchase");
    expect(html).not.toContain("buyer@example.com");
    expect(html).not.toContain(sessionId);
  });

  it("rate limits one IP without blocking another, and one session without blocking another", async () => {
    const rateSession = "cs_test_ratelimit0000001";
    installStripe({
      [rateSession]: paidSession({
        id: rateSession,
        payment_intent: "pi_ratelimitintent001",
      }),
    });
    await putProduct("products/field-kit.zip", "field-kit-zip");
    const blockedIp = nextIp();
    const openIp = nextIp();
    const name = await hashName("ip", SIGNING_SECRET, blockedIp);
    const stub = env.PURCHASE_GATE.getByName(name);
    const now = Date.now();
    for (let i = 0; i < 60; i++) expect(await stub.hit(60, 60_000, now)).toBe(true);

    const limited = await SELF.fetch(request(`/api/download?session_id=${rateSession}`, blockedIp));
    expect(limited.status).toBe(429);
    const other = await SELF.fetch(request(`/api/download?session_id=${rateSession}`, openIp));
    expect(other.status).toBe(200);

    const cappedSession = "cs_test_sessioncap000001";
    const otherSession = "cs_test_otherrate0000001";
    installStripe({
      [rateSession]: paidSession({
        id: rateSession,
        payment_intent: "pi_ratelimitintent001",
      }),
      [cappedSession]: paidSession({
        id: cappedSession,
        payment_intent: "pi_sessioncapintent01",
      }),
      [otherSession]: paidSession({
        id: otherSession,
        payment_intent: "pi_otherrateintent01",
      }),
    });
    const sessionStub = env.PURCHASE_GATE.getByName(`session:${cappedSession}`);
    for (let i = 0; i < 20; i++) expect(await sessionStub.hit(20, 60_000, now)).toBe(true);
    const sessionLimited = await SELF.fetch(
      request(`/api/download?session_id=${cappedSession}`, nextIp()),
    );
    expect(sessionLimited.status).toBe(429);
    const stillOpen = await SELF.fetch(request(`/api/download?session_id=${otherSession}`, nextIp()));
    expect(stillOpen.status).toBe(200);
  });

  it("re-download accepts a session id and does not answer email probes", async () => {
    const ip = nextIp();
    const form = await SELF.fetch(request("/redownload", ip));
    expect(form.status).toBe(200);
    const html = await form.text();
    expect(html).toContain("does not ask for your email");
    expect(form.headers.get("content-security-policy")).toContain("form-action 'self'");
    expect(form.headers.get("cache-control")).toBe("no-store");

    async function post(sessionId: string, address: string): Promise<Response> {
      return SELF.fetch(
        request("/redownload", address, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ session_id: sessionId, email: "hidden@example.com" }).toString(),
        }),
      );
    }

    const first = await post("alice@example.com", nextIp());
    const second = await post("bob@example.com", nextIp());
    expect(first.status).toBe(400);
    expect(second.status).toBe(400);
    const firstText = await first.text();
    const secondText = await second.text();
    expect(firstText).toBe(secondText);
    expect(firstText).not.toContain("alice@example.com");
    expect(firstText).not.toContain("bob@example.com");
    expect(firstText).not.toContain("hidden@example.com");

    const script = await post("<script>alert(1)</script>", nextIp());
    expect(await script.text()).not.toContain("<script>alert");

    const evil = await post("https://evil.example/steal?session_id=cs_test_abcdefghij", nextIp());
    expect(evil.status).toBe(400);
    expect(evil.headers.get("location")).toBeNull();
    expect(await evil.text()).not.toContain("evil.example");

    const pasted = await post(`https://nixonmade.com/thanks?session_id=${FIELD_SESSION}`, nextIp());
    expect(pasted.status).toBe(303);
    expect(pasted.headers.get("location")).toBe(`/thanks?session_id=${FIELD_SESSION}`);

    const bare = await post("cs_test_redownload00001", nextIp());
    expect(bare.headers.get("location")).toBe("/thanks?session_id=cs_test_redownload00001");
  });

  it("rejects a missing client address and shares an IPv6 /64", async () => {
    const sessionId = "cs_test_ipv6bucket000001";
    installStripe({
      [sessionId]: paidSession({ id: sessionId, payment_intent: "pi_ipv6bucketintent01" }),
    });
    await putProduct("products/field-kit.zip", "field-kit-zip");
    const missing = () =>
      new Request(`https://nixonmade.com/api/download?session_id=${sessionId}`, { method: "GET" });
    expect((await SELF.fetch(missing())).status).toBe(429);
    expect((await SELF.fetch(missing())).status).toBe(429);

    const bucket = clientIp(
      new Request("https://nixonmade.com/", { headers: { "CF-Connecting-IP": "2001:db8:9:9::1" } }),
    );
    expect(bucket).toBeTruthy();
    const stub = env.PURCHASE_GATE.getByName(await hashName("ip", SIGNING_SECRET, bucket!));
    const now = Date.now();
    for (let i = 0; i < 60; i++) expect(await stub.hit(60, 60_000, now)).toBe(true);
    const samePrefix = await SELF.fetch(
      request(`/api/download?session_id=${sessionId}`, "2001:db8:9:9::abcd"),
    );
    expect(samePrefix.status).toBe(429);
    const otherPrefix = await SELF.fetch(
      request(`/api/download?session_id=${sessionId}`, "2001:db8:9:a::1"),
    );
    expect(otherPrefix.status).toBe(200);
  });

  it("blocks a refunded latest charge and falls back when expand is forbidden", async () => {
    const refundedId = "cs_test_chargerefund0001";
    installStripe({
      [refundedId]: paidSession({
        id: refundedId,
        payment_intent: {
          id: "pi_chargerefund00001",
          object: "payment_intent",
          latest_charge: { object: "charge", refunded: true, amount_refunded: 1900 },
        },
      }),
    });
    await putProduct("products/field-kit.zip", "field-kit-zip");
    const blocked = await SELF.fetch(request(`/api/download?session_id=${refundedId}`, nextIp()));
    expect(blocked.status).toBe(404);

    const calls: string[] = [];
    const plainId = "cs_test_expandforbid0001";
    installStripe((url) => {
      calls.push(url);
      if (url.includes("payment_intent")) return new Response("nope", { status: 403 });
      if (!url.includes(plainId)) return new Response("{}", { status: 404 });
      return new Response(
        JSON.stringify(paidSession({ id: plainId, payment_intent: "pi_expandforbid00001" })),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const allowed = await SELF.fetch(request(`/api/download?session_id=${plainId}`, nextIp()));
    expect(allowed.status).toBe(200);
    expect(calls.some((url) => url.includes("payment_intent.latest_charge"))).toBe(true);
    expect(calls.some((url) => url.includes("expand[]=line_items") && !url.includes("payment_intent"))).toBe(
      true,
    );
  });

  it("revokes a download when a dispute is opened or funds are withdrawn", async () => {
    const sessionId = "cs_test_disputeopen00001";
    const intent = "pi_disputeopen000001";
    installStripe({
      [sessionId]: paidSession({ id: sessionId, payment_intent: intent }),
    });
    await putProduct("products/field-kit.zip", "field-kit-zip");
    const ip = nextIp();
    expect((await SELF.fetch(request(`/api/download?session_id=${sessionId}`, ip))).status).toBe(200);

    async function postDispute(type: string): Promise<Response> {
      const payload = JSON.stringify({
        id: "evt_dispute",
        type,
        data: { object: { object: "dispute", payment_intent: intent, status: "needs_response" } },
      });
      return SELF.fetch(
        request("/api/stripe/webhook", ip, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Stripe-Signature": await stripeSignature(payload),
          },
          body: payload,
        }),
      );
    }

    expect((await postDispute("charge.dispute.created")).status).toBe(200);
    expect((await SELF.fetch(request(`/thanks?session_id=${sessionId}`, ip))).status).toBe(404);

    const withdrawnId = "cs_test_disputefunds0001";
    const withdrawnIntent = "pi_disputefunds00001";
    installStripe({
      [withdrawnId]: paidSession({ id: withdrawnId, payment_intent: withdrawnIntent }),
    });
    expect((await SELF.fetch(request(`/api/download?session_id=${withdrawnId}`, ip))).status).toBe(200);
    const payload = JSON.stringify({
      id: "evt_funds",
      type: "charge.dispute.funds_withdrawn",
      data: { object: { object: "dispute", payment_intent: withdrawnIntent } },
    });
    expect(
      (
        await SELF.fetch(
          request("/api/stripe/webhook", ip, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "Stripe-Signature": await stripeSignature(payload),
            },
            body: payload,
          }),
        )
      ).status,
    ).toBe(200);
    expect((await SELF.fetch(request(`/api/download?session_id=${withdrawnId}`, ip))).status).toBe(404);
  });

  it("stops Stripe lookups after the global cap, including fake session ids", async () => {
    const limit = positiveInt(env.RATE_LIMIT_STRIPE_PER_MINUTE, DEFAULT_STRIPE_LIMIT);
    expect(limit).toBe(300);
    await fillHits(STRIPE_LOOKUP_GATE, limit);
    const calls = installStripe({ [FIELD_SESSION]: paidSession() });
    const response = await SELF.fetch(request(`/api/download?session_id=${FIELD_SESSION}`, nextIp()));
    expect(response.status).toBe(429);
    expect(calls.calls).toHaveLength(0);
    const fake = await SELF.fetch(request("/api/download?session_id=cs_test_fakeglobal000001", nextIp()));
    expect(fake.status).toBe(429);
    expect(calls.calls).toHaveLength(0);
  });

  it("spends the per-IP Stripe cap before the shared cap", async () => {
    expect(env.RATE_LIMIT_STRIPE_IP_PER_MINUTE).toBe("10");
    const ip = nextIp();
    const name = await hashName(STRIPE_IP_LABEL, SIGNING_SECRET, ip);
    await fillHits(name, DEFAULT_STRIPE_IP_LIMIT);
    const before = await gateHits(STRIPE_LOOKUP_GATE);
    const sessionId = "cs_test_ipcapblocks00001";
    const calls = installStripe({
      [sessionId]: paidSession({ id: sessionId, payment_intent: "pi_ipcapblocks000001" }),
    });
    const response = await SELF.fetch(request(`/api/download?session_id=${sessionId}`, ip));
    expect(response.status).toBe(429);
    expect(await response.text()).not.toContain(sessionId);
    expect(calls.calls).toHaveLength(0);
    expect(await gateHits(STRIPE_LOOKUP_GATE)).toBe(before);
  });

  it("does not let one IP's fake session ids lock out another buyer", async () => {
    const stripeIpLimit = positiveInt(env.RATE_LIMIT_STRIPE_IP_PER_MINUTE, DEFAULT_STRIPE_IP_LIMIT);
    const globalLimit = positiveInt(env.RATE_LIMIT_STRIPE_PER_MINUTE, DEFAULT_STRIPE_LIMIT);
    expect(stripeIpLimit).toBe(10);
    expect(globalLimit).toBe(300);
    const flood = stripeIpLimit + 25;
    expect(flood).toBeLessThan(60);
    // Leave room for this IP's cap plus the buyer, and not for the whole flood.
    // A shared cap spent first would be full before the buyer's /thanks.
    const prefill = globalLimit - stripeIpLimit - 2;
    const now = Date.now();
    await fillHits(STRIPE_LOOKUP_GATE, prefill, now);

    const attacker = nextIp();
    const buyer = nextIp();
    const buyerSession = "cs_test_buyerkeepsopen01";
    const calls = installStripe((url) => {
      const id = decodeURIComponent(url.split("/checkout/sessions/")[1]?.split("?")[0] ?? "");
      if (id !== buyerSession) return new Response("{}", { status: 404 });
      return new Response(
        JSON.stringify(paidSession({ id: buyerSession, payment_intent: "pi_buyerkeepsopen001" })),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    await putProduct("products/field-kit.zip", "field-kit-zip");

    const statuses: number[] = [];
    for (let i = 0; i < flood; i++) {
      const id = `cs_test_fakeflood${i.toString(36).padStart(8, "0")}`;
      const response = await SELF.fetch(request(`/api/download?session_id=${id}`, attacker));
      statuses.push(response.status);
      expect(await response.text()).not.toContain(id);
    }
    expect(statuses.slice(0, stripeIpLimit).every((status) => status === 404)).toBe(true);
    expect(statuses.slice(stripeIpLimit).every((status) => status === 429)).toBe(true);
    expect(calls.calls.filter((url) => !url.includes(buyerSession))).toHaveLength(stripeIpLimit);

    const thanks = await SELF.fetch(request(`/thanks?session_id=${buyerSession}`, buyer));
    expect(thanks.status).toBe(200);
    expect(await thanks.text()).toContain("You're in.");
    const issued = await SELF.fetch(request(`/api/download?session_id=${buyerSession}`, buyer));
    expect(issued.status).toBe(200);
    const url = ((await issued.json()) as { files: { url: string }[] }).files[0]!.url;
    const file = await SELF.fetch(request(url, buyer));
    expect(file.status).toBe(200);
    expect(calls.calls.filter((url) => url.includes(buyerSession))).toHaveLength(1);
    expect(await gateHits(STRIPE_LOOKUP_GATE)).toBe(prefill + stripeIpLimit + 1);
  });

  it("remembers a forbidden expand and skips it on the next lookup", async () => {
    const first = "cs_test_expandmemo000001";
    const second = "cs_test_expandmemo000002";
    const calls: string[] = [];
    installStripe((url) => {
      calls.push(url);
      if (url.includes("payment_intent")) return new Response("nope", { status: 403 });
      const id = decodeURIComponent(url.split("/checkout/sessions/")[1]?.split("?")[0] ?? "");
      if (id !== first && id !== second) return new Response("{}", { status: 404 });
      const intent = id === first ? "pi_expandmemo0000001" : "pi_expandmemo0000002";
      return new Response(JSON.stringify(paidSession({ id, payment_intent: intent })), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await putProduct("products/field-kit.zip", "field-kit-zip");
    const book = env.PURCHASE_GATE.getByName(STRIPE_LOOKUP_GATE);
    expect(await book.expandForbidden()).toBe(false);

    const opened = await SELF.fetch(request(`/api/download?session_id=${first}`, nextIp()));
    expect(opened.status).toBe(200);
    await opened.text();
    const firstCalls = calls.filter((url) => url.includes(first));
    expect(firstCalls).toHaveLength(2);
    expect(firstCalls.some((url) => url.includes("payment_intent.latest_charge"))).toBe(true);
    expect(await book.expandForbidden()).toBe(true);

    calls.length = 0;
    const next = await SELF.fetch(request(`/api/download?session_id=${second}`, nextIp()));
    expect(next.status).toBe(200);
    await next.text();
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain("payment_intent");
    expect(calls[0]).toContain("expand[]=line_items");
  });

  it("does not call Stripe again for a session it already checked", async () => {
    const sessionId = "cs_test_cachedvalid00001";
    const fake = "cs_test_cachedinvalid001";
    const calls = installStripe({
      [sessionId]: paidSession({ id: sessionId, payment_intent: "pi_cachedvalid000001" }),
    });
    await putProduct("products/field-kit.zip", "field-kit-zip");

    const first = await SELF.fetch(request(`/api/download?session_id=${sessionId}`, nextIp()));
    expect(first.status).toBe(200);
    await first.text();
    const afterValid = calls.calls.length;
    expect(afterValid).toBeGreaterThan(0);
    const sharedBefore = await gateHits(STRIPE_LOOKUP_GATE);

    const second = await SELF.fetch(request(`/api/download?session_id=${sessionId}`, nextIp()));
    expect(second.status).toBe(200);
    await second.text();
    expect(calls.calls.length).toBe(afterValid);
    expect(await gateHits(STRIPE_LOOKUP_GATE)).toBe(sharedBefore);

    const missed = await SELF.fetch(request(`/api/download?session_id=${fake}`, nextIp()));
    expect(missed.status).toBe(404);
    await missed.text();
    const afterFake = calls.calls.length;
    expect(afterFake).toBe(afterValid + 1);

    const again = await SELF.fetch(request(`/api/download?session_id=${fake}`, nextIp()));
    expect(again.status).toBe(404);
    await again.text();
    expect(calls.calls.length).toBe(afterFake);
  });

  it("remembers an unpaid session and a parse error for 30 seconds", async () => {
    expect(SESSION_CACHE_SHORT_TTL_MS).toBe(30_000);
    const unpaid = "cs_test_unpaidshort00001";
    const broken = "cs_test_parseshort000001";
    const missing = "cs_test_missinglong00001";
    const calls = installStripe((url) => {
      const id = decodeURIComponent(url.split("/checkout/sessions/")[1]?.split("?")[0] ?? "");
      if (id === unpaid) {
        return new Response(
          JSON.stringify(
            paidSession({
              id: unpaid,
              payment_status: "unpaid",
              payment_intent: "pi_unpaidshort0000001",
            }),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (id === broken) return new Response("not-json", { status: 200 });
      return new Response("{}", { status: 404 });
    });

    async function fetchOnce(sessionId: string): Promise<number> {
      const response = await SELF.fetch(request(`/api/download?session_id=${sessionId}`, nextIp()));
      const status = response.status;
      expect(await response.text()).not.toContain(sessionId);
      return status;
    }

    expect(await fetchOnce(unpaid)).toBe(404);
    const afterUnpaid = calls.calls.length;
    expect(afterUnpaid).toBeGreaterThan(0);
    expect(await fetchOnce(unpaid)).toBe(404);
    expect(calls.calls.length).toBe(afterUnpaid);
    const unpaidExp = await sessionCacheExp(unpaid);
    expect(unpaidExp).not.toBeNull();
    const unpaidLeft = (unpaidExp ?? 0) - Date.now();
    expect(unpaidLeft).toBeGreaterThan(20_000);
    expect(unpaidLeft).toBeLessThanOrEqual(SESSION_CACHE_SHORT_TTL_MS);

    await expireSessionCache(unpaid);
    expect(await fetchOnce(unpaid)).toBe(404);
    expect(calls.calls.length).toBe(afterUnpaid + 1);

    const beforeParse = calls.calls.length;
    expect(await fetchOnce(broken)).toBe(404);
    expect(calls.calls.length).toBe(beforeParse + 1);
    expect(await fetchOnce(broken)).toBe(404);
    expect(calls.calls.length).toBe(beforeParse + 1);
    const parseLeft = (await sessionCacheExp(broken) ?? 0) - Date.now();
    expect(parseLeft).toBeGreaterThan(20_000);
    expect(parseLeft).toBeLessThanOrEqual(SESSION_CACHE_SHORT_TTL_MS);

    const beforeMissing = calls.calls.length;
    expect(await fetchOnce(missing)).toBe(404);
    expect(calls.calls.length).toBe(beforeMissing + 1);
    expect(await fetchOnce(missing)).toBe(404);
    expect(calls.calls.length).toBe(beforeMissing + 1);
    const missingLeft = (await sessionCacheExp(missing) ?? 0) - Date.now();
    expect(missingLeft).toBeGreaterThan(SESSION_CACHE_TTL_MS - 5_000);
    expect(missingLeft).toBeLessThanOrEqual(SESSION_CACHE_TTL_MS);
  });

  it("does not put a thrown Stripe body read into the response or the log", async () => {
    const sessionId = "cs_test_bodyread00000001";
    installStripe(() => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error(`stream broke ${sessionId} rk_test_bodyreadleak`));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    });
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    const response = await SELF.fetch(request(`/api/download?session_id=${sessionId}`, nextIp()));
    console.log = original;
    expect(response.status).toBe(404);
    const text = await response.text();
    expect(text).not.toContain(sessionId);
    expect(text).not.toContain("rk_test_");
    expect(lines.join("\n")).toContain("stripe_body_read");
    expect(lines.join("\n")).not.toContain(sessionId);
    expect(lines.join("\n")).not.toContain("rk_test_");
  });

  it("rejects a re-download body over the size cap", async () => {
    const response = await SELF.fetch(
      request("/redownload", nextIp(), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `session_id=${"a".repeat(5000)}`,
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("a".repeat(50));
  });
});
