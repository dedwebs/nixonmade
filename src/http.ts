const SECURITY: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "x-robots-tag": "noindex, nofollow",
  "cache-control": "no-store",
  pragma: "no-cache",
  expires: "0",
};

export function applySecurityHeaders(headers: Headers, requestUrl: URL): void {
  for (const [key, value] of Object.entries(SECURITY)) {
    headers.set(key, value);
  }
  // upgrade-insecure-requests on local http breaks the stylesheet. Production
  // is https and gets it. HSTS is also https-only so it does not pin localhost.
  let csp =
    "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; img-src 'self'; style-src 'self'; script-src 'none'; connect-src 'none'; font-src 'none'; object-src 'none'";
  if (requestUrl.protocol === "https:") csp += "; upgrade-insecure-requests";
  headers.set("content-security-policy", csp);
  const host = requestUrl.hostname;
  if (
    requestUrl.protocol === "https:" &&
    (host === "nixonmade.com" || host === "www.nixonmade.com")
  ) {
    headers.set("strict-transport-security", HSTS_VALUE);
  }
}

/** HSTS without preload. Preload is a one-way public list and is not set here. */
export const HSTS_VALUE = "max-age=31536000; includeSubDomains";

/**
 * Static pages load same-origin scripts and the Google font stylesheet.
 * Download pages keep the stricter policy in applySecurityHeaders.
 * upgrade-insecure-requests is https-only so local http can still load CSS.
 */
export function assetContentSecurityPolicy(requestUrl: URL): string {
  let policy =
    "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; img-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; object-src 'none'";
  if (requestUrl.protocol === "https:") policy += "; upgrade-insecure-requests";
  return policy;
}

export function applyAssetSecurityHeaders(headers: Headers, requestUrl: URL): void {
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("content-security-policy", assetContentSecurityPolicy(requestUrl));
  const host = requestUrl.hostname;
  if (
    requestUrl.protocol === "https:" &&
    (host === "nixonmade.com" || host === "www.nixonmade.com")
  ) {
    headers.set("strict-transport-security", HSTS_VALUE);
  }
}

export function secureAssetResponse(response: Response, requestUrl: URL): Response {
  const headers = new Headers(response.headers);
  applyAssetSecurityHeaders(headers, requestUrl);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function htmlResponse(requestUrl: URL, body: string, status = 200): Response {
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
  });
  applySecurityHeaders(headers, requestUrl);
  return new Response(body, { status, headers });
}

export function textResponse(requestUrl: URL, body: string, status: number): Response {
  const headers = new Headers({
    "content-type": "text/plain; charset=utf-8",
  });
  applySecurityHeaders(headers, requestUrl);
  return new Response(body, { status, headers });
}

export function jsonResponse(
  requestUrl: URL,
  body: unknown,
  status: number,
): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
  });
  applySecurityHeaders(headers, requestUrl);
  return new Response(JSON.stringify(body), { status, headers });
}

export function redirectResponse(
  requestUrl: URL,
  location: string,
  status: 302 | 303,
): Response {
  const headers = new Headers({ location });
  applySecurityHeaders(headers, requestUrl);
  return new Response(null, { status, headers });
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function readPositiveInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** Expand a compressed IPv6 address to eight groups, or null when it is not one. */
function expandIpv6(value: string): string[] | null {
  const lower = value.toLowerCase();
  if (lower.includes("%")) return null;
  let address = lower;
  if (lower.includes(".")) {
    const lastColon = lower.lastIndexOf(":");
    if (lastColon < 0) return null;
    const v4 = lower.slice(lastColon + 1);
    if (!isIpv4(v4)) return null;
    const [a, b, c, d] = v4.split(".").map((part) => Number(part));
    const high = ((a << 8) | b).toString(16);
    const low = ((c << 8) | d).toString(16);
    address = `${lower.slice(0, lastColon)}:${high}:${low}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parse = (side: string): string[] | null => {
    if (!side) return [];
    const groups = side.split(":");
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
    return groups;
  };
  const left = parse(halves[0] ?? "");
  const right = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if (!left || !right) return null;
  if (halves.length === 1) {
    if (left.length !== 8) return null;
    return left.map((group) => group.padStart(4, "0"));
  }
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array<string>(missing).fill("0000"), ...right].map((group) =>
    group.padStart(4, "0"),
  );
}

/**
 * Cloudflare's connecting IP only. There is no shared bucket for a missing
 * or unparseable value: the caller must reject that request.
 * IPv6 is reduced to its /64 so a single customer prefix shares one limit
 * without letting every address on the internet share one.
 */
export function clientIp(request: Request): string | null {
  const cf = request.headers.get("CF-Connecting-IP")?.trim() ?? "";
  if (!cf || cf.length > 64) return null;
  if (isIpv4(cf)) return cf;
  const groups = expandIpv6(cf);
  if (!groups) return null;
  const mapped =
    groups[0] === "0000" &&
    groups[1] === "0000" &&
    groups[2] === "0000" &&
    groups[3] === "0000" &&
    groups[4] === "0000" &&
    groups[5] === "ffff";
  if (mapped) {
    const high = Number.parseInt(groups[6] ?? "", 16);
    const low = Number.parseInt(groups[7] ?? "", 16);
    if (!Number.isInteger(high) || !Number.isInteger(low)) return null;
    return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
  }
  return groups.slice(0, 4).join(":");
}

/**
 * Read a body up to `max` bytes. A missing or lying Content-Length cannot
 * buffer the rest: the stream is cancelled as soon as the cap is passed.
 */
export async function readLimitedText(request: Request, max: number): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max)) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > max) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function hashName(label: string, pepper: string, value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${label}:${pepper}:${value}`),
  );
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `${label}:${hex.slice(0, 32)}`;
}
