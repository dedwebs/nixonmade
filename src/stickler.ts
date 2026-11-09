import type { Env } from "./env";
import {
  applySecurityHeaders,
  clientIp,
  hashName,
  htmlResponse,
  readPositiveInt,
  redirectResponse,
  textResponse,
} from "./http";
import { safeLog } from "./log";
import { freeBusyPage, freeUnavailablePage, supportUnavailablePage } from "./pages";
import { loadFreeProduct } from "./products";
import { signingSecretOk } from "./sign";

export const DEFAULT_FREE_IP_PER_HOUR = 10;
export const DEFAULT_FREE_PER_DAY = 2000;
export const FREE_DAILY_GATE = "free:stickler:daily";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const DOWNLOAD_PATHS = new Set(["/stickler/download", "/stickler/download/"]);
const SUPPORT_RE = /^\/stickler\/support\/(5|10|20|other)\/?$/;
const SUPPORT_VARS = {
  "5": "STICKLER_SUPPORT_LINK_5",
  "10": "STICKLER_SUPPORT_LINK_10",
  "20": "STICKLER_SUPPORT_LINK_20",
  other: "STICKLER_SUPPORT_LINK_OTHER",
} as const;

const CODE_RE = /^[A-Za-z0-9_]{1,200}$/;
const FULL_URL_RE = /^https:\/\/buy\.stripe\.com\/([A-Za-z0-9_]{1,200})$/;

/** Only these paths are handled here. Everything else under /stickler/ falls through to ASSETS. */
export function isSticklerPath(pathname: string): boolean {
  return DOWNLOAD_PATHS.has(pathname) || SUPPORT_RE.test(pathname);
}

/**
 * Payment Link config is either the bare code or the full URL. The result is
 * always rebuilt from the code, so no other host, path, query or fragment can
 * reach the Location header. Returns null for anything else.
 */
export function supportLocation(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const code = CODE_RE.test(value) ? value : (FULL_URL_RE.exec(value)?.[1] ?? null);
  if (!code) return null;
  return `https://buy.stripe.com/${code}`;
}

function handleSupport(request: Request, env: Env, url: URL, amount: keyof typeof SUPPORT_VARS): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return textResponse(url, "Method not allowed.\n", 405);
  }
  const record = env as unknown as Record<string, string | undefined>;
  const target = supportLocation(record[SUPPORT_VARS[amount]]);
  if (!target) {
    // 503, not a redirect: a visitor who chose to give sees plainly that it is not ready.
    safeLog("stickler_support_unset");
    return htmlResponse(url, supportUnavailablePage(), 503);
  }
  safeLog("stickler_support_redirect");
  return redirectResponse(url, target, 302);
}

function busy(url: URL, retryAfter: number, head: boolean): Response {
  const response = htmlResponse(url, head ? "" : freeBusyPage(), 429);
  response.headers.set("retry-after", String(retryAfter));
  return response;
}

function unavailable(url: URL, status: 404 | 503, head: boolean): Response {
  return htmlResponse(url, head ? "" : freeUnavailablePage(), status);
}

async function handleDownload(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return textResponse(url, "Method not allowed.\n", 405);
  }
  const head = request.method === "HEAD";
  const product = loadFreeProduct(env, "stickler");
  if (!product) {
    safeLog("stickler_download_unconfigured");
    return unavailable(url, 503, head);
  }
  const secret = env.DOWNLOAD_SIGNING_SECRET;
  const ip = clientIp(request);
  if (!signingSecretOk(secret) || !ip) {
    // Same stance as the paid path: no usable connection id, no download.
    safeLog("stickler_download_no_identity");
    return busy(url, 3600, head);
  }
  const ipLimit = readPositiveInt(env.RATE_LIMIT_FREE_IP_PER_HOUR, DEFAULT_FREE_IP_PER_HOUR, 1, 1000);
  const ipGate = env.PURCHASE_GATE.getByName(await hashName("free-ip", secret, ip));
  if (!(await ipGate.hit(ipLimit, HOUR_MS))) {
    safeLog("stickler_download_rate_ip");
    return busy(url, 3600, head);
  }
  if (!head) {
    // The daily cap counts file downloads. HEAD only spends the per-IP counter.
    const dayLimit = readPositiveInt(env.RATE_LIMIT_FREE_PER_DAY, DEFAULT_FREE_PER_DAY, 1, 1_000_000);
    if (!(await env.PURCHASE_GATE.getByName(FREE_DAILY_GATE).hit(dayLimit, DAY_MS))) {
      safeLog("stickler_download_rate_daily");
      return busy(url, 3600, head);
    }
  }
  const object = head ? await env.DOWNLOADS.head(product.key) : await env.DOWNLOADS.get(product.key);
  if (!object) {
    safeLog("stickler_download_missing");
    return unavailable(url, 404, head);
  }
  const headers = new Headers({
    "content-type": product.mediaType,
    "content-disposition": product.contentDisposition,
    "content-length": String(object.size),
    etag: object.httpEtag,
  });
  // applySecurityHeaders sets cache-control: no-store. Edge caching is not used:
  // the daily and per-IP counters must see every request.
  applySecurityHeaders(headers, url);
  safeLog(head ? "stickler_head_ok" : "stickler_download_ok");
  return new Response(head ? null : (object as R2ObjectBody).body, { status: 200, headers });
}

export async function handleStickler(request: Request, env: Env, url: URL): Promise<Response> {
  if (DOWNLOAD_PATHS.has(url.pathname)) return handleDownload(request, env, url);
  const match = SUPPORT_RE.exec(url.pathname);
  if (match) return handleSupport(request, env, url, match[1] as keyof typeof SUPPORT_VARS);
  return textResponse(url, "Not found.\n", 404);
}
