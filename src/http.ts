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
    headers.set(
      "strict-transport-security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }
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

/** Only the Cloudflare-set connecting IP. X-Forwarded-For is caller-controlled. */
export function clientIp(request: Request): string {
  const cf = request.headers.get("CF-Connecting-IP");
  if (cf && /^[0-9a-fA-F:.]{3,64}$/.test(cf)) return cf;
  return "unknown";
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
