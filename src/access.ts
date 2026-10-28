import type { Env } from "./env";
import { PurchaseGate } from "./gate";
import { clientIp, hashName, readPositiveInt } from "./http";
import { safeLog } from "./log";
import { loadCatalog, matchProduct, type CatalogProduct } from "./products";
import {
  newJti,
  sessionMode,
  SESSION_ID_RE,
  signDownloadToken,
  signingSecretOk,
  verifyDownloadToken,
  type DownloadToken,
} from "./sign";
import { restrictedKeyMode, retrieveCheckoutSession, type CheckoutSession } from "./stripe";

export const DEFAULT_LIMIT = 5;
export const DEFAULT_TTL_SECONDS = 900;
export const DEFAULT_IP_LIMIT = 60;
export const DEFAULT_SESSION_LIMIT = 20;
export const DEFAULT_STRIPE_LIMIT = 120;
export const STRIPE_LOOKUP_GATE = "stripe:global";

export type IssuedDownload = {
  product: CatalogProduct;
  token: string;
  filePath: string;
  expiresAt: string;
  remaining: number;
  limit: number;
  ttlMinutes: number;
};

export type AccessFailure =
  | { error: "unavailable" }
  | { error: "rate" }
  | { error: "limit"; limit: number }
  | { error: "missing"; title: string };

export function downloadLimit(env: Env): number {
  return readPositiveInt(env.DOWNLOAD_LIMIT, DEFAULT_LIMIT, 1, 50);
}

export function ttlSeconds(env: Env): number {
  return readPositiveInt(env.DOWNLOAD_TTL_SECONDS, DEFAULT_TTL_SECONDS, 60, 3600);
}

function ipLimit(env: Env): number {
  return readPositiveInt(env.RATE_LIMIT_IP_PER_MINUTE, DEFAULT_IP_LIMIT, 1, 1000);
}

function sessionLimit(env: Env): number {
  return readPositiveInt(env.RATE_LIMIT_SESSION_PER_MINUTE, DEFAULT_SESSION_LIMIT, 1, 1000);
}

function stripeLimit(env: Env): number {
  return readPositiveInt(env.RATE_LIMIT_STRIPE_PER_MINUTE, DEFAULT_STRIPE_LIMIT, 1, 5000);
}

export function secretsForDownload(env: Env): boolean {
  return restrictedKeyMode(env.STRIPE_RESTRICTED_KEY) !== null && signingSecretOk(env.DOWNLOAD_SIGNING_SECRET);
}

function gate(env: Env, name: string): DurableObjectStub<PurchaseGate> {
  return env.PURCHASE_GATE.getByName(name);
}

export async function allowIp(request: Request, env: Env): Promise<boolean> {
  const secret = env.DOWNLOAD_SIGNING_SECRET;
  if (!signingSecretOk(secret)) return false;
  const ip = clientIp(request);
  if (!ip) return false;
  const name = await hashName("ip", secret, ip);
  return gate(env, name).hit(ipLimit(env), 60_000);
}

/** One worker-wide cap on Checkout Session reads. Fake session ids share it. */
export async function allowStripeLookups(env: Env): Promise<boolean> {
  return gate(env, STRIPE_LOOKUP_GATE).hit(stripeLimit(env), 60_000);
}

async function allowSession(env: Env, sessionId: string): Promise<boolean> {
  return gate(env, `session:${sessionId}`).hit(sessionLimit(env), 60_000);
}

async function refunded(env: Env, paymentIntentId: string): Promise<boolean> {
  return gate(env, `pi:${paymentIntentId}`).isRefunded();
}

export async function markPaymentRefunded(env: Env, paymentIntentId: string): Promise<void> {
  await gate(env, `pi:${paymentIntentId}`).markRefunded();
}

async function verifiedSession(
  env: Env,
  sessionId: string,
): Promise<
  | { ok: true; session: CheckoutSession; product: CatalogProduct }
  | { ok: false; error: "rate" | "unavailable" }
> {
  const key = env.STRIPE_RESTRICTED_KEY;
  if (!key) return { ok: false, error: "unavailable" };
  const lookup = await retrieveCheckoutSession(sessionId, key, () => allowStripeLookups(env));
  if (!lookup.ok) return { ok: false, error: lookup.rateLimited ? "rate" : "unavailable" };
  if (lookup.session.chargeRefunded) {
    await markPaymentRefunded(env, lookup.session.paymentIntentId);
    return { ok: false, error: "unavailable" };
  }
  if (await refunded(env, lookup.session.paymentIntentId)) return { ok: false, error: "unavailable" };
  const product = matchProduct(loadCatalog(env), {
    livemode: lookup.session.livemode,
    paymentLinkId: lookup.session.paymentLinkId,
    priceIds: lookup.session.priceIds,
  });
  if (!product) return { ok: false, error: "unavailable" };
  const mode = sessionMode(sessionId);
  if (!mode) return { ok: false, error: "unavailable" };
  if ((lookup.session.livemode ? "live" : "test") !== mode) return { ok: false, error: "unavailable" };
  return { ok: true, session: lookup.session, product };
}

export async function issueDownload(
  request: Request,
  env: Env,
  sessionId: string,
  nowMs = Date.now(),
): Promise<{ ok: true; download: IssuedDownload } | ({ ok: false } & AccessFailure)> {
  if (!secretsForDownload(env)) {
    safeLog("secrets_incomplete");
    return { ok: false, error: "unavailable" };
  }
  if (!SESSION_ID_RE.test(sessionId)) return { ok: false, error: "unavailable" };
  if (!(await allowIp(request, env))) return { ok: false, error: "rate" };

  const verified = await verifiedSession(env, sessionId);
  if (!verified.ok) return { ok: false, error: verified.error };
  if (!(await allowSession(env, sessionId))) return { ok: false, error: "rate" };

  const head = await env.DOWNLOADS.head(verified.product.key);
  if (!head) return { ok: false, error: "missing", title: verified.product.title };

  const limit = downloadLimit(env);
  const remaining = await gate(env, `session:${sessionId}`).remaining(limit);
  if (remaining < 1) return { ok: false, error: "limit", limit };

  const secret = env.DOWNLOAD_SIGNING_SECRET;
  if (!signingSecretOk(secret)) return { ok: false, error: "unavailable" };
  const ttl = ttlSeconds(env);
  const exp = Math.floor(nowMs / 1000) + ttl;
  const payload: DownloadToken = {
    v: 1,
    exp,
    jti: newJti(),
    product: verified.product.slug,
    sid: sessionId,
  };
  const token = await signDownloadToken(payload, secret);
  return {
    ok: true,
    download: {
      product: verified.product,
      token,
      filePath: `/api/file?t=${encodeURIComponent(token)}`,
      expiresAt: new Date(exp * 1000).toISOString(),
      remaining,
      limit,
      ttlMinutes: Math.round(ttl / 60),
    },
  };
}

export async function openSignedFile(
  request: Request,
  env: Env,
  token: string,
  nowMs = Date.now(),
): Promise<
  | {
      ok: true;
      body: ReadableStream;
      size: number;
      filename: string;
      mediaType: string;
      contentDisposition: string;
    }
  | ({ ok: false } & AccessFailure)
> {
  if (!secretsForDownload(env)) {
    safeLog("secrets_incomplete");
    return { ok: false, error: "unavailable" };
  }
  if (!(await allowIp(request, env))) return { ok: false, error: "rate" };
  const secret = env.DOWNLOAD_SIGNING_SECRET;
  if (!signingSecretOk(secret)) return { ok: false, error: "unavailable" };
  const payload = await verifyDownloadToken(token, secret, nowMs);
  if (!payload) return { ok: false, error: "unavailable" };
  if (!(await allowSession(env, payload.sid))) return { ok: false, error: "rate" };

  const verified = await verifiedSession(env, payload.sid);
  if (!verified.ok) return { ok: false, error: verified.error };
  if (verified.product.slug !== payload.product) {
    return { ok: false, error: "unavailable" };
  }

  const limit = downloadLimit(env);
  const sessionGate = gate(env, `session:${payload.sid}`);
  const counted = await sessionGate.consume(payload.jti, limit, nowMs);
  if (counted === "limit") return { ok: false, error: "limit", limit };

  const object = await env.DOWNLOADS.get(verified.product.key);
  if (!object) {
    if (counted === "ok") await sessionGate.rollback(payload.jti);
    return { ok: false, error: "missing", title: verified.product.title };
  }
  return {
    ok: true,
    body: object.body,
    size: object.size,
    filename: verified.product.filename,
    mediaType: verified.product.mediaType,
    contentDisposition: verified.product.contentDisposition,
  };
}
