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
export const DEFAULT_APPCAST_IP_PER_HOUR = 120;
export const DEFAULT_UPDATES_IP_PER_HOUR = 20;
export const DEFAULT_UPDATES_PER_DAY = 5000;
export const UPDATES_DAILY_GATE = "updates:stickler:daily";
export const FREE_DAILY_GATE = "free:stickler:daily";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const DOWNLOAD_PATHS = new Set(["/stickler/download", "/stickler/download/"]);
const APPCAST_PATHS = new Set(["/stickler/appcast.xml"]);
const APPCAST_KEY = "stickler/appcast.xml";
const UPDATES_PREFIX = "/stickler/updates/";
const R2_UPDATES_PREFIX = "stickler/updates/";
// Matched against the raw pathname, never decoded: any `%`, `/` or `..` fails.
const UPDATE_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(zip|dmg|delta|tar\.xz)$/;
const UPDATE_TYPES: Record<string, string> = {
  zip: "application/zip",
  dmg: "application/x-apple-diskimage",
  delta: "application/octet-stream",
  "tar.xz": "application/octet-stream",
};
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
  return (
    DOWNLOAD_PATHS.has(pathname) ||
    APPCAST_PATHS.has(pathname) ||
    pathname.startsWith(UPDATES_PREFIX) ||
    SUPPORT_RE.test(pathname)
  );
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

function plain(url: URL, body: string, status: number, head: boolean): Response {
  return textResponse(url, head ? "" : body, status);
}

function limited(url: URL, retryAfter: number): Response {
  const response = textResponse(url, "Too many requests. Try again later.\n", 429);
  response.headers.set("retry-after", String(retryAfter));
  return response;
}

/** Per-connection hourly counter in its own gate namespace. Null means allowed. */
async function ipLimit(request: Request, env: Env, url: URL, label: string, limit: number, event: string, failOpen = false): Promise<Response | null> {
  const secret = env.DOWNLOAD_SIGNING_SECRET;
  const ip = clientIp(request);
  if (!signingSecretOk(secret) || !ip) {
    safeLog(`${event}_no_identity`);
    // The appcast fails open: a config error must never silently stop all updates.
    return failOpen ? null : limited(url, 3600);
  }
  const gate = env.PURCHASE_GATE.getByName(await hashName(label, secret, ip));
  if (!(await gate.hit(limit, HOUR_MS))) {
    safeLog(`${event}_rate_ip`);
    return limited(url, 3600);
  }
  return null;
}

function objectHeaders(object: R2Object, url: URL, type: string, cache: string): Headers {
  const headers = new Headers({ "content-type": type });
  applySecurityHeaders(headers, url);
  headers.set("cache-control", cache);
  headers.set("etag", object.httpEtag);
  headers.set("last-modified", object.uploaded.toUTCString());
  return headers;
}

function hasBody(object: R2Object | R2ObjectBody | null): object is R2ObjectBody {
  return !!object && "body" in object;
}

function etagMatches(header: string, etag: string, weak: boolean): boolean {
  const strip = (v: string) => (weak ? v.replace(/^W\//, "") : v);
  return header.split(",").some((t) => {
    const v = t.trim();
    return v === "*" || strip(v) === strip(etag);
  });
}

/** Preconditions per RFC 9110 order: If-Match (412), If-None-Match, If-Modified-Since (304). */
function precondition(request: Request, object: R2Object): 304 | 412 | null {
  const h = request.headers;
  const ifMatch = h.get("if-match");
  if (ifMatch !== null && !etagMatches(ifMatch, object.httpEtag, false)) return 412;
  const none = h.get("if-none-match");
  if (none !== null) return etagMatches(none, object.httpEtag, true) ? 304 : null;
  const since = Date.parse(h.get("if-modified-since") ?? "");
  if (!Number.isNaN(since) && Math.floor(object.uploaded.getTime() / 1000) * 1000 <= since) return 304;
  return null;
}

/** If-Range: honour the Range only when the validator still matches. */
function ifRangeOk(request: Request, object: R2Object): boolean {
  const v = request.headers.get("if-range");
  if (v === null) return true;
  const t = v.trim();
  if (t.startsWith('"')) return t === object.httpEtag;
  return t === object.uploaded.toUTCString();
}

async function handleAppcast(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return textResponse(url, "Method not allowed.\n", 405);
  }
  const head = request.method === "HEAD";
  const limit = readPositiveInt(env.RATE_LIMIT_APPCAST_IP_PER_HOUR, DEFAULT_APPCAST_IP_PER_HOUR, 1, 100_000);
  const over = await ipLimit(request, env, url, "appcast-ip", limit, "stickler_appcast", true);
  if (over) return over;
  const object = head
    ? await env.DOWNLOADS.head(APPCAST_KEY)
    : await env.DOWNLOADS.get(APPCAST_KEY);
  if (!object) {
    safeLog("stickler_appcast_missing");
    return plain(url, "Not found.\n", 404, head);
  }
  const headers = objectHeaders(object, url, "application/rss+xml; charset=utf-8", "public, max-age=300");
  const cond = precondition(request, object);
  if (cond) {
    if (hasBody(object)) await object.body.cancel();
    safeLog(cond === 304 ? "stickler_appcast_304" : "stickler_appcast_412");
    return new Response(null, { status: cond, headers });
  }
  headers.set("content-length", String(object.size));
  if (!hasBody(object)) return new Response(null, { status: 200, headers });
  safeLog("stickler_appcast_ok");
  return new Response(object.body, { status: 200, headers });
}

type Span = { offset: number; length: number };

/** One `bytes=` range against a known size. undefined: ignore the header. null: unsatisfiable. */
function parseRange(header: string, size: number): Span | null | undefined {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return undefined;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return null;
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || end < start) return null;
  return { offset: start, length: end - start + 1 };
}

async function handleUpdate(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return textResponse(url, "Method not allowed.\n", 405);
  }
  const head = request.method === "HEAD";
  const name = url.pathname.slice(UPDATES_PREFIX.length);
  const match = UPDATE_FILE_RE.exec(name);
  if (!match || name.includes("..")) return plain(url, "Not found.\n", 404, head);
  const type = UPDATE_TYPES[match[1]!]!;
  const limit = readPositiveInt(env.RATE_LIMIT_UPDATES_IP_PER_HOUR, DEFAULT_UPDATES_IP_PER_HOUR, 1, 100_000);
  const over = await ipLimit(request, env, url, "updates-ip", limit, "stickler_update");
  if (over) return over;
  const key = R2_UPDATES_PREFIX + name;
  // Head first: the daily cap is spent only on an object that exists.
  const meta = await env.DOWNLOADS.head(key);
  if (!meta) {
    safeLog("stickler_update_missing");
    return plain(url, "Not found.\n", 404, head);
  }
  const headers = objectHeaders(meta, url, type, "public, max-age=31536000, immutable");
  headers.set("content-disposition", `attachment; filename="${name}"`);
  headers.set("accept-ranges", "bytes");
  const cond = precondition(request, meta);
  if (cond) {
    safeLog(cond === 304 ? "stickler_update_304" : "stickler_update_412");
    return new Response(null, { status: cond, headers });
  }
  if (head) {
    headers.set("content-length", String(meta.size));
    return new Response(null, { status: 200, headers });
  }
  const dayLimit = readPositiveInt(env.RATE_LIMIT_UPDATES_PER_DAY, DEFAULT_UPDATES_PER_DAY, 1, 10_000_000);
  if (!(await env.PURCHASE_GATE.getByName(UPDATES_DAILY_GATE).hit(dayLimit, DAY_MS))) {
    safeLog("stickler_update_rate_daily");
    return limited(url, 3600);
  }
  let span: Span | undefined;
  const range = request.headers.get("range");
  if (range && ifRangeOk(request, meta)) {
    const parsed = parseRange(range, meta.size);
    if (parsed === null) {
      const res = plain(url, "Range not satisfiable.\n", 416, false);
      res.headers.set("content-range", `bytes */${meta.size}`);
      return res;
    }
    span = parsed;
  }
  const object = await env.DOWNLOADS.get(key, span ? { range: span } : {});
  if (!hasBody(object)) {
    safeLog("stickler_update_missing");
    return plain(url, "Not found.\n", 404, false);
  }
  if (span) {
    headers.set("content-range", `bytes ${span.offset}-${span.offset + span.length - 1}/${object.size}`);
    headers.set("content-length", String(span.length));
    safeLog("stickler_update_partial");
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  safeLog("stickler_update_ok");
  return new Response(object.body, { status: 200, headers });
}

export async function handleStickler(request: Request, env: Env, url: URL): Promise<Response> {
  const response = await routeStickler(request, env, url);
  // Not public until the name is cleared; _headers only covers static files.
  response.headers.set("x-robots-tag", "noindex");
  return response;
}

async function routeStickler(request: Request, env: Env, url: URL): Promise<Response> {
  if (DOWNLOAD_PATHS.has(url.pathname)) return handleDownload(request, env, url);
  if (APPCAST_PATHS.has(url.pathname)) return handleAppcast(request, env, url);
  if (url.pathname.startsWith(UPDATES_PREFIX)) return handleUpdate(request, env, url);
  const match = SUPPORT_RE.exec(url.pathname);
  if (match) return handleSupport(request, env, url, match[1] as keyof typeof SUPPORT_VARS);
  return textResponse(url, "Not found.\n", 404);
}
