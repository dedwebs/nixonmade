import { allowIp, issueDownload, markPaymentRefunded, openSignedFile } from "./access";
import type { Env } from "./env";
import { PurchaseGate } from "./gate";
import {
  applySecurityHeaders,
  htmlResponse,
  jsonResponse,
  redirectResponse,
  textResponse,
} from "./http";
import { safeLog } from "./log";
import {
  rateLimitPage,
  redownloadPage,
  thanksLimitPage,
  thanksMissingFilePage,
  thanksReadyPage,
  unavailablePage,
} from "./pages";
import { SESSION_ID_RE, signingSecretOk } from "./sign";
import { refundedPaymentIntent, verifyStripeWebhook } from "./webhook";

export { PurchaseGate };

const LEGACY_THANKS = new Set([
  "/field-kit/thanks",
  "/field-kit/thanks/",
  "/field-kit/thanks/index.html",
  "/ship-kit/thanks",
  "/ship-kit/thanks/",
  "/ship-kit/thanks/index.html",
]);

const HOSTS = new Set(["nixonmade.com", "www.nixonmade.com"]);

function sessionIdFromQuery(url: URL): string | null {
  const raw = url.searchParams.get("session_id");
  if (!raw) return null;
  const id = raw.trim();
  return SESSION_ID_RE.test(id) ? id : null;
}

function thanksPath(sessionId: string): string {
  return `/thanks?session_id=${encodeURIComponent(sessionId)}`;
}

function extractSessionId(raw: string, requestUrl: URL): string | null {
  const value = raw.trim();
  if (value.length === 0 || value.length > 500) return null;
  if (SESSION_ID_RE.test(value)) return value;
  let parsed: URL;
  try {
    parsed = new URL(value, requestUrl.origin);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  const hostOk = HOSTS.has(parsed.hostname) || parsed.hostname === requestUrl.hostname;
  if (!hostOk) return null;
  const id = parsed.searchParams.get("session_id")?.trim() ?? "";
  return SESSION_ID_RE.test(id) ? id : null;
}

async function readLimitedText(request: Request, max: number): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > max) return null;
  const buffer = await request.arrayBuffer();
  const text = new TextDecoder().decode(buffer);
  if (text.length > max) return null;
  return text;
}

function methodNotAllowed(url: URL): Response {
  return textResponse(url, "Method not allowed.\n", 405);
}

async function handleThanks(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(url);
  const sessionId = sessionIdFromQuery(url);
  if (!sessionId) {
    if (signingSecretOk(env.DOWNLOAD_SIGNING_SECRET) && !(await allowIp(request, env))) {
      return htmlResponse(url, rateLimitPage(), 429);
    }
    return htmlResponse(url, unavailablePage(), 404);
  }
  const issued = await issueDownload(request, env, sessionId);
  if (!issued.ok) {
    if (issued.error === "rate") return htmlResponse(url, rateLimitPage(), 429);
    if (issued.error === "limit") return htmlResponse(url, thanksLimitPage(issued.limit), 429);
    if (issued.error === "missing") {
      return htmlResponse(url, thanksMissingFilePage(issued.title), 404);
    }
    return htmlResponse(url, unavailablePage(), 404);
  }
  const download = issued.download;
  const body = thanksReadyPage({
    title: download.product.title,
    filename: download.product.filename,
    filePath: download.filePath,
    remaining: download.remaining,
    ttlMinutes: download.ttlMinutes,
    limit: download.limit,
  });
  if (request.method === "HEAD") return htmlResponse(url, "", 200);
  return htmlResponse(url, body, 200);
}

async function handleDownloadApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(url);
  const sessionId = sessionIdFromQuery(url);
  if (!sessionId) {
    if (signingSecretOk(env.DOWNLOAD_SIGNING_SECRET) && !(await allowIp(request, env))) {
      return jsonResponse(url, { error: "unavailable" }, 429);
    }
    return jsonResponse(url, { error: "unavailable" }, 404);
  }
  const issued = await issueDownload(request, env, sessionId);
  if (!issued.ok) {
    const status = issued.error === "rate" || issued.error === "limit" ? 429 : 404;
    const error = issued.error === "limit" ? "limit" : "unavailable";
    return jsonResponse(url, { error }, status);
  }
  const download = issued.download;
  return jsonResponse(
    url,
    {
      product: download.product.slug,
      title: download.product.title,
      expires_at: download.expiresAt,
      downloads_remaining: download.remaining,
      files: [
        {
          filename: download.product.filename,
          url: download.filePath,
        },
      ],
    },
    200,
  );
}

async function handleFile(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(url);
  const token = url.searchParams.get("t") ?? "";
  if (!token || token.length > 4000) {
    return textResponse(url, "This download isn't available.\n", 404);
  }
  const opened = await openSignedFile(request, env, token);
  if (!opened.ok) {
    if (opened.error === "rate") {
      return textResponse(url, "Too many requests. Wait a minute and try again.\n", 429);
    }
    if (opened.error === "limit") {
      return textResponse(url, "This purchase has used its downloads.\n", 429);
    }
    return textResponse(url, "This download isn't available.\n", 404);
  }
  const headers = new Headers({
    "content-type": opened.mediaType,
    "content-disposition": opened.contentDisposition,
    "content-length": String(opened.size),
  });
  applySecurityHeaders(headers, url);
  return new Response(opened.body, { status: 200, headers });
}

async function handleRedownload(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "GET" || request.method === "HEAD") {
    if (!signingSecretOk(env.DOWNLOAD_SIGNING_SECRET)) {
      safeLog("secrets_incomplete");
      return htmlResponse(url, unavailablePage(), 404);
    }
    if (!(await allowIp(request, env))) return htmlResponse(url, rateLimitPage(), 429);
    if (request.method === "HEAD") return htmlResponse(url, "", 200);
    return htmlResponse(url, redownloadPage(null), 200);
  }
  if (request.method !== "POST") return methodNotAllowed(url);
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("application/x-www-form-urlencoded")) {
    return htmlResponse(url, redownloadPage("Check the session id and try again."), 400);
  }
  if (!signingSecretOk(env.DOWNLOAD_SIGNING_SECRET)) {
    safeLog("secrets_incomplete");
    return htmlResponse(url, unavailablePage(), 404);
  }
  if (!(await allowIp(request, env))) return htmlResponse(url, rateLimitPage(), 429);
  const body = await readLimitedText(request, 4096);
  if (body === null) {
    return htmlResponse(url, redownloadPage("Check the session id and try again."), 400);
  }
  const params = new URLSearchParams(body);
  const sessionId = extractSessionId(params.get("session_id") ?? "", url);
  if (!sessionId) {
    return htmlResponse(url, redownloadPage("Check the session id and try again."), 400);
  }
  return redirectResponse(url, thanksPath(sessionId), 303);
}

async function handleWebhook(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(url);
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret || secret.length < 16) {
    safeLog("secrets_incomplete");
    return textResponse(url, "", 400);
  }
  const payload = await readLimitedText(request, 200_000);
  if (payload === null) return textResponse(url, "", 400);
  const valid = await verifyStripeWebhook(
    payload,
    request.headers.get("Stripe-Signature"),
    secret,
    Date.now(),
  );
  if (!valid) {
    safeLog("webhook_bad_signature");
    return textResponse(url, "", 400);
  }
  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    return textResponse(url, "", 400);
  }
  const paymentIntentId = refundedPaymentIntent(event);
  if (paymentIntentId) {
    await markPaymentRefunded(env, paymentIntentId);
    safeLog("webhook_refunded");
  } else {
    safeLog("webhook_ignored");
  }
  return textResponse(url, "", 200);
}

async function handleLegacyThanks(request: Request, env: Env, url: URL): Promise<Response> {
  const sessionId = sessionIdFromQuery(url);
  if (sessionId && (request.method === "GET" || request.method === "HEAD")) {
    if (signingSecretOk(env.DOWNLOAD_SIGNING_SECRET) && !(await allowIp(request, env))) {
      return htmlResponse(url, rateLimitPage(), 429);
    }
    return redirectResponse(url, thanksPath(sessionId), 302);
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/thanks" || url.pathname === "/thanks/") {
        return await handleThanks(request, env, url);
      }
      if (url.pathname === "/api/download") {
        return await handleDownloadApi(request, env, url);
      }
      if (url.pathname === "/api/file") {
        return await handleFile(request, env, url);
      }
      if (url.pathname === "/redownload" || url.pathname === "/redownload/") {
        return await handleRedownload(request, env, url);
      }
      if (url.pathname === "/api/stripe/webhook") {
        return await handleWebhook(request, env, url);
      }
      if (LEGACY_THANKS.has(url.pathname)) {
        return await handleLegacyThanks(request, env, url);
      }
      return await env.ASSETS.fetch(request);
    } catch {
      safeLog("unhandled");
      if (url.pathname.startsWith("/api/")) {
        return jsonResponse(url, { error: "unavailable" }, 500);
      }
      return htmlResponse(url, unavailablePage(), 500);
    }
  },
};
